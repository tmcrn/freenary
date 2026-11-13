// Logique métier : mouvements, séries de solde, statistiques, prévisions, import CSV.
import { today, addDays, parseDate, fmtDate, daysInMonth, round2, normalizeLabel } from './util.js';
import { forgetMirrors, forgetAccountMirrors } from './portfolio.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });
const accId = a => (a && a !== 'all' ? Number(a) : null);

/* ───────────── Comptes & catégories ───────────── */

export const listAccounts = db => db.prepare('SELECT * FROM accounts ORDER BY is_demo, bank, type, id').all();
export const listCategories = db => db.prepare("SELECT * FROM categories ORDER BY CASE kind WHEN 'income' THEN 0 WHEN 'expense' THEN 1 ELSE 2 END, name").all();

/* ───── Comptes suivis à la main (livrets, PEA…) : la DSP2 ne couvre que les comptes de paiement ───── */

const MANUAL_COLORS = { savings: '#A9DDBD,#C9EBD5', investment: '#C3B4EA,#DAD0F3' };

function adjustmentCategory(db) {
  db.prepare("INSERT OR IGNORE INTO categories(name, icon, color, kind) VALUES ('Mise à jour de solde', '⚖️', '#DCD5CA', 'transfer')").run();
  return db.prepare("SELECT id FROM categories WHERE name = 'Mise à jour de solde'").get().id;
}

export function createManualAccount(db, body) {
  const bank = String(body.bank || '').trim(), name = String(body.name || '').trim();
  const type = body.type === 'investment' ? 'investment' : 'savings';
  const balance = Number(body.balance);
  if (!bank || !name) throw httpError(400, 'Indique la banque et le nom du compte.');
  if (!Number.isFinite(balance)) throw httpError(400, 'Solde invalide.');
  const r = db.prepare('INSERT INTO accounts(bank, name, type, balance, colors, updated_at) VALUES (?,?,?,?,?,?)')
    .run(bank, name, type, balance, MANUAL_COLORS[type], new Date().toISOString());
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(r.lastInsertRowid));
}

export function updateAccount(db, id, body) {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!acc) throw httpError(404, 'Compte introuvable');
  if (body.balance != null && body.balance !== '') {
    const next = Number(body.balance);
    if (!Number.isFinite(next)) throw httpError(400, 'Solde invalide.');
    if (acc.external_id) throw httpError(400, 'Ce compte est synchronisé avec ta banque : son solde se met à jour tout seul.');
    if (db.prepare('SELECT COUNT(*) AS n FROM positions WHERE account_id = ?').get(id)?.n) throw httpError(400, 'Ce compte est valorisé à partir de ses lignes : modifie les parts ou les espèces dans « Positions ».');
    const delta = Math.round((next - acc.balance) * 100) / 100;
    if (delta) {
      // L'écart devient un mouvement masqué daté d'aujourd'hui : la courbe de solde reste juste,
      // et les statistiques (revenus, dépenses) ne sont pas faussées.
      db.prepare('INSERT INTO transactions(account_id, date, label, amount, category_id, hidden, external_id) VALUES (?,?,?,?,?,1,?)')
        .run(id, today(), acc.type === 'investment' ? 'Mise à jour de la valorisation' : 'Mise à jour du solde', delta, adjustmentCategory(db), `manual:${Date.now()}`);
    }
    db.prepare('UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?').run(next, new Date().toISOString(), id);
  }
  if (body.name) db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(String(body.name), id);
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

export function deleteManualAccount(db, id) {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!acc) throw httpError(404, 'Compte introuvable');
  if (acc.external_id) throw httpError(400, 'Ce compte vient de ta banque : déconnecte la banque à la place.');
  forgetAccountMirrors(db, id);
  db.prepare('DELETE FROM recurring WHERE account_id = ?').run(id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  return { ok: true };
}

