// Connecteur Enable Banking (DSP2) — https://enablebanking.com/docs/api/reference/
//
// Flux :
//   1. GET  /aspsps?country=FR            → liste des banques
//   2. POST /auth                         → URL de consentement chez la banque
//   3. la banque redirige vers redirect_url?code=…&state=…
//   4. POST /sessions {code}              → session_id + comptes (uid)
//   5. GET  /accounts/{uid}/balances      → soldes
//      GET  /accounts/{uid}/transactions  → mouvements (paginés par continuation_key)
//
// Authentification : JWT RS256 signé avec la clé privée de l'application,
// header kid = application_id, iss = enablebanking.com, aud = api.enablebanking.com, durée ≤ 24 h.

import { createSign, createPrivateKey, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { today, addDays, round2 } from './util.js';
import { categorizer } from './logic.js';

const API = 'https://api.enablebanking.com';
const httpError = (status, message) => Object.assign(new Error(message), { status });
const b64url = buf => Buffer.from(buf).toString('base64url');

export class EnableBanking {
  constructor(db, dataDir, port) {
    this.db = db;
    this.cfgFile = path.join(dataDir, 'enablebanking.json');
    this.keyFile = path.join(dataDir, 'enablebanking.pem');
    this.defaultRedirect = `http://localhost:${port}/api/eb/callback`;
    this.pending = new Map(); // state → { aspsp, created }
    this.syncing = false;
  }

  /* ───── Configuration (stockée en local dans data/, jamais exposée au navigateur) ───── */

  config() {
    const cfg = existsSync(this.cfgFile) ? JSON.parse(readFileSync(this.cfgFile, 'utf8')) : {};
    return { application_id: cfg.application_id || process.env.EB_APPLICATION_ID || '', redirect_url: cfg.redirect_url || process.env.EB_REDIRECT_URL || this.defaultRedirect, sync_hours: cfg.sync_hours ?? 6 };
  }

  privateKey() {
    if (process.env.EB_PRIVATE_KEY_PATH) return readFileSync(process.env.EB_PRIVATE_KEY_PATH, 'utf8');
    return existsSync(this.keyFile) ? readFileSync(this.keyFile, 'utf8') : '';
  }

  isConfigured() { return Boolean(this.config().application_id && this.privateKey()); }

  saveConfig(body) {
    const cur = existsSync(this.cfgFile) ? JSON.parse(readFileSync(this.cfgFile, 'utf8')) : {};
    if (body.application_id != null) cur.application_id = String(body.application_id).trim();
    if (body.redirect_url != null) cur.redirect_url = String(body.redirect_url).trim() || undefined;
    if (body.sync_hours != null) cur.sync_hours = Math.max(1, Number(body.sync_hours) || 6);
    if (body.private_key) {
      try { createPrivateKey(body.private_key); } catch { throw httpError(400, 'Clé privée illisible : colle le contenu complet du fichier .pem.'); }
      writeFileSync(this.keyFile, body.private_key.trim() + '\n', { mode: 0o600 });
      chmodSync(this.keyFile, 0o600);
    }
    writeFileSync(this.cfgFile, JSON.stringify(cur, null, 2), { mode: 0o600 });
    return this.status();
  }

  status() {
    const cfg = this.config();
    const sessions = this.db.prepare('SELECT * FROM eb_sessions ORDER BY created_at').all().map(s => ({
      ...s,
      accounts: this.db.prepare('SELECT id, name, last4, balance FROM accounts WHERE session_id = ?').all(s.session_id),
      expired: s.valid_until ? new Date(s.valid_until) < new Date() : false,
    }));
    return { configured: this.isConfigured(), application_id: cfg.application_id, redirect_url: cfg.redirect_url, default_redirect: this.defaultRedirect, has_key: Boolean(this.privateKey()), sync_hours: cfg.sync_hours, sessions, syncing: this.syncing };
  }

  /* ───── Appels HTTP signés ───── */

  jwt() {
    const { application_id } = this.config();
    const key = this.privateKey();
    if (!application_id || !key) throw httpError(400, 'Enable Banking n’est pas configuré (Application ID + clé privée).');
    const iat = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: application_id }));
    const payload = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + 3600 }));
    const sig = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(key);
    return `${header}.${payload}.${b64url(sig)}`;
  }

  async call(method, pathname, { query, body } = {}) {
    const url = new URL(API + pathname);
    for (const [k, v] of Object.entries(query || {})) if (v != null && v !== '') url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.jwt()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
    if (!res.ok) throw httpError(res.status === 401 ? 400 : 502, `Enable Banking ${res.status} : ${data.message || data.error || data.code || text}`.slice(0, 400));
    return data;
  }

  /* ───── Flux de consentement ───── */

  async aspsps(country = 'FR') {
    const data = await this.call('GET', '/aspsps', { query: { country, psu_type: 'personal' } });
    return (data.aspsps || []).map(a => ({ name: a.name, country: a.country, logo: a.logo, maximum_consent_validity: a.maximum_consent_validity, psu_types: a.psu_types }));
  }

  async startAuth({ name, country = 'FR', maximum_consent_validity }) {
    if (!name) throw httpError(400, 'Banque manquante');
    const maxSec = Number(maximum_consent_validity) || 180 * 86400;
    const validUntil = new Date(Date.now() + Math.min(maxSec, 180 * 86400) * 1000 - 60_000).toISOString();
    const state = randomUUID();
    const redirect = this.config().redirect_url;
    let data;
    try {
      data = await this.call('POST', '/auth', {
        body: { access: { valid_until: validUntil }, aspsp: { name, country }, state, redirect_url: redirect, psu_type: 'personal', language: 'fr' },
      });
    } catch (e) {
      if (/redirect/i.test(e.message)) throw httpError(400, `L’URL de redirection « ${redirect} » n’est pas déclarée dans ton application Enable Banking. Mets exactement la même URL des deux côtés (Control Panel › Redirect URLs, et ici dans « URL de redirection »).`);
      throw e;
    }
    this.pending.set(state, { aspsp: { name, country }, created: Date.now() });
    return { url: data.url, state };
  }

  /** Échange le code reçu de la banque contre une session, crée/associe les comptes puis synchronise. */
  async completeAuth(code, state) {
    if (!code) throw httpError(400, 'Code d’autorisation manquant');
    // Le « state » est obligatoire : sans lui, n'importe quelle page pourrait faire échanger au navigateur le code d'une autre session bancaire.
    for (const [k, v] of this.pending) if (Date.now() - v.created > 30 * 60_000) this.pending.delete(k);
    const pend = state ? this.pending.get(state) : null;
    if (!pend) throw httpError(400, 'Connexion inconnue ou expirée : relance « Connecter une banque » depuis Réglages.');
    this.pending.delete(state);
    const s = await this.call('POST', '/sessions', { body: { code } });
    const aspsp = s.aspsp || pend?.aspsp || {};
    this.db.prepare(`INSERT INTO eb_sessions(session_id, aspsp_name, aspsp_country, valid_until, created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET valid_until = excluded.valid_until`)
      .run(s.session_id, aspsp.name || 'Banque', aspsp.country || 'FR', s.access?.valid_until || null, new Date().toISOString());

    const palette = /bourso/i.test(aspsp.name) ? '#F5B6D7,#F9CFE4' : /agricole/i.test(aspsp.name) ? '#A9B56C,#C4CD8C' : '#F7D66B,#FAE59D';
    for (const a of s.accounts || []) {
      const iban = a.account_id?.iban || a.all_account_ids?.find(x => x.identification)?.identification || '';
      const type = a.cash_account_type === 'CACC' || a.cash_account_type === 'CARD' ? 'checking' : 'savings';
      // « name » est souvent le titulaire (« M. DUPONT JEAN ») : on préfère le nom du produit
      const product = a.product || a.details;
      const name = product ? product.charAt(0) + product.slice(1).toLowerCase() : (type === 'checking' ? 'Compte courant' : 'Épargne');
      const existing = this.db.prepare('SELECT id FROM accounts WHERE external_id = ? OR (identification_hash IS NOT NULL AND identification_hash = ?)').get(a.uid, a.identification_hash || null)
        // secours : même banque et mêmes 4 derniers chiffres de l'IBAN (reconnexion après une session fermée)
        || (iban ? this.db.prepare('SELECT id FROM accounts WHERE bank = ? AND last4 = ? AND is_demo = 0').get(aspsp.name || '', iban.slice(-4)) : null);
      if (existing) {
        this.db.prepare('UPDATE accounts SET external_id = ?, session_id = ?, bank = ? WHERE id = ?').run(a.uid, s.session_id, aspsp.name, existing.id);
      } else {
        this.db.prepare('INSERT INTO accounts(bank, name, type, balance, last4, colors, external_id, session_id, identification_hash, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(aspsp.name || 'Banque', name, type, 0, iban.slice(-4), palette, a.uid, s.session_id, a.identification_hash || null, new Date().toISOString());
      }
    }
    // Les anciennes sessions qui n'ont plus aucun compte rattaché sont mortes : on les retire.
    this.db.prepare('DELETE FROM eb_sessions WHERE session_id != ? AND session_id NOT IN (SELECT session_id FROM accounts WHERE session_id IS NOT NULL)').run(s.session_id);
    await this.syncSession(s.session_id, { initial: true });
    return { session_id: s.session_id, accounts: (s.accounts || []).length };
  }

  async deleteSession(sessionId) {
    try { await this.call('DELETE', `/sessions/${encodeURIComponent(sessionId)}`); } catch (e) { console.warn('[EB] suppression distante :', e.message); }
    this.db.prepare('UPDATE accounts SET session_id = NULL WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM eb_sessions WHERE session_id = ?').run(sessionId);
    return { ok: true };
  }

  /* ───── Synchronisation ───── */

  static pickBalance(balances = []) {
    const order = ['CLBD', 'ITBD', 'XPCD', 'CLAV', 'ITAV', 'OPBD', 'OPAV'];
    const sorted = [...balances].sort((a, b) => {
      const ia = order.indexOf(a.balance_type), ib = order.indexOf(b.balance_type);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const b = sorted[0];
    return b ? Number(b.balance_amount?.amount) : null;
  }

  static toRow(t) {
    const raw = Number(t.transaction_amount?.amount ?? 0);
    const amount = t.credit_debit_indicator === 'DBIT' ? -Math.abs(raw) : Math.abs(raw);
    const counterpart = amount < 0 ? t.creditor?.name : t.debtor?.name;
    const info = (t.remittance_information || []).join(' ').replace(/\s+/g, ' ').trim();
    const label = (info || counterpart || t.bank_transaction_code?.description || t.note || 'Opération').slice(0, 200);
    const date = t.booking_date || t.value_date || t.transaction_date;
    const ext = t.entry_reference || t.transaction_id || `h:${date}|${amount}|${label}`;
    return { date, label, amount: round2(amount), external_id: `eb:${ext}` };
  }

  async syncAccount(acc, { initial = false } = {}) {
    const bal = await this.call('GET', `/accounts/${encodeURIComponent(acc.external_id)}/balances`);
    const balance = EnableBanking.pickBalance(bal.balances);

    const last = this.db.prepare("SELECT MAX(date) AS d FROM transactions WHERE account_id = ? AND external_id LIKE 'eb:%'").get(acc.id).d;
    const dateFrom = initial || !last ? addDays(today(), -730) : addDays(last, -10);
    const categorize = categorizer(this.db);
    const transferIds = new Set(this.db.prepare("SELECT id FROM categories WHERE kind = 'transfer'").all().map(c => c.id));
    const ins = this.db.prepare('INSERT OR IGNORE INTO transactions(account_id, date, label, amount, category_id, hidden, external_id) VALUES (?,?,?,?,?,?,?)');

    let key = null, inserted = 0, pages = 0;
    do {
      const page = await this.call('GET', `/accounts/${encodeURIComponent(acc.external_id)}/transactions`, {
        query: { date_from: dateFrom, continuation_key: key, ...(initial ? { strategy: 'longest' } : {}) },
      });
      for (const t of page.transactions || []) {
        if (t.status && t.status !== 'BOOK') continue; // on ne garde que les opérations comptabilisées
        const r = EnableBanking.toRow(t);
        if (!r.date) continue;
        const cat = categorize(r.label, r.amount);
        inserted += ins.run(acc.id, r.date, r.label, r.amount, cat, transferIds.has(cat) ? 1 : 0, r.external_id).changes;
      }
      key = page.continuation_key || null;
    } while (key && ++pages < 50);

    if (balance != null) this.db.prepare('UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?').run(balance, new Date().toISOString(), acc.id);
    return { account: acc.id, inserted, balance };
  }

  async syncSession(sessionId, opts = {}) {
    const accounts = this.db.prepare('SELECT * FROM accounts WHERE session_id = ? AND external_id IS NOT NULL').all(sessionId);
    const results = [];
    try {
      for (const a of accounts) results.push(await this.syncAccount(a, opts));
      this.db.prepare('UPDATE eb_sessions SET last_sync = ?, last_error = NULL WHERE session_id = ?').run(new Date().toISOString(), sessionId);
    } catch (e) {
      this.db.prepare('UPDATE eb_sessions SET last_error = ? WHERE session_id = ?').run(e.message, sessionId);
      throw e;
    }
    return results;
  }

  async syncAll() {
    if (this.syncing) throw httpError(409, 'Synchronisation déjà en cours');
    if (!this.isConfigured()) throw httpError(400, 'Enable Banking n’est pas configuré.');
    this.syncing = true;
    const out = { inserted: 0, errors: [] };
    try {
      for (const s of this.db.prepare('SELECT * FROM eb_sessions').all()) {
        if (s.valid_until && new Date(s.valid_until) < new Date()) { out.errors.push(`${s.aspsp_name} : consentement expiré, reconnecte la banque.`); continue; }
        try { for (const r of await this.syncSession(s.session_id)) out.inserted += r.inserted; }
        catch (e) { out.errors.push(`${s.aspsp_name} : ${e.message}`); }
      }
    } finally { this.syncing = false; }
    return out;
  }

  /** Synchronisation automatique (par défaut toutes les 6 h ≈ 4 fois/jour, la limite DSP2 usuelle sans l'utilisateur). */
  startScheduler() {
    const tick = async () => {
      if (!this.isConfigured() || !this.db.prepare('SELECT COUNT(*) AS n FROM eb_sessions').get().n) return;
      try { const r = await this.syncAll(); this.onSynced?.(); console.log(`[EB] sync auto : ${r.inserted} nouveaux mouvements${r.errors.length ? ' — ' + r.errors.join(' | ') : ''}`); }
      catch (e) { console.warn('[EB] sync auto :', e.message); }
    };
    const schedule = () => { clearTimeout(this.timer); this.timer = setTimeout(async () => { await tick(); schedule(); }, this.config().sync_hours * 3600_000); };
    setTimeout(tick, 15_000); // un passage peu après le démarrage
    schedule();
  }
}
