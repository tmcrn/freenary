#!/usr/bin/env node
// Freenary × Claude : serveur MCP en LECTURE SEULE (protocole Model Context Protocol, sur stdin/stdout).
//
// Claude (Desktop ou Code) lance ce programme sur ton Mac ; il lit data/budget.db et répond à ses questions
// (soldes, mouvements, statistiques, prévisions, PEA). Aucun réseau, aucune écriture, aucun secret :
// il n'ouvre jamais la clé Enable Banking, les certificats ni le mot de passe d'accès téléphone.
//
// ⚠ Tout ce qu'un outil renvoie entre dans la conversation, donc chez Anthropic. Voir README › « Interroger tes comptes avec Claude ».
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../lib/logic.js';
import { livePrice } from '../lib/portfolio.js';
import { today, addDays, round2, normalizeLabel } from '../lib/util.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.FREENARY_DATA || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA, 'budget.db');
const VERSION = '0.2.0';
const log = (...a) => console.error('[freenary-mcp]', ...a); // stdout est réservé au protocole

if (!existsSync(DB_FILE)) { log(`Base introuvable : ${DB_FILE}. Lance d'abord Freenary (npm start) au moins une fois.`); process.exit(1); }
let db;
try { db = new DatabaseSync(DB_FILE, { readOnly: true }); } catch { db = new DatabaseSync(DB_FILE); }
db.exec('PRAGMA query_only = ON'); // ceinture et bretelles : SQLite refuse toute écriture sur cette connexion

/* ───────────── Outils ───────────── */

const INTERNAL = "COALESCE(t.external_id, '') NOT LIKE 'mirror:%' AND COALESCE(t.external_id, '') NOT LIKE 'valo:%' AND COALESCE(t.external_id, '') NOT LIKE 'manual:%'";
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s));

const SCHEMA = {
  from: { type: 'string', description: 'Date de début, format AAAA-MM-JJ.' },
  to: { type: 'string', description: 'Date de fin incluse, format AAAA-MM-JJ (aujourd’hui par défaut).' },
  period: { type: 'string', enum: ['month', 'last_month', '30d', '3m', '6m', '12m', 'ytd'], description: 'Raccourci de période, ignoré si from est donné : month = depuis le début du mois, last_month = mois dernier, ytd = depuis le 1er janvier.' },
  account: { type: 'string', description: 'Compte : identifiant ou partie du nom (« livret », « PEA », « Crédit Agricole »…). Tous les comptes si absent.' },
};

function range(a, def) {
  let to = a.to ?? today();
  if (!isDate(to)) throw new Error('« to » doit être une date AAAA-MM-JJ.');
  if (a.from) { if (!isDate(a.from)) throw new Error('« from » doit être une date AAAA-MM-JJ.'); return { from: a.from, to }; }
  const p = a.period || def;
  const back = { '30d': -30, '3m': -91, '6m': -182, '12m': -365 };
  if (p === 'month') return { from: to.slice(0, 7) + '-01', to };
  if (p === 'ytd') return { from: to.slice(0, 4) + '-01-01', to };
  if (p === 'last_month') {
    const d = new Date(+to.slice(0, 4), +to.slice(5, 7) - 1, 1);
    const last = new Date(d.getFullYear(), d.getMonth(), 0), first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const f = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return { from: f(first), to: f(last) };
  }
  if (back[p]) return { from: addDays(to, back[p]), to };
  throw new Error(`Période inconnue : ${p}`);
}

function accountId(arg) {
  if (arg == null || arg === '' || arg === 'all') return null;
  const accs = L.listAccounts(db);
  if (/^\d+$/.test(String(arg))) { const a = accs.find(x => x.id === Number(arg)); if (a) return a.id; }
  const q = norm(arg), hits = accs.filter(x => norm(`${x.name} ${x.bank}`).includes(q));
  if (hits.length === 1) return hits[0].id;
  throw new Error(`Compte « ${arg} » ${hits.length ? 'ambigu' : 'introuvable'}. Comptes : ${accs.map(x => `${x.id} = ${x.name} (${x.bank})`).join(' ; ')}`);
}

const accountsView = () => L.listAccounts(db).map(a => ({
  id: a.id, bank: a.bank, name: a.name, type: a.type, balance: round2(a.balance), last4: a.last4 || undefined,
  synced_with_bank: Boolean(a.external_id), updated_at: a.updated_at,
  ...(a.type === 'investment' ? { valuation: a.valuation === 'official' ? 'dernière valeur liquidative publiée' : 'estimée en direct', cash: a.cash } : {}),
  ...(a.is_demo ? { demo: true } : {}),
}));