export function clearDemo(db) {
  const ids = db.prepare('SELECT id FROM accounts WHERE is_demo = 1').all().map(r => r.id);
  for (const id of ids) {
    forgetAccountMirrors(db, id);
    db.prepare('DELETE FROM recurring WHERE account_id = ?').run(id);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  }
  return { removed: ids.length };
}

/* ───────────── Règles d'auto-catégorisation ───────────── */

// Un motif doit correspondre à des mots entiers : « AXA » ne doit pas matcher « TAXATION », ni « ALDI » « VALDIVIA ».
const wordRegex = p => {
  const t = String(p).trim().toUpperCase();
  return t ? new RegExp(`(^|[^A-Z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9]|$)`) : null;
};

export function categorizer(db) {
  // priorité d'abord (ex. SALAIRE passe avant ton propre nom), puis le motif le plus long
  const rules = db.prepare('SELECT pattern, category_id, priority FROM rules').all()
    .sort((a, b) => (b.priority - a.priority) || (b.pattern.length - a.pattern.length))
    .map(r => ({ ...r, re: wordRegex(r.pattern) })).filter(r => r.re);
  const fallback = db.prepare("SELECT id FROM categories WHERE name = 'Divers'").get()?.id ?? null;
  return (label, amount) => {
    const key = normalizeLabel(label);
    const raw = String(label).toUpperCase();
    const hit = rules.find(r => r.re.test(key) || r.re.test(raw));
    if (hit) return hit.category_id;
    if (amount > 0) return db.prepare("SELECT id FROM categories WHERE name = 'Autres revenus'").get()?.id ?? fallback;
    return fallback;
  };
}

/* ───────────── Mouvements ───────────── */

