// Valorisation des comptes de placement suivis à la main (PEA…) à partir de leurs positions.
//
// Valeur du compte = Σ (parts × prix du moment) + espèces.
// - Les versements reportés depuis le compte courant (virements liés) arrivent en espèces,
//   puis sont convertis en parts selon la répartition choisie, à la VL du jour du versement (ou la suivante).
// - Chaque variation de valeur est enregistrée comme un mouvement masqué « Variation de valorisation »
//   (un par jour), pour que la courbe de solde reste juste sans toucher aux statistiques.
import { chart, searchInstrument, KNOWN_PROXIES } from './quotes.js';
import { today, round2 } from './util.js';

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      id           INTEGER PRIMARY KEY,
      account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      isin         TEXT,
      symbol       TEXT NOT NULL,   -- cours / VL officielle (Yahoo)
      proxy_symbol TEXT,            -- ETF suivi en direct pour estimer la VL du jour
      name         TEXT,
      quantity     REAL NOT NULL DEFAULT 0,
      alloc        REAL NOT NULL DEFAULT 0, -- % de chaque versement investi dans cette ligne
      cost         REAL                     -- prix de revient total (facultatif)
    );
    CREATE TABLE IF NOT EXISTS prices (
      symbol TEXT NOT NULL, date TEXT NOT NULL, price REAL NOT NULL, fetched_at TEXT,
      PRIMARY KEY (symbol, date)
    );
    CREATE TABLE IF NOT EXISTS mirror_cash (mirror_tx_id INTEGER PRIMARY KEY, credited REAL NOT NULL DEFAULT 0); -- versements déjà crédités en espèces (montant crédité)
    CREATE TABLE IF NOT EXISTS position_buys (
      mirror_tx_id INTEGER NOT NULL, position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
      date TEXT, amount REAL, units REAL, price REAL,
      PRIMARY KEY (mirror_tx_id, position_id)
    );
  `);
  if (!db.prepare('PRAGMA table_info(mirror_cash)').all().some(c => c.name === 'credited')) db.exec('ALTER TABLE mirror_cash ADD COLUMN credited REAL NOT NULL DEFAULT 0');
  // Ces tables sont indexées par id de transaction (réutilisable par SQLite) : on retire toute ligne dont le miroir n'existe plus,
  // sinon un futur virement qui hériterait de cet id serait pris pour déjà traité.
  const live = "SELECT id FROM transactions WHERE external_id LIKE 'mirror:%'";
  db.exec(`DELETE FROM mirror_cash WHERE mirror_tx_id NOT IN (${live}); DELETE FROM position_buys WHERE mirror_tx_id NOT IN (${live});`);
  const cols = db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name);
  if (!cols.includes('cash')) db.exec('ALTER TABLE accounts ADD COLUMN cash REAL NOT NULL DEFAULT 0');
  if (!cols.includes('valued_at')) db.exec('ALTER TABLE accounts ADD COLUMN valued_at TEXT');
  // Valeur affichée : « live » = estimée en direct via l'ETF suivi ; « official » = dernière VL publiée (comme l'appli du courtier)
  if (!cols.includes('valuation')) db.exec("ALTER TABLE accounts ADD COLUMN valuation TEXT NOT NULL DEFAULT 'live'");
}

const httpError = (status, message) => Object.assign(new Error(message), { status });
const lastFetch = new Map();

/** Met à jour l'historique de prix d'un symbole (au plus toutes les 10 minutes). */
async function refreshSymbol(db, symbol, force = false) {
  if (!force && Date.now() - (lastFetch.get(symbol) || 0) < 10 * 60_000) return;
  const c = await chart(symbol, '1y');
  const up = db.prepare('INSERT INTO prices(symbol, date, price, fetched_at) VALUES (?,?,?,?) ON CONFLICT(symbol, date) DO UPDATE SET price = excluded.price, fetched_at = excluded.fetched_at');
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try { for (const [d, p] of c.points) up.run(symbol, d, p, now); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  lastFetch.set(symbol, Date.now());
}

const priceOn = (db, symbol, date) => db.prepare('SELECT date, price FROM prices WHERE symbol = ? AND date <= ? ORDER BY date DESC LIMIT 1').get(symbol, date);
const priceFrom = (db, symbol, date) => db.prepare('SELECT date, price FROM prices WHERE symbol = ? AND date >= ? ORDER BY date LIMIT 1').get(symbol, date);
const latest = (db, symbol) => db.prepare('SELECT date, price, fetched_at FROM prices WHERE symbol = ? ORDER BY date DESC LIMIT 1').get(symbol);

/** Prix du moment d'une position : VL officielle, ou VL estimée via l'ETF proxy si elle est plus récente. */
export function livePrice(db, pos) {
  const nav = latest(db, pos.symbol);
  if (!nav) return null;
  const out = { price: nav.price, date: nav.date, official: nav.price, officialDate: nav.date, estimated: false };
  if (pos.proxy_symbol) {
    const now = latest(db, pos.proxy_symbol), base = priceOn(db, pos.proxy_symbol, nav.date);
    if (now && base && now.date > nav.date) {
      out.price = nav.price * now.price / base.price;
      out.date = now.date; out.estimated = true; out.proxy = { symbol: pos.proxy_symbol, change: now.price / base.price - 1 };
    }
  }
  return out;
}

/** Oublie des versements reportés (lien retiré) : retire les parts achetées et les espèces créditées, puis efface leur état. */
export function forgetMirrors(db, accountId, ids) {
  for (const id of ids) {
    const buys = db.prepare('SELECT position_id, amount, units FROM position_buys WHERE mirror_tx_id = ?').all(id);
    let invested = 0;
    for (const b of buys) {
      invested += b.amount;
      if (b.units || b.amount) db.prepare('UPDATE positions SET quantity = MAX(0, quantity - ?), cost = CASE WHEN cost IS NULL THEN NULL ELSE cost - ? END WHERE id = ?').run(b.units, b.amount, b.position_id);
    }
    const mc = db.prepare('SELECT credited FROM mirror_cash WHERE mirror_tx_id = ?').get(id);
    if (mc) db.prepare('UPDATE accounts SET cash = ROUND(cash - ?, 2) WHERE id = ?').run(mc.credited - invested, accountId);
    db.prepare('DELETE FROM position_buys WHERE mirror_tx_id = ?').run(id);
    db.prepare('DELETE FROM mirror_cash WHERE mirror_tx_id = ?').run(id);
  }
}

/** Avant de supprimer un compte : efface l'état de ses miroirs (indexé par id de transaction, sans clé étrangère). */
export function forgetAccountMirrors(db, accountId) {
  forgetMirrors(db, accountId, db.prepare("SELECT id FROM transactions WHERE account_id = ? AND external_id LIKE 'mirror:%'").all(accountId).map(r => r.id));
}

/** Convertit en parts les versements reportés qui ne l'ont pas encore été. */
function investMirrors(db, accountId) {
  // 1. tout versement reporté arrive d'abord en espèces (même si la VL n'est pas encore publiée)
  for (const m of db.prepare(`SELECT id, amount FROM transactions WHERE account_id = ? AND external_id LIKE 'mirror:%'
      AND id NOT IN (SELECT mirror_tx_id FROM mirror_cash)`).all(accountId)) {
    db.prepare('INSERT INTO mirror_cash(mirror_tx_id, credited) VALUES (?, ?)').run(m.id, m.amount);
    db.prepare('UPDATE accounts SET cash = ROUND(cash + ?, 2) WHERE id = ?').run(m.amount, accountId);
  }
  // 2. puis il est investi selon la répartition dès que la VL du jour est connue
  const positions = db.prepare('SELECT * FROM positions WHERE account_id = ? AND alloc > 0').all(accountId);
  if (!positions.length) return 0;
  const mirrors = db.prepare(`SELECT id, date, amount FROM transactions WHERE account_id = ? AND external_id LIKE 'mirror:%'
    AND id NOT IN (SELECT mirror_tx_id FROM position_buys)`).all(accountId);
  let n = 0;
  for (const m of mirrors) {
    let invested = 0;
    const buys = [];
    for (const p of positions) {
      // ordre exécuté à la VL du jour du versement ou à la suivante ; sinon (VL pas encore publiée) on attend
      const px = priceFrom(db, p.symbol, m.date);
      if (!px) { buys.length = 0; break; }
      const amount = round2(m.amount * p.alloc / 100);
      buys.push({ p, amount, units: amount / px.price, price: px.price, date: px.date });
      invested += amount;
    }
    if (!buys.length) continue;
    db.exec('BEGIN');
    for (const b of buys) {
      db.prepare('INSERT INTO position_buys(mirror_tx_id, position_id, date, amount, units, price) VALUES (?,?,?,?,?,?)').run(m.id, b.p.id, b.date, b.amount, b.units, b.price);
      db.prepare('UPDATE positions SET quantity = quantity + ?, cost = COALESCE(cost, 0) + ? WHERE id = ?').run(b.units, b.amount, b.p.id);
    }
    db.prepare('UPDATE accounts SET cash = ROUND(cash - ?, 2) WHERE id = ?').run(invested, accountId);
    db.exec('COMMIT');
    n++;
  }
  return n;
}

function valuationCategory(db) {
  db.prepare("INSERT OR IGNORE INTO categories(name, icon, color, kind) VALUES ('Mise à jour de solde', '⚖️', '#DCD5CA', 'transfer')").run();
  return db.prepare("SELECT id FROM categories WHERE name = 'Mise à jour de solde'").get().id;
}

/** Recalcule la valeur d'un compte et enregistre l'écart du jour. Renvoie le détail des lignes. */
export function revalue(db, accountId) {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  const positions = db.prepare('SELECT * FROM positions WHERE account_id = ? ORDER BY id').all(accountId);
  if (!acc || !positions.length) return null;
  // Les versements reportés ont déjà augmenté le solde (en espèces) : on part de là
  investMirrors(db, accountId);
  const cash = db.prepare('SELECT cash FROM accounts WHERE id = ?').get(accountId).cash;
  const mode = acc.valuation === 'official' ? 'official' : 'live';
  const lines = positions.map(p => {
    const fresh = db.prepare('SELECT quantity, cost FROM positions WHERE id = ?').get(p.id);
    const lp = livePrice(db, p);
    const at = price => (lp ? round2(fresh.quantity * price) : null);
    const value_live = at(lp?.price), value_official = at(lp?.official);
    return { ...p, quantity: fresh.quantity, cost: fresh.cost, live: lp, value: mode === 'official' ? value_official : value_live, value_live, value_official };
  });
  if (lines.some(l => l.value == null)) return { lines, cash, total: null, mode };
  const total = round2(lines.reduce((s, l) => s + l.value, 0) + cash);
  const total_live = round2(lines.reduce((s, l) => s + l.value_live, 0) + cash);
  const total_official = round2(lines.reduce((s, l) => s + l.value_official, 0) + cash);
  const delta = round2(total - acc.balance);
  if (delta) {
    const ext = `valo:${accountId}:${today()}`;
    const existing = db.prepare('SELECT id FROM transactions WHERE external_id = ? AND account_id = ?').get(ext, accountId);
    if (existing) db.prepare('UPDATE transactions SET amount = ROUND(amount + ?, 2) WHERE id = ?').run(delta, existing.id);
    else db.prepare('INSERT INTO transactions(account_id, date, label, amount, category_id, hidden, external_id) VALUES (?,?,?,?,?,1,?)')
      .run(accountId, today(), 'Variation de valorisation', delta, valuationCategory(db), ext);
  }
  db.prepare('UPDATE accounts SET balance = ?, valued_at = ? WHERE id = ?').run(total, new Date().toISOString(), accountId);
  return { lines, cash, total, total_live, total_official, mode };
}

/** Choisit la valeur affichée du compte : « live » (estimée) ou « official » (dernière VL publiée). */
export function setValuation(db, accountId, mode) {
  if (!['live', 'official'].includes(mode)) throw httpError(400, 'Mode de valorisation inconnu (live ou official).');
  const acc = db.prepare('SELECT external_id FROM accounts WHERE id = ?').get(accountId);
  if (!acc || acc.external_id) throw httpError(400, 'Ce réglage concerne un compte suivi à la main.');
  db.prepare('UPDATE accounts SET valuation = ? WHERE id = ?').run(mode, accountId);
  return getPortfolio(db, accountId);
}

/** Rafraîchit les cours de toutes les positions puis revalorise les comptes concernés. */
export async function refreshAll(db, { force = false } = {}) {
  const pos = db.prepare('SELECT DISTINCT account_id, symbol, proxy_symbol FROM positions').all();
  const symbols = new Set(pos.flatMap(p => [p.symbol, p.proxy_symbol].filter(Boolean)));
  const errors = [];
  for (const s of symbols) { try { await refreshSymbol(db, s, force); } catch (e) { errors.push(`${s} : ${e.message}`); } }
  for (const id of new Set(pos.map(p => p.account_id))) revalue(db, id);
  return { symbols: symbols.size, errors };
}

export function getPortfolio(db, accountId) {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!acc) throw httpError(404, 'Compte introuvable');
  const r = revalue(db, accountId) || { lines: [], cash: acc.cash, total: acc.balance };
  return { account: db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId), ...r };
}

/** Résout un ISIN (ou un ticker) en symbole Yahoo + ETF proxy connu. */
export async function resolveInstrument(q) {
  const key = String(q || '').trim().toUpperCase();
  if (!key) throw httpError(400, 'Indique un ISIN ou un ticker.');
  const found = await searchInstrument(key);
  if (!found.length) throw httpError(404, `Aucun titre trouvé pour « ${key} ».`);
  const best = found[0];
  const proxy = KNOWN_PROXIES[key]?.proxy || null;
  return { isin: /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(key) ? key : null, symbol: best.symbol, name: best.name, type: best.type, proxy_symbol: proxy, candidates: found };
}

export async function setPositions(db, accountId, body) {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!acc || acc.external_id) throw httpError(400, 'Les positions se gèrent sur un compte suivi à la main.');
  const list = (body.positions || []).filter(p => p.symbol);
  const allocSum = list.reduce((s, p) => s + (Number(p.alloc) || 0), 0);
  if (allocSum > 100.001) throw httpError(400, `La répartition des versements dépasse 100 % (${allocSum} %).`);
  // Les cours d'abord : on doit savoir quels versements ont déjà une VL publiée (= déjà exécutés chez le courtier)
  for (const sym of new Set(list.flatMap(p => [p.symbol, p.proxy_symbol].filter(Boolean)))) {
    try { await refreshSymbol(db, sym, true); } catch { /* cours indisponible : les versements restent en attente */ }
  }
  db.exec('BEGIN');
  try {
    const keep = new Set(list.filter(p => p.id).map(p => Number(p.id)));
    for (const old of db.prepare('SELECT id FROM positions WHERE account_id = ?').all(accountId)) if (!keep.has(old.id)) db.prepare('DELETE FROM positions WHERE id = ?').run(old.id);
    for (const p of list) {
      const vals = [p.isin || null, p.symbol, p.proxy_symbol || null, p.name || p.symbol, Number(p.quantity) || 0, Number(p.alloc) || 0, p.cost === '' || p.cost == null ? null : Number(p.cost)];
      if (p.id) db.prepare('UPDATE positions SET isin=?, symbol=?, proxy_symbol=?, name=?, quantity=?, alloc=?, cost=? WHERE id=? AND account_id=?').run(...vals, Number(p.id), accountId);
      else db.prepare('INSERT INTO positions(isin, symbol, proxy_symbol, name, quantity, alloc, cost, account_id) VALUES (?,?,?,?,?,?,?,?)').run(...vals, accountId);
    }
    if (body.cash != null && body.cash !== '') db.prepare('UPDATE accounts SET cash = ? WHERE id = ?').run(Number(body.cash), accountId);
    if (['live', 'official'].includes(body.valuation)) db.prepare('UPDATE accounts SET valuation = ? WHERE id = ?').run(body.valuation, accountId);
    // Les quantités saisies sont à jour aujourd'hui : seuls les versements futurs seront convertis en parts
    // Seuls les versements dont la VL est publiée sont déjà dans les parts saisies ; les autres restent en attente d'achat.
    const mirrors = db.prepare("SELECT id, date FROM transactions WHERE account_id = ? AND external_id LIKE 'mirror:%'").all(accountId);
    const saved = db.prepare('SELECT id, symbol, alloc FROM positions WHERE account_id = ?').all(accountId);
    for (const m of mirrors) {
      if (!saved.filter(p => p.alloc > 0).every(p => priceFrom(db, p.symbol, m.date))) continue;
      db.prepare('INSERT OR IGNORE INTO mirror_cash(mirror_tx_id, credited) VALUES (?, 0)').run(m.id);
      for (const p of saved)
        db.prepare('INSERT OR IGNORE INTO position_buys(mirror_tx_id, position_id, date, amount, units, price) VALUES (?,?,?,0,0,0)').run(m.id, p.id, today());
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  await refreshAll(db); // les cours viennent d'être rafraîchis : pas de nouvel appel réseau
  return getPortfolio(db, accountId);
}
