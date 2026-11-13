import { DatabaseSync } from 'node:sqlite';

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS accounts (
      id          INTEGER PRIMARY KEY,
      bank        TEXT NOT NULL,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'checking',   -- checking | savings
      balance     REAL NOT NULL DEFAULT 0,
      last4       TEXT,
      colors      TEXT,                               -- "#aaa,#bbb" (dégradé de la carte)
      external_id TEXT,                               -- identifiant côté agrégateur (Enable Banking…)
      updated_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id    INTEGER PRIMARY KEY,
      name  TEXT NOT NULL UNIQUE,
      icon  TEXT,
      color TEXT,
      kind  TEXT NOT NULL DEFAULT 'expense'           -- expense | income | transfer
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id          INTEGER PRIMARY KEY,
      account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,
      label       TEXT NOT NULL,
      amount      REAL NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      hidden      INTEGER NOT NULL DEFAULT 0,
      note        TEXT,
      external_id TEXT,
      UNIQUE (account_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS tx_account ON transactions(account_id, date);

    -- Règles d'auto-catégorisation : si la clé marchand contient « pattern » → catégorie
    CREATE TABLE IF NOT EXISTS rules (
      id          INTEGER PRIMARY KEY,
      pattern     TEXT NOT NULL UNIQUE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE
    );

    -- Mouvements prévus (abonnements, loyer, salaire…)
    CREATE TABLE IF NOT EXISTS recurring (
      id          INTEGER PRIMARY KEY,
      label       TEXT NOT NULL,
      pattern     TEXT,                               -- clé marchand associée (pour la détection)
      amount      REAL NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      account_id  INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
      frequency   TEXT NOT NULL DEFAULT 'monthly',    -- monthly | weekly | yearly
      day         INTEGER,                            -- jour du mois (monthly) ou de la semaine 0-6 (weekly)
      start_date  TEXT,                               -- yearly : date de référence (mois/jour)
      active      INTEGER NOT NULL DEFAULT 1
    );

    -- Sessions Enable Banking (un consentement DSP2 par banque, ~180 jours)
    CREATE TABLE IF NOT EXISTS eb_sessions (
      session_id    TEXT PRIMARY KEY,
      aspsp_name    TEXT NOT NULL,
      aspsp_country TEXT NOT NULL,
      valid_until   TEXT,
      created_at    TEXT,
      last_sync     TEXT,
      last_error    TEXT
    );
  `);
  // Colonnes ajoutées après coup (migrations idempotentes)
  const cols = db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name);
  if (!cols.includes('session_id')) db.exec('ALTER TABLE accounts ADD COLUMN session_id TEXT');
  if (!cols.includes('identification_hash')) db.exec('ALTER TABLE accounts ADD COLUMN identification_hash TEXT');
  const ruleCols = db.prepare('PRAGMA table_info(rules)').all().map(c => c.name);
  if (!ruleCols.includes('priority')) db.exec('ALTER TABLE rules ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');
  // Liens « virement depuis un compte synchronisé → compte suivi à la main » (par sens : sortants = versements, entrants = retraits)
  // Ancienne table sans « direction » : on la renomme pour recopier ses lignes (versements = sens « out ») au lieu de les perdre.
  const legacyLinks = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'account_links'").get()) && !db.prepare('PRAGMA table_info(account_links)').all().some(c => c.name === 'direction');
  if (legacyLinks) db.exec('ALTER TABLE account_links RENAME TO account_links_old');
  db.exec(`CREATE TABLE IF NOT EXISTS account_links (
    id                INTEGER PRIMARY KEY,
    manual_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    source_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    pattern           TEXT NOT NULL,      -- clé marchand exacte (normalizeLabel) du virement
    since             TEXT NOT NULL,      -- seuls les virements postérieurs à cette date sont reportés
    direction         TEXT NOT NULL DEFAULT 'out',  -- out : virements sortants du compte source (versements) ; in : entrants (retraits)
    UNIQUE (manual_account_id, source_account_id, pattern, direction)
  )`);
  if (legacyLinks) db.exec(`INSERT OR IGNORE INTO account_links(id, manual_account_id, source_account_id, pattern, since, direction)
    SELECT id, manual_account_id, source_account_id, pattern, since, 'out' FROM account_links_old; DROP TABLE account_links_old;`);
  if (!cols.includes('is_demo')) db.exec('ALTER TABLE accounts ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0');
  const repaint = { '#0B5E4F,#18A07F': '#A9B56C,#C4CD8C', '#245C8F,#3E8BD1': '#B4C7F0,#CFDBF6', '#1E2A5E,#C2186B': '#F5B6D7,#F9CFE4', '#2D3F9E,#4C6FFF': '#F7D66B,#FAE59D' };
  for (const [from, to] of Object.entries(repaint)) db.prepare('UPDATE accounts SET colors = ? WHERE colors = ?').run(to, from);
  return db;
}