export function listTransactions(db, q) {
  const where = [], args = [];
  if (q.from) { where.push('t.date >= ?'); args.push(q.from); }
  if (q.to) { where.push('t.date <= ?'); args.push(q.to); }
  const acc = accId(q.account); if (acc) { where.push('t.account_id = ?'); args.push(acc); }
  if (q.category) { where.push('t.category_id = ?'); args.push(Number(q.category)); }
  if (q.hidden === 'only') where.push('t.hidden = 1');
  else if (q.hidden !== 'include') where.push('t.hidden = 0');
  if (q.q) { where.push('(t.label LIKE ? OR t.note LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Number(q.limit) || 300, 3000), offset = Number(q.offset) || 0;
  const rows = db.prepare(`
    SELECT t.*, c.name AS category, c.icon, c.color, c.kind, a.bank, a.name AS account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    JOIN accounts a ON a.id = t.account_id
    ${w} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  const totals = db.prepare(`
    SELECT COUNT(*) AS n,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS inflow,
      COALESCE(SUM(CASE WHEN amount < 0 THEN amount END), 0) AS outflow
    FROM transactions t ${w}`).get(...args);
  return { rows: rows.map(r => ({ ...r, key: normalizeLabel(r.label) })), totals };
}

/** Un mouvement qui entre/sort d'une catégorie « virement » est masqué/réaffiché, comme à la synchronisation. */
function hiddenAfterRecategorize(db, oldCat, newCat, hidden) {
  const kind = c => db.prepare('SELECT kind FROM categories WHERE id = ?').get(c)?.kind;
  const was = kind(oldCat) === 'transfer', now = kind(newCat) === 'transfer';
  if (!was && now) return 1;
  if (was && !now) return 0;
  return hidden;
}

export function updateTransaction(db, id, body) {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!tx) throw httpError(404, 'Mouvement introuvable');
  if ('hidden' in body) db.prepare('UPDATE transactions SET hidden = ? WHERE id = ?').run(body.hidden ? 1 : 0, id);
  if ('note' in body) db.prepare('UPDATE transactions SET note = ? WHERE id = ?').run(body.note || null, id);
  let affected = 1;
  if (body.category_id) {
    const cat = Number(body.category_id);
    const hiddenSet = db.prepare('UPDATE transactions SET category_id = ?, hidden = ? WHERE id = ?');
    // si l'appelant fixe `hidden` lui-même, on respecte son choix
    hiddenSet.run(cat, 'hidden' in body ? (body.hidden ? 1 : 0) : hiddenAfterRecategorize(db, tx.category_id, cat, tx.hidden), id);
    if (body.applyToSimilar) {
      const key = normalizeLabel(tx.label);
      if (key) {
        db.prepare('INSERT INTO rules(pattern, category_id) VALUES (?, ?) ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id').run(key, cat);
        for (const r of db.prepare('SELECT id, label, category_id, hidden FROM transactions WHERE id != ?').all(id)) {
          if (normalizeLabel(r.label) === key) { hiddenSet.run(cat, hiddenAfterRecategorize(db, r.category_id, cat, r.hidden), r.id); affected++; }
        }
      }
    }
  }
  return { ok: true, affected };
}

/* ───────────── Série de solde (reconstruite à rebours) ───────────── */

export function balanceSeries(db, q) {
  const t = today();
  const from = q.from || addDays(t, -182);
  const to = q.to && q.to < t ? q.to : t;
  const acc = accId(q.account);
  const current = acc
    ? db.prepare('SELECT balance FROM accounts WHERE id = ?').get(acc)?.balance ?? 0
    : db.prepare('SELECT COALESCE(SUM(balance), 0) AS s FROM accounts').get().s;
  const rows = db.prepare(`SELECT date, SUM(amount) AS s FROM transactions WHERE date > ? ${acc ? 'AND account_id = ?' : ''} GROUP BY date`)
    .all(...(acc ? [from, acc] : [from]));
  const byDate = new Map(rows.map(r => [r.date, r.s]));
  const points = [];
  let bal = current;
  for (let d = t; d >= from; d = addDays(d, -1)) {
    if (d <= to) points.push([d, round2(bal)]);
    bal -= byDate.get(d) || 0; // solde de fin de journée de la veille
  }
  return { points: points.reverse() };
}

/* ───────────── Statistiques ───────────── */

export function stats(db, q) {
  const t = today();
  const from = q.from || addDays(t, -182), to = q.to || t;
  const acc = accId(q.account);
  const accSql = acc ? 'AND t.account_id = ?' : '';
  const accArg = acc ? [acc] : [];
  const base = `FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.hidden = 0 AND c.kind != 'transfer' ${accSql}`;

  // Revenus = catégories de revenus. Dépenses = montant NET des catégories de dépenses :
  // un remboursement, un gain ou une participation vient en déduction de sa catégorie.
  const period = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN c.kind = 'income' THEN t.amount END), 0) AS income,
      COALESCE(-SUM(CASE WHEN c.kind = 'expense' THEN t.amount END), 0) AS expense,
      COUNT(*) AS n
    ${base} AND t.date BETWEEN ? AND ?`).get(...accArg, from, to);
  period.net = round2(period.income - period.expense);
  period.income = round2(period.income); period.expense = round2(period.expense);

  const byCategory = db.prepare(`SELECT c.id, c.name, c.icon, c.color, ROUND(-SUM(t.amount), 2) AS total, COUNT(*) AS n
    ${base} AND c.kind = 'expense' AND t.date BETWEEN ? AND ? GROUP BY c.id HAVING total > 0 ORDER BY total DESC`).all(...accArg, from, to);

  // 12 derniers mois glissants jusqu'à « to »
  const end = parseDate(to);
  const months = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(end.getFullYear(), end.getMonth() - i, 1); months.push(fmtDate(d).slice(0, 7)); }
  const mRows = db.prepare(`SELECT substr(t.date, 1, 7) AS m,
      COALESCE(SUM(CASE WHEN c.kind = 'income' THEN t.amount END), 0) AS income,
      COALESCE(-SUM(CASE WHEN c.kind = 'expense' THEN t.amount END), 0) AS expense
    ${base} AND t.date >= ? AND t.date <= ? GROUP BY m`).all(...accArg, months[0] + '-01', to);
  const mMap = new Map(mRows.map(r => [r.m, r]));
  const monthly = months.map(m => ({ month: m, income: round2(mMap.get(m)?.income || 0), expense: round2(mMap.get(m)?.expense || 0) }));

  // Top marchands
  const merch = new Map();
  for (const r of db.prepare(`SELECT t.label, t.amount, c.icon, c.color, c.name AS category ${base} AND t.amount < 0 AND t.date BETWEEN ? AND ?`).all(...accArg, from, to)) {
    const key = normalizeLabel(r.label);
    const m = merch.get(key) || { key, total: 0, n: 0, icon: r.icon, color: r.color, category: r.category };
    m.total += -r.amount; m.n++; merch.set(key, m);
  }
  const topMerchants = [...merch.values()].sort((a, b) => b.total - a.total).slice(0, 8).map(m => ({ ...m, total: round2(m.total) }));

  return { from, to, period, byCategory, monthly, topMerchants };
}

/* ───────────── Mouvements prévus ───────────── */

const FREQ_FACTOR = { monthly: 1, weekly: 52 / 12, yearly: 1 / 12 };

export function occurrences(r, from, to) {
  const out = [];
  if (r.frequency === 'monthly') {
    let [y, m] = from.split('-').map(Number);
    for (let i = 0; i < 60; i++) {
      const d = fmtDate(new Date(y, m - 1, Math.min(r.day || 1, daysInMonth(y, m))));
      if (d > to) break;
      if (d >= from) out.push(d);
      if (++m > 12) { m = 1; y++; }
    }
  } else if (r.frequency === 'weekly') {
    const wd = Number(r.day ?? 1);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) return out; // jour invalide : jamais de boucle infinie
    let d = from;
    while (parseDate(d).getDay() !== wd) d = addDays(d, 1);
    for (; d <= to; d = addDays(d, 7)) out.push(d);
  } else if (r.frequency === 'yearly') {
    const ref = parseDate(r.start_date || from);
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
      const d = fmtDate(new Date(y, ref.getMonth(), Math.min(ref.getDate(), daysInMonth(y, ref.getMonth() + 1))));
      if (d >= from && d <= to) out.push(d);
    }
  }
  return out;
}

