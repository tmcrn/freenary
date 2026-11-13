// Accès depuis un autre appareil du réseau (téléphone) : désactivé par défaut, protégé par mot de passe.
//
// - Le Mac lui-même (127.0.0.1) n'a jamais besoin de mot de passe.
// - Les autres appareils doivent : 1) que l'accès soit activé, 2) viser un nom/une adresse de ce Mac (anti-rebinding),
//   3) se connecter avec le mot de passe (scrypt) → cookie signé HttpOnly/SameSite=Strict valable 30 jours,
//   4) passer le contrôle anti force brute (5 échecs → 15 minutes de blocage par appareil).
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { networkInterfaces, hostname } from 'node:os';
import path from 'node:path';

const COOKIE = 'freenary_session';
const MAX_AGE = 30 * 24 * 3600; // secondes
const httpError = (status, message) => Object.assign(new Error(message), { status });

export const isLoopback = addr => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

/** Adresses IPv4 de ce Mac sur le réseau local (hors boucle locale). */
export function lanIps() {
  return Object.values(networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
}

let namesCache = { at: 0, list: [] };
/** Noms par lesquels un téléphone peut joindre ce Mac (Bonjour : « nom.local »). Mis en cache 60 s (appelle scutil). */
export function lanNames() {
  if (Date.now() - namesCache.at < 60_000) return namesCache.list;
  const names = new Set();
  try { const n = execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8', timeout: 2000 }).trim(); if (n) names.add(`${n}.local`.toLowerCase()); } catch { /* pas macOS */ }
  const h = hostname().toLowerCase();
  names.add(h);
  names.add(`${h.split('.')[0]}.local`);
  namesCache = { at: Date.now(), list: [...names] };
  return namesCache.list;
}

export class Access {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'access.json');
    try { this.cfg = JSON.parse(readFileSync(this.file, 'utf8')); } catch { this.cfg = { enabled: false }; }
    this.fails = new Map(); // ip → { count, until }
  }

  #save() { writeFileSync(this.file, JSON.stringify(this.cfg, null, 2), { mode: 0o600 }); chmodSync(this.file, 0o600); }
  #hash(pw, salt) { return scryptSync(String(pw), salt, 64).toString('hex'); }
  #sign(exp) { return createHmac('sha256', this.cfg.secret || '').update(String(exp)).digest('hex'); }

  get hasPassword() { return Boolean(this.cfg.hash); }
  get enabled() { return Boolean(this.cfg.enabled && this.cfg.hash); }

  setPassword(pw) {
    if (String(pw || '').length < 8) throw httpError(400, 'Mot de passe trop court : 8 caractères minimum.');
    this.cfg.salt = randomBytes(16).toString('hex');
    this.cfg.hash = this.#hash(pw, this.cfg.salt);
    this.cfg.secret = randomBytes(32).toString('hex'); // change le secret : les anciens cookies deviennent invalides
    this.#save();
  }

  setEnabled(on) {
    if (on && !this.cfg.hash) throw httpError(400, 'Choisis d’abord un mot de passe.');
    this.cfg.enabled = Boolean(on);
    this.#save();
  }

  revokeSessions() { this.cfg.secret = randomBytes(32).toString('hex'); this.#save(); }

  verify(pw) {
    if (!this.cfg.hash) return false;
    const a = Buffer.from(this.#hash(pw, this.cfg.salt), 'hex'), b = Buffer.from(this.cfg.hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /* ───── anti force brute ───── */
  locked(ip) { const f = this.fails.get(ip); return Boolean(f && f.until > Date.now()); }
  fail(ip) {
    const f = this.fails.get(ip) || { count: 0, until: 0 };
    f.count++;
    if (f.count >= 5) { f.until = Date.now() + 15 * 60_000; f.count = 0; }
    this.fails.set(ip, f);
  }
  succeed(ip) { this.fails.delete(ip); }

  /* ───── session par cookie signé ───── */
  cookie(secure) {
    const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
    return `${COOKIE}=${exp}.${this.#sign(exp)}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  }
  clearCookie(secure) { return `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`; }
  valid(cookieHeader) {
    const m = String(cookieHeader || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
    if (!m || !this.cfg.secret) return false;
    const [exp, sig] = m.slice(COOKIE.length + 1).split('.');
    if (!/^\d+$/.test(exp || '') || Number(exp) < Date.now() / 1000) return false;
    const want = Buffer.from(this.#sign(exp), 'hex'), got = Buffer.from(/^[0-9a-f]+$/.test(sig || '') ? sig : '', 'hex');
    return want.length === got.length && timingSafeEqual(want, got);
  }

  /* ───── adresses ───── */
  remoteHosts(port) { return new Set([...lanNames(), ...lanIps()].map(h => `${h}:${port}`)); }
  urls(port) { return [...lanNames().filter(n => n.endsWith('.local')), ...lanIps()].map(h => `https://${h}:${port}`); }
}