const periodSummary = s => ({ income: s.period.income, expense: s.period.expense, net: s.period.net, savings_rate_pct: s.period.income ? Math.round(s.period.net / s.period.income * 100) : null });

const TOOLS = [
  {
    name: 'get_overview',
    description: 'Vue d’ensemble : date du jour, tous les comptes avec leur solde, total, revenus/dépenses du mois en cours et des 12 derniers mois, et état des connexions bancaires (dernière synchronisation). À appeler en premier.',
    inputSchema: { type: 'object', properties: {} },
    run() {
      const t = today(), accounts = accountsView();
      const month = L.stats(db, { from: t.slice(0, 7) + '-01', to: t, account: 'all' });
      const year = L.stats(db, { from: addDays(t, -365), to: t, account: 'all' });
      return {
        today: t, currency: 'EUR', total_balance: round2(accounts.reduce((s, a) => s + a.balance, 0)), accounts,
        month_to_date: periodSummary(month), last_12_months: periodSummary(year),
        bank_connections: db.prepare('SELECT aspsp_name AS bank, last_sync, valid_until, last_error FROM eb_sessions').all(),
      };
    },
  },
  {
    name: 'list_transactions',
    description: 'Liste des mouvements, filtrables. Les montants négatifs sont des sorties. Renvoie aussi le total des entrées et des sorties sur TOUS les mouvements filtrés, pas seulement ceux listés.',
    inputSchema: { type: 'object', properties: {
      ...SCHEMA,
      category: { type: 'string', description: 'Nom de catégorie (ex. « Courses », « Restaurants »). Voir spending_by_category pour la liste.' },
      query: { type: 'string', description: 'Texte recherché dans le libellé (ex. « Netflix »).' },
      kind: { type: 'string', enum: ['expense', 'income', 'transfer'], description: 'Type de catégorie : dépenses, revenus ou virements entre ses comptes.' },
      min_amount: { type: 'number', description: 'Montant minimum, signé. Ex. : min_amount = 100 pour les entrées de 100 € ou plus.' },
      max_amount: { type: 'number', description: 'Montant maximum, signé. Ex. : max_amount = -100 pour les sorties de 100 € ou plus.' },
      include_hidden: { type: 'boolean', description: 'Inclure les mouvements masqués des statistiques. Faux par défaut (sauf si kind = transfer).' },
      sort: { type: 'string', enum: ['date', 'amount_asc', 'amount_desc'], description: 'date = plus récents d’abord ; amount_asc = plus grosses sorties d’abord ; amount_desc = plus grosses entrées d’abord.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: '50 par défaut, 200 au maximum.' },
    } },
    run(a) {
      const { from, to } = range(a, '30d');
      const where = ['t.date BETWEEN ? AND ?', INTERNAL], args = [from, to];
      const acc = accountId(a.account); if (acc) { where.push('t.account_id = ?'); args.push(acc); }
      if (a.category) { where.push('lower(c.name) LIKE ?'); args.push(`%${norm(a.category)}%`); }
      if (a.kind) { where.push('c.kind = ?'); args.push(a.kind); }
      if (a.query) { where.push('t.label LIKE ?'); args.push(`%${a.query}%`); }
      if (Number.isFinite(a.min_amount)) { where.push('t.amount >= ?'); args.push(a.min_amount); }
      if (Number.isFinite(a.max_amount)) { where.push('t.amount <= ?'); args.push(a.max_amount); }
      if (!a.include_hidden && a.kind !== 'transfer') where.push('t.hidden = 0');
      const w = where.join(' AND ');
      const order = { amount_asc: 't.amount ASC', amount_desc: 't.amount DESC' }[a.sort] || 't.date DESC, t.id DESC';
      const limit = Math.min(Math.max(Math.floor(a.limit) || 50, 1), 200);
      const from_sql = 'FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id';
      const totals = db.prepare(`SELECT COUNT(*) AS count, ROUND(COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0), 2) AS total_in, ROUND(COALESCE(SUM(CASE WHEN t.amount < 0 THEN t.amount END), 0), 2) AS total_out ${from_sql} WHERE ${w}`).get(...args);
      const rows = db.prepare(`SELECT t.date, t.amount, t.label, c.name AS category, c.kind, a.name AS account, a.bank, t.hidden ${from_sql} WHERE ${w} ORDER BY ${order} LIMIT ?`).all(...args, limit);
      return { period: { from, to }, ...totals, shown: rows.length, transactions: rows.map(r => ({ date: r.date, amount: r.amount, label: r.label, merchant: normalizeLabel(r.label), category: r.category, kind: r.kind, account: `${r.account} (${r.bank})`, ...(r.hidden ? { hidden: true } : {}) })) };
    },
  },
  {
    name: 'spending_by_category',
    description: 'Revenus, dépenses et épargne sur une période, et dépenses par catégorie (montants NETS : un remboursement vient en déduction de sa catégorie). Les virements entre ses comptes sont exclus.',
    inputSchema: { type: 'object', properties: { ...SCHEMA } },
    run(a) {
      const { from, to } = range(a, '12m');
      const s = L.stats(db, { from, to, account: accountId(a.account) ?? 'all' });
      const total = s.byCategory.reduce((x, c) => x + c.total, 0) || 1;
      return { period: { from, to }, ...periodSummary(s), by_category: s.byCategory.map(c => ({ category: c.name, total: c.total, share_pct: Math.round(c.total / total * 1000) / 10, transactions: c.n })) };
    },
  },
  {
    name: 'monthly_summary',
    description: 'Revenus, dépenses et taux d’épargne mois par mois (jusqu’à 12 mois, se terminant à la date « to »).',
    inputSchema: { type: 'object', properties: { to: SCHEMA.to, account: SCHEMA.account, months: { type: 'integer', minimum: 1, maximum: 12, description: '12 par défaut.' } } },
    run(a) {
      const to = a.to ?? today(); if (!isDate(to)) throw new Error('« to » doit être une date AAAA-MM-JJ.');
      const s = L.stats(db, { from: addDays(to, -365), to, account: accountId(a.account) ?? 'all' });
      const n = Math.min(Math.max(Math.floor(a.months) || 12, 1), 12);
      return { months: s.monthly.slice(-n).map(m => ({ month: m.month, income: m.income, expense: m.expense, net: round2(m.income - m.expense), savings_rate_pct: m.income ? Math.round((m.income - m.expense) / m.income * 100) : null })) };
    },
  },
  {
    name: 'top_merchants',
    description: 'Les marchands où l’argent part le plus sur une période, avec leur catégorie, le nombre d’opérations et le total dépensé.',
    inputSchema: { type: 'object', properties: { ...SCHEMA, limit: { type: 'integer', minimum: 1, maximum: 30, description: '10 par défaut.' } } },
    run(a) {
      const { from, to } = range(a, '3m');
      const acc = accountId(a.account);
      const rows = db.prepare(`SELECT t.label, t.amount, c.name AS category FROM transactions t JOIN categories c ON c.id = t.category_id
        WHERE t.hidden = 0 AND c.kind = 'expense' AND t.amount < 0 AND t.date BETWEEN ? AND ? AND ${INTERNAL} ${acc ? 'AND t.account_id = ?' : ''}`).all(from, to, ...(acc ? [acc] : []));
      const m = new Map();
      for (const r of rows) { const k = normalizeLabel(r.label) || r.label; const x = m.get(k) || { merchant: k, category: r.category, count: 0, total: 0 }; x.count++; x.total += -r.amount; m.set(k, x); }
      const limit = Math.min(Math.max(Math.floor(a.limit) || 10, 1), 30);
      return { period: { from, to }, merchants: [...m.values()].sort((x, y) => y.total - x.total).slice(0, limit).map(x => ({ ...x, total: round2(x.total) })) };
    },
  },
  {
    name: 'balance_history',
    description: 'Évolution du solde d’un compte (ou du total) sur une période, avec le point le plus bas et le plus haut. Au plus 60 points.',
    inputSchema: { type: 'object', properties: { ...SCHEMA } },
    run(a) {
      const { from, to } = range(a, '6m');
      const pts = L.balanceSeries(db, { from, to, account: accountId(a.account) ?? 'all' }).points;
      const step = Math.max(1, Math.ceil(pts.length / 60));
      const sample = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
      const min = pts.reduce((m, p) => (p[1] < m[1] ? p : m), pts[0]), max = pts.reduce((m, p) => (p[1] > m[1] ? p : m), pts[0]);
      return { period: { from, to }, start: pts[0], end: pts.at(-1), lowest: min, highest: max, points: sample.map(([date, balance]) => ({ date, balance })) };
    },
  },
  {
    name: 'forecast',
    description: 'Prévision du solde pour les prochains jours : mouvements récurrents prévus (loyer, abonnements, salaire…) plus une estimation des dépenses courantes. Renvoie le solde de fin de mois, le point le plus bas et les prochaines échéances.',
    inputSchema: { type: 'object', properties: { account: SCHEMA.account, days: { type: 'integer', minimum: 1, maximum: 365, description: '90 par défaut.' } } },
    run(a) {
      const days = Math.min(Math.max(Math.floor(a.days) || 90, 1), 365);
      const f = L.forecast(db, { days, account: accountId(a.account) ?? 'all' });
      return { horizon_days: days, start_balance: f.start, end_balance: f.end, month_end_balance: f.monthEnd, lowest_point: f.min, estimated_daily_variable_spending: f.dailyVariable, upcoming: f.items.slice(0, 40).map(i => ({ date: i.date, label: i.label, amount: i.amount, category: i.category })) };
    },
  },
  {
    name: 'recurring_and_subscriptions',
    description: 'Mouvements récurrents déclarés (loyer, salaire, abonnements…) avec leur coût mensuel, et abonnements détectés automatiquement qui ne sont pas encore déclarés.',
    inputSchema: { type: 'object', properties: {} },
    run() {
      const rec = L.listRecurring(db);
      const active = rec.filter(r => r.active);
      return {
        declared: rec.map(r => ({ label: r.label, amount: r.amount, frequency: r.frequency, day: r.day, next: r.next, monthly_cost: r.monthly, category: r.category, account: r.account_name ? `${r.account_name} (${r.bank})` : null, active: Boolean(r.active) })),
        monthly_fixed_costs: round2(-active.filter(r => r.amount < 0).reduce((s, r) => s + r.monthly, 0)),
        monthly_fixed_income: round2(active.filter(r => r.amount > 0).reduce((s, r) => s + r.monthly, 0)),
        detected_not_declared: L.suggestRecurring(db).map(s => ({ merchant: s.key, amount: s.amount, usual_day_of_month: s.day, seen_times: s.count, last_seen: s.last, category: s.category })),
      };
    },
  },
  {
    name: 'get_portfolio',
    description: 'Comptes de placement (PEA…) : lignes, parts, montant investi, valeur liquidative officielle et valeur estimée en direct, plus-value. La valeur officielle a quelques jours de retard ; l’estimation suit l’ETF répliqué.',
    inputSchema: { type: 'object', properties: {} },
    run() {
      const accs = db.prepare('SELECT * FROM accounts WHERE id IN (SELECT DISTINCT account_id FROM positions)').all();
      if (!accs.length) return { message: 'Aucun compte de placement avec des lignes dans Freenary.' };
      return {
        portfolios: accs.map(acc => {
          const lines = db.prepare('SELECT * FROM positions WHERE account_id = ? ORDER BY id').all(acc.id).map(p => {
            const lp = livePrice(db, p);
            const official = lp ? p.quantity * lp.official : null, live = lp ? p.quantity * lp.price : null;
            return { name: p.name, isin: p.isin, quantity: p.quantity, invested: p.cost, official_price: lp ? round2(lp.official) : null, official_price_date: lp?.officialDate, value_official: official == null ? null : round2(official), value_estimated_live: live == null ? null : round2(live), gain_official_pct: official != null && p.cost ? Math.round((official / p.cost - 1) * 1000) / 10 : null, share_of_new_deposits_pct: p.alloc };
          });
          const sum = k => round2(lines.reduce((s, l) => s + (l[k] ?? 0), 0) + (k === 'invested' ? 0 : acc.cash));
          return { account: `${acc.name} (${acc.bank})`, displayed_in_freenary: acc.valuation === 'official' ? 'valeur officielle' : 'estimation en direct', cash: acc.cash, total_invested: round2(lines.reduce((s, l) => s + (l.invested ?? 0), 0)), total_official: sum('value_official'), total_estimated_live: sum('value_estimated_live'), lines };
        }),
      };
    },
  },
  {
    name: 'internal_transfers',
    description: 'Virements entre les comptes de l’utilisateur (masqués des statistiques), regroupés par compte, sens et libellé, avec les liens qui alimentent automatiquement ses livrets et son PEA. Utile pour comprendre d’où vient et où va l’argent.',
    inputSchema: { type: 'object', properties: { ...SCHEMA } },
    run(a) {
      const { from, to } = range(a, '12m');
      const acc = accountId(a.account);
      const rows = db.prepare(`SELECT t.date, t.amount, t.label, a.name AS account, a.bank FROM transactions t JOIN categories c ON c.id = t.category_id JOIN accounts a ON a.id = t.account_id
        WHERE c.kind = 'transfer' AND t.date BETWEEN ? AND ? AND ${INTERNAL} ${acc ? 'AND t.account_id = ?' : ''}`).all(from, to, ...(acc ? [acc] : []));
      const g = new Map();
      for (const r of rows) {
        const dir = r.amount < 0 ? 'sortant' : 'entrant', k = `${r.account}|${dir}|${normalizeLabel(r.label)}`;
        const x = g.get(k) || { account: `${r.account} (${r.bank})`, direction: dir, label: normalizeLabel(r.label), count: 0, total: 0, first: r.date, last: r.date };
        x.count++; x.total += r.amount; if (r.date < x.first) x.first = r.date; if (r.date > x.last) x.last = r.date; g.set(k, x);
      }
      return {
        period: { from, to },
        groups: [...g.values()].sort((x, y) => y.count - x.count).slice(0, 40).map(x => ({ ...x, total: round2(x.total) })),
        automatic_links: db.prepare(`SELECT m.name AS savings_account, s.name AS source_account, s.bank AS source_bank, l.pattern, l.direction, l.since FROM account_links l JOIN accounts m ON m.id = l.manual_account_id JOIN accounts s ON s.id = l.source_account_id`).all(),
      };
    },
  },
];

/* ───────────── Protocole MCP (JSON-RPC 2.0, un message JSON par ligne) ───────────── */

const INSTRUCTIONS = [
  'Freenary donne accès, en lecture seule, aux finances personnelles de l’utilisateur (comptes, mouvements, prévisions, PEA). Commence par get_overview.',
  'Conventions : montants en euros ; négatif = sortie d’argent, positif = entrée. Les virements entre ses propres comptes (catégorie « Virements internes ») sont masqués des statistiques : ce ne sont ni des revenus ni des dépenses. Les dépenses par catégorie sont nettes des remboursements.',
  'La valeur d’un PEA est soit la dernière valeur liquidative publiée (officielle, avec quelques jours de retard), soit une estimation en direct : précise toujours laquelle tu cites.',
  'Les banques se synchronisent toutes les 6 heures : vérifie bank_connections.last_sync avant d’affirmer qu’un mouvement n’existe pas.',
  'Ces données sont confidentielles : ne cite que ce qui est nécessaire pour répondre. Tu peux analyser, comparer et signaler des anomalies, mais tu n’es pas conseiller financier : pas de recommandation d’achat ou de vente de placements. Réponds en français.',
  'Si la conversation est vocale : réponds en phrases courtes et naturelles, sans tableau ni liste ni symboles, avec des montants arrondis à l’euro (« environ deux cent quarante euros »), donne d’abord la réponse puis seulement les détails utiles, et propose d’approfondir.',
].join('\n');

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

function callTool(params) {
  const tool = TOOLS.find(t => t.name === params?.name);
  if (!tool) throw Object.assign(new Error(`Outil inconnu : ${params?.name}`), { rpc: -32602 });
  try {
    let text = JSON.stringify(tool.run(params.arguments || {}));
    if (text.length > 60_000) text = text.slice(0, 60_000) + '…[tronqué : affine les filtres]';
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: e.message }] }; // erreur d'usage (filtre invalide…) : le modèle peut corriger et réessayer
  }
}

function handle(msg) {
  const { id, method, params } = msg;
  if (method === undefined) return;                  // réponse d'un client : rien à faire
  if (id === undefined) return;                      // notification (initialized, cancelled…) : pas de réponse
  try {
    switch (method) {
      case 'initialize': return ok(id, { protocolVersion: SUPPORTED.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'freenary', title: 'Freenary', version: VERSION }, instructions: INSTRUCTIONS });
      case 'ping': return ok(id, {});
      case 'tools/list': return ok(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } })) });
      case 'tools/call': return ok(id, callTool(params));
      default: return fail(id, -32601, `Méthode inconnue : ${method}`);
    }
  } catch (e) { return fail(id, e.rpc || -32603, e.message); }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { fail(null, -32700, 'JSON invalide'); continue; }
    for (const m of Array.isArray(msg) ? msg : [msg]) handle(m);
  }
});
process.stdin.on('end', () => process.exit(0));
log(`prêt (lecture seule) — ${DB_FILE}`);