export function listRecurring(db) {
  const t = today();
  return db.prepare(`SELECT r.*, c.name AS category, c.icon, c.color, a.bank, a.name AS account_name
    FROM recurring r LEFT JOIN categories c ON c.id = r.category_id LEFT JOIN accounts a ON a.id = r.account_id
    ORDER BY r.amount > 0 DESC, ABS(r.amount) DESC`).all()
    .map(r => ({ ...r, next: occurrences(r, addDays(t, 1), addDays(t, 400))[0] || null, monthly: round2(r.amount * (FREQ_FACTOR[r.frequency] || 1)) }));
}

function cleanRecurring(body, partial = false, existingFrequency = null) {
  const out = {};
  if (!partial || 'label' in body) { out.label = String(body.label || '').trim(); if (!out.label) throw httpError(400, 'Libellé requis'); }
  if (!partial || 'amount' in body) { out.amount = Number(body.amount); if (!Number.isFinite(out.amount) || !out.amount) throw httpError(400, 'Montant invalide'); }
  if (!partial || 'frequency' in body) { out.frequency = body.frequency || 'monthly'; if (!FREQ_FACTOR[out.frequency]) throw httpError(400, 'Fréquence invalide'); }
  for (const k of ['day', 'category_id', 'account_id']) if (k in body) out[k] = body[k] == null || body[k] === '' ? null : Number(body[k]);
  if (out.day != null) {
    const freq = out.frequency ?? existingFrequency ?? 'monthly';
    const [lo, hi] = freq === 'weekly' ? [0, 6] : [1, 31];
    if (!Number.isInteger(out.day) || out.day < lo || out.day > hi) throw httpError(400, freq === 'weekly' ? 'Jour de la semaine invalide (0 à 6).' : 'Jour du mois invalide (1 à 31).');
  }
  if ('start_date' in body) out.start_date = body.start_date || null;
  if ('active' in body) out.active = body.active ? 1 : 0;
  if ('pattern' in body || 'label' in body) out.pattern = body.pattern ? String(body.pattern) : normalizeLabel(out.label ?? body.label);
  return out;
}

export function createRecurring(db, body) {
  const r = cleanRecurring(body);
  if (!r.start_date) r.start_date = today();
  const keys = Object.keys(r);
  const res = db.prepare(`INSERT INTO recurring(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => r[k]));
  return { id: Number(res.lastInsertRowid) };
}

export function updateRecurring(db, id, body) {
  const cur = db.prepare('SELECT frequency FROM recurring WHERE id = ?').get(id);
  if (!cur) throw httpError(404, 'Prévision introuvable');
  const r = cleanRecurring(body, true, cur.frequency);
  const keys = Object.keys(r);
  if (keys.length) db.prepare(`UPDATE recurring SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => r[k]), id);
  return { ok: true };
}

export const deleteRecurring = (db, id) => (db.prepare('DELETE FROM recurring WHERE id = ?').run(id), { ok: true });

export function forecast(db, q) {
  const t = today();
  const days = Math.min(Number(q.days) || 90, 730);
  const acc = accId(q.account);
  const start = acc
    ? db.prepare('SELECT balance FROM accounts WHERE id = ?').get(acc)?.balance ?? 0
    : db.prepare('SELECT COALESCE(SUM(balance), 0) AS s FROM accounts').get().s;
  const from = addDays(t, 1), to = addDays(t, days);
  const items = [];
  for (const r of listRecurring(db)) {
    if (!r.active || (acc && r.account_id !== acc)) continue;
    for (const date of occurrences(r, from, to)) items.push({ date, label: r.label, amount: r.amount, icon: r.icon, color: r.color, category: r.category, recurring_id: r.id, account_id: r.account_id });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);

  // Dépenses courantes non planifiées (courses, restos…) : moyenne quotidienne des 90 derniers jours,
  // hors mouvements déjà couverts par une prévision, hors masqués et virements internes.
  let dailyVariable = 0;
  if (q.variable !== '0') {
    const patterns = db.prepare('SELECT pattern FROM recurring WHERE active = 1').all().map(r => r.pattern).filter(Boolean);
    const rows = db.prepare(`SELECT t.label, t.amount FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.hidden = 0 AND c.kind = 'expense' AND t.date > ? ${acc ? 'AND t.account_id = ?' : ''}`).all(...(acc ? [addDays(t, -90), acc] : [addDays(t, -90)]));
    const sum = rows.filter(r => { const k = normalizeLabel(r.label); return !patterns.some(p => k.includes(p)); }).reduce((s, r) => s + r.amount, 0);
    dailyVariable = sum / 90;
  }
  const byDate = new Map();
  for (const it of items) byDate.set(it.date, (byDate.get(it.date) || 0) + it.amount);
  const points = [[t, round2(start)]];
  let bal = start, min = { date: t, value: start };
  const [y, m] = t.split('-').map(Number);
  const monthEndDate = fmtDate(new Date(y, m, 0));
  let monthEnd = start;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    bal += (byDate.get(d) || 0) + dailyVariable;
    points.push([d, round2(bal)]);
    if (bal < min.value) min = { date: d, value: round2(bal) };
    if (d === monthEndDate) monthEnd = bal;
  }
  if (monthEndDate === t) monthEnd = start;
  return { start: round2(start), end: round2(bal), monthEnd: round2(monthEnd), min, items, points, dailyVariable: round2(dailyVariable) };
}

/** Repère les dépenses qui reviennent chaque mois avec un montant stable et qui ne sont pas encore prévues. */
export function suggestRecurring(db) {
  const since = addDays(today(), -200);
  const known = db.prepare('SELECT pattern, label FROM recurring').all().map(r => r.pattern || normalizeLabel(r.label)).filter(Boolean);
  const groups = new Map();
  for (const r of db.prepare('SELECT * FROM transactions WHERE date >= ? AND amount < 0 AND hidden = 0').all(since)) {
    const key = normalizeLabel(r.label);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const cats = new Map(db.prepare('SELECT * FROM categories').all().map(c => [c.id, c]));
  const out = [];
  for (const [key, list] of groups) {
    if (known.some(p => key.includes(p) || p.includes(key))) continue;
    const months = new Set(list.map(r => r.date.slice(0, 7)));
    if (months.size < 3 || list.length / months.size > 1.4) continue;
    const avg = list.reduce((s, r) => s + r.amount, 0) / list.length;
    const maxDev = Math.max(...list.map(r => Math.abs(r.amount - avg) / Math.abs(avg)));
    if (maxDev > 0.15) continue;
    const daysOfMonth = list.map(r => Number(r.date.slice(8, 10))).sort((a, b) => a - b);
    const catCount = {}; for (const r of list) catCount[r.category_id] = (catCount[r.category_id] || 0) + 1;
    const category_id = Number(Object.entries(catCount).sort((a, b) => b[1] - a[1])[0][0]);
    const c = cats.get(category_id) || {};
    out.push({ key, amount: round2(avg), day: daysOfMonth[Math.floor(daysOfMonth.length / 2)], category_id, account_id: list[0].account_id, count: list.length, last: list.map(r => r.date).sort().at(-1), icon: c.icon, color: c.color, category: c.name });
  }
  return out.sort((a, b) => a.amount - b.amount);
}

/* ───────────── Import CSV (exports Crédit Agricole, BoursoBank, génériques) ───────────── */

function parseCsvText(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/).find(l => /date/i.test(l)) || text.split(/\r?\n/)[0];
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur.trim()); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur.trim()); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur.trim()); rows.push(row); }
  return rows.filter(r => r.some(c => c));
}

const toNumber = s => {
  if (s == null || s === '') return null;
  let v = String(s).replace(/[\s\u00a0\u202f€]/g, '').replace(/EUR/i, '');
  const comma = v.lastIndexOf(','), dot = v.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) v = comma > dot ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, ''); // « 1.234,56 » ou « 1,234.56 »
  else if (comma >= 0) v = v.replace(',', '.');                                                          // « 12,50 »
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toIsoDate = s => {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};

export function importCsv(db, body) {
  const accountId = Number(body.account_id);
  const target = db.prepare('SELECT id, external_id FROM accounts WHERE id = ?').get(accountId);
  if (!target) throw httpError(400, 'Compte inconnu');
  if (target.external_id) throw httpError(400, 'Ce compte est synchronisé avec ta banque : importer un CSV recréerait tous ses mouvements en double.');
  const rows = parseCsvText(String(body.csv || ''));
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hi = rows.findIndex(r => r.some(c => /date/i.test(c)) && r.length >= 3);
  if (hi < 0) throw httpError(400, 'En-tête introuvable : le fichier doit contenir une colonne « Date ».');
  const header = rows[hi].map(norm);
  const col = re => header.findIndex(h => re.test(h));
  const iDate = col(/date/);
  const iLabel = col(/libelle|label|description|intitule|operation/);
  const iAmount = col(/^montant|amount/);
  const iDebit = col(/debit/), iCredit = col(/credit/);
  if (iLabel < 0 || (iAmount < 0 && iDebit < 0 && iCredit < 0)) throw httpError(400, 'Colonnes « Libellé » et « Montant » (ou Débit/Crédit) introuvables.');

  const categorize = categorizer(db);
  const ins = db.prepare('INSERT OR IGNORE INTO transactions(account_id, date, label, amount, category_id, external_id) VALUES (?,?,?,?,?,?)');
  const seen = new Map();
  let inserted = 0, skipped = 0, invalid = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows.slice(hi + 1)) {
      const date = toIsoDate(r[iDate]);
      const label = (r[iLabel] || '').replace(/\s+/g, ' ').trim();
      let amount = iAmount >= 0 ? toNumber(r[iAmount]) : null;
      if (amount == null) {
        const d = iDebit >= 0 ? toNumber(r[iDebit]) : null, c = iCredit >= 0 ? toNumber(r[iCredit]) : null;
        if (d != null || c != null) amount = (c || 0) - Math.abs(d || 0);
      }
      if (!date || !label || amount == null) { invalid++; continue; }
      const base = `csv:${date}|${label}|${amount}`;
      const k = (seen.get(base) || 0) + 1; seen.set(base, k);
      const res = ins.run(accountId, date, label, round2(amount), categorize(label, amount), `${base}|${k}`);
      if (res.changes) inserted++; else skipped++;
    }
    if (body.balance != null && body.balance !== '') db.prepare('UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?').run(Number(body.balance), new Date().toISOString(), accountId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { inserted, skipped, invalid };
}

/* ───────── Virements liés : un virement depuis un compte synchronisé met à jour un compte suivi à la main ─────────
   Exemple : « VIREMENT EMIS WEB … PEA » de −200 € sur le compte courant ⇒ +200 € sur le PEA.
   Chaque virement reporté devient un mouvement masqué du compte manuel (external_id « mirror:<id source> »),
   ce qui rend l'opération idempotente et garde la courbe de solde juste. */

function transferCategory(db) {
  return db.prepare("SELECT id FROM categories WHERE name = 'Virements internes'").get()?.id ?? adjustmentCategory(db);
}

/** Groupes de virements candidats sur les comptes synchronisés (virements internes, ou libellé évoquant l'épargne). */
export function linkCandidates(db, manualId) {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(manualId);
  if (!acc || acc.external_id) throw httpError(400, 'Seuls les comptes suivis à la main peuvent être liés.');
  const linked = new Set(db.prepare('SELECT source_account_id, pattern, direction FROM account_links WHERE manual_account_id = ?').all(manualId).map(r => `${r.source_account_id}|${r.pattern}|${r.direction}`));
  const rows = db.prepare(`SELECT t.account_id, t.date, t.label, t.amount, a.bank, a.name AS account_name, c.kind
    FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN categories c ON c.id = t.category_id
    WHERE a.external_id IS NOT NULL`).all();
  const saving = /EPARGNE|PEA\b|LIVRET|LDDS?\b|LEP\b|\bPEL\b|\bCEL\b|ASSURANCE.VIE/;
  const groups = new Map();
  for (const r of rows) {
    const key = normalizeLabel(r.label);
    if (r.kind !== 'transfer' && !saving.test(key)) continue;
    const direction = r.amount < 0 ? 'out' : 'in';
    const k = `${r.account_id}|${key}|${direction}`;
    const g = groups.get(k) || { source_account_id: r.account_id, pattern: key, direction, bank: r.bank, account_name: r.account_name, example: r.label, n: 0, out: 0, in: 0, last: r.date, saving: saving.test(key), linked: linked.has(k) };
    g.n++; if (r.amount < 0) g.out += -r.amount; else g.in += r.amount;
    if (r.date > g.last) { g.last = r.date; g.example = r.label; }
    groups.set(k, g);
  }
  return [...groups.values()]
    .map(g => ({ ...g, out: round2(g.out), in: round2(g.in) }))
    .sort((a, b) => (b.linked - a.linked) || (b.saving - a.saving) || b.n - a.n);
}

export function listLinks(db, manualId) {
  return db.prepare(`SELECT l.*, a.bank, a.name AS account_name,
      (SELECT COUNT(*) FROM transactions m WHERE m.account_id = l.manual_account_id AND m.external_id LIKE 'mirror:%' AND m.note = l.id) AS applied
    FROM account_links l JOIN accounts a ON a.id = l.source_account_id WHERE l.manual_account_id = ? ORDER BY l.id`).all(manualId);
}

export function setLinks(db, manualId, body) {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(manualId);
  if (!acc || acc.external_id) throw httpError(400, 'Seuls les comptes suivis à la main peuvent être liés.');
  const wanted = (body.links || []).map(l => ({ source: Number(l.source_account_id), pattern: String(l.pattern || ''), direction: l.direction === 'in' ? 'in' : 'out' })).filter(l => l.source && l.pattern);
  // Les virements déjà passés sont inclus dans le solde que tu as saisi : on ne reporte que ceux d'après.
  const since = (acc.updated_at || new Date().toISOString()).slice(0, 10);
  db.exec('BEGIN');
  try {
    const keep = new Set(wanted.map(l => `${l.source}|${l.pattern}|${l.direction}`));
    for (const l of db.prepare('SELECT * FROM account_links WHERE manual_account_id = ?').all(manualId)) {
      if (!keep.has(`${l.source_account_id}|${l.pattern}|${l.direction}`)) unlink(db, l);
    }
    const ins = db.prepare('INSERT OR IGNORE INTO account_links(manual_account_id, source_account_id, pattern, since, direction) VALUES (?,?,?,?,?)');
    for (const l of wanted) ins.run(manualId, l.source, l.pattern, since, l.direction);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const applied = applyLinks(db, manualId);
  return { links: listLinks(db, manualId), applied };
}

function unlink(db, link) {
  // Retire les reports faits par ce lien et corrige le solde en conséquence
  const mirrored = db.prepare("SELECT id, amount FROM transactions WHERE account_id = ? AND external_id LIKE 'mirror:%' AND note = ?").all(link.manual_account_id, String(link.id));
  const total = mirrored.reduce((s, r) => s + r.amount, 0);
  forgetMirrors(db, link.manual_account_id, mirrored.map(r => r.id)); // annule aussi les parts achetées et les espèces créditées
  db.prepare("DELETE FROM transactions WHERE account_id = ? AND external_id LIKE 'mirror:%' AND note = ?").run(link.manual_account_id, String(link.id));
  if (total) db.prepare('UPDATE accounts SET balance = ROUND(balance - ?, 2) WHERE id = ?').run(total, link.manual_account_id);
  db.prepare('DELETE FROM account_links WHERE id = ?').run(link.id);
}

/** Reporte les nouveaux virements correspondants. Appelé après chaque synchronisation et à chaque modification des liens. */
export function applyLinks(db, manualId = null) {
  const links = db.prepare(`SELECT * FROM account_links ${manualId ? 'WHERE manual_account_id = ?' : ''}`).all(...(manualId ? [manualId] : []));
  if (!links.length) return 0;
  const cat = transferCategory(db);
  const ins = db.prepare('INSERT OR IGNORE INTO transactions(account_id, date, label, amount, category_id, hidden, external_id, note) VALUES (?,?,?,?,?,1,?,?)');
  const bump = db.prepare('UPDATE accounts SET balance = ROUND(balance + ?, 2) WHERE id = ?');
  let applied = 0;
  for (const l of links) {
    const src = db.prepare('SELECT bank FROM accounts WHERE id = ?').get(l.source_account_id);
    for (const t of db.prepare('SELECT id, date, label, amount FROM transactions WHERE account_id = ? AND date > ?').all(l.source_account_id, l.since)) {
      if (normalizeLabel(t.label) !== l.pattern) continue;
      if ((l.direction === 'out' && t.amount >= 0) || (l.direction === 'in' && t.amount <= 0)) continue;
      const amount = round2(-t.amount); // −200 sur le courant ⇒ +200 sur l'épargne
      const r = ins.run(l.manual_account_id, t.date, `${amount > 0 ? 'Versement depuis' : 'Retrait vers'} ${src?.bank || 'compte courant'}`, amount, cat, `mirror:${t.id}`, String(l.id));
      if (r.changes) { bump.run(amount, l.manual_account_id); applied++; }
    }
  }
  return applied;
}
