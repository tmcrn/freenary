// Catégories et règles par défaut + jeu de données de démonstration (12 mois).
import { today, addDays } from './util.js';

export const DEFAULT_CATEGORIES = [
  ['Salaire', '💼', '#C9E3A3', 'income'],
  ['Autres revenus', '💶', '#DCEBB9', 'income'],
  ['Logement', '🏠', '#B4C7F0', 'expense'],
  ['Énergie', '⚡', '#F7D66B', 'expense'],
  ['Assurances', '🛡️', '#C3B4EA', 'expense'],
  ['Courses', '🛒', '#A9DDBD', 'expense'],
  ['Restaurants', '🍔', '#F9C98F', 'expense'],
  ['Transport', '🚕', '#A7BCEB', 'expense'],
  ['Abonnements', '📺', '#F5B6D7', 'expense'],
  ['Shopping', '🛍️', '#D9BCF2', 'expense'],
  ['Santé', '💊', '#A9DDE0', 'expense'],
  ['Loisirs', '🎬', '#F6AE9F', 'expense'],
  ['Banque', '🏦', '#DDD5C8', 'expense'],
  ['Retraits', '💳', '#E6DDCF', 'expense'],
  ['Crédit', '🧾', '#CFC3E8', 'expense'],
  ['Virements à des proches', '🤝', '#E8D3B9', 'expense'],
  ['Divers', '📦', '#E9E2D7', 'expense'],
  ['Virements internes', '🔁', '#DCD5CA', 'transfer'],
];

// clé marchand (contient) → catégorie
export const DEFAULT_RULES = [
  ['SALAIRE', 'Salaire'], ['CPAM', 'Santé'], ['INTERETS', 'Autres revenus'],
  ['LOYER', 'Logement'], ['EDF', 'Énergie'], ['ENGIE', 'Énergie'], ['TOTALENERGIES', 'Énergie'],
  ['MAIF', 'Assurances'], ['MACIF', 'Assurances'], ['AXA', 'Assurances'],
  ['CARREFOUR', 'Courses'], ['LIDL', 'Courses'], ['MONOPRIX', 'Courses'], ['BIOCOOP', 'Courses'], ['FRANPRIX', 'Courses'], ['LECLERC', 'Courses'], ['AUCHAN', 'Courses'], ['INTERMARCHE', 'Courses'],
  ['UBER EATS', 'Restaurants'], ['DELIVEROO', 'Restaurants'], ['MCDONALD', 'Restaurants'], ['BIG MAMMA', 'Restaurants'], ['PRET A MANGER', 'Restaurants'], ['CAFE', 'Restaurants'], ['BURGER', 'Restaurants'],
  ['UBER', 'Transport'], ['BOLT', 'Transport'], ['SNCF', 'Transport'], ['NAVIGO', 'Transport'], ['RATP', 'Transport'], ['TOTAL ', 'Transport'],
  ['NETFLIX', 'Abonnements'], ['SPOTIFY', 'Abonnements'], ['FREE MOBILE', 'Abonnements'], ['AMAZON PRIME', 'Abonnements'], ['DISNEY', 'Abonnements'], ['DEEZER', 'Abonnements'], ['CANAL', 'Abonnements'], ['APPLE.COM', 'Abonnements'], ['ORANGE', 'Abonnements'], ['SFR', 'Abonnements'], ['BOUYGUES', 'Abonnements'],
  ['FNAC SPECTACLES', 'Loisirs'], ['UGC', 'Loisirs'], ['PATHE', 'Loisirs'], ['BASIC FIT', 'Loisirs'],
  ['FNAC', 'Shopping'], ['ZARA', 'Shopping'], ['AMAZON', 'Shopping'], ['DECATHLON', 'Shopping'],
  ['PHARMACIE', 'Santé'], ['DR ', 'Santé'], ['DOCTOLIB', 'Santé'],
  ['FRAIS TENUE', 'Banque'], ['FRAIS BANCAIRES', 'Banque'], ['COMMISSION', 'Banque'], ['AGIOS', 'Banque'], ['COTISATION', 'Banque'], ['RETRAIT', 'Retraits'], ['DAB', 'Retraits'],
  // Libellés courants des relevés bancaires français
  ['REMBOURSEMENT DE PRET', 'Crédit'], ['ECHEANCE PRET', 'Crédit'],
  ['SUPER U', 'Courses'], ['HYPER U', 'Courses'], ['U EXPRESS', 'Courses'], ['ALDI', 'Courses'], ['NETTO', 'Courses'], ['PICARD', 'Courses'], ['BOULANGERIE', 'Courses'],
  ['AVIA', 'Transport'], ['STATION', 'Transport'], ['ESSO', 'Transport'], ['SHELL', 'Transport'], ['PEAGE', 'Transport'], ['PARKING', 'Transport'], ['WASH', 'Transport'],
  ['KEBAB', 'Restaurants'], ['EAT ', 'Restaurants'], ['BAR ', 'Restaurants'], ['PIZZA', 'Restaurants'], ['SUSHI', 'Restaurants'], ['FOOD ', 'Restaurants'], ['RESTAURANT', 'Restaurants'], ['BRASSERIE', 'Restaurants'], ['TACOS', 'Restaurants'],
  ['VINTED', 'Shopping'], ['ACTION ', 'Shopping'], ['LEBONCOIN PAYOUT', 'Autres revenus'], ['REMISE DE CHEQUE', 'Autres revenus'],
  ['IONOS', 'Abonnements'], ['OVH', 'Abonnements'],
  ['SONY INTERACTIVE', 'Loisirs'], ['PLAYSTATION', 'Loisirs'], ['STEAM', 'Loisirs'], ['EUROBOWL', 'Loisirs'], ['BOWLING', 'Loisirs'], ['SPORT INDOOR', 'Loisirs'], ['CINEMA', 'Loisirs'],
  ['PULLANDBEAR', 'Shopping'], ['BERSHKA', 'Shopping'], ['ZALANDO', 'Shopping'], ['CDISCOUNT', 'Shopping'], ['KLARNA', 'Shopping'], ['IKEA', 'Shopping'], ['JARDILAND', 'Shopping'], ['OUTLET', 'Shopping'], ['H&M', 'Shopping'], ['PRIMARK', 'Shopping'],
  ['PETRO', 'Transport'], ['CROUS', 'Logement'], ['AU BUREAU', 'Restaurants'], ['BURGER KING', 'Restaurants'],
  ['VIREMENT EMIS', 'Virements à des proches'], ['VIR INST VERS', 'Virements à des proches'],
  // « VIR Versement Plan d'Epargne » : avec des mots entiers, « VIR VERS » ne le couvre plus
  ["PLAN D'EPARGNE", 'Virements internes'], ['VERSEMENT PEA', 'Virements internes'],
  ['VIR VERS', 'Virements internes'], ['VERS LIVRET', 'Virements internes'], ['VERS BOURSOBANK', 'Virements internes'], ['DE COMPTE COURANT', 'Virements internes'],
];

export function seedReference(db) {
  const insCat = db.prepare('INSERT OR IGNORE INTO categories(name, icon, color, kind) VALUES (?,?,?,?)');
  for (const c of DEFAULT_CATEGORIES) insCat.run(...c);
  const catId = Object.fromEntries(db.prepare('SELECT id, name FROM categories').all().map(c => [c.name, c.id]));
  const insRule = db.prepare('INSERT OR IGNORE INTO rules(pattern, category_id) VALUES (?,?)');
  for (const [p, c] of DEFAULT_RULES) insRule.run(p, catId[c]);
  // Un salaire contient souvent le nom du titulaire : il doit passer avant la règle « virement à soi-même ».
  db.prepare("UPDATE rules SET priority = 10 WHERE pattern IN ('SALAIRE')").run();
  return catId;
}

function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function seedDemo(db) {
  const C = seedReference(db);
  const insAcc = db.prepare('INSERT INTO accounts(bank, name, type, balance, last4, colors, is_demo, updated_at) VALUES (?,?,?,?,?,?,1,?)');
  const now = new Date().toISOString();
  const CA = Number(insAcc.run('Crédit Agricole', 'Compte courant', 'checking', 2847.32, '4821', '#A9B56C,#C4CD8C', now).lastInsertRowid);
  const LIV = Number(insAcc.run('Crédit Agricole', 'Livret A', 'savings', 12450.00, '7730', '#B4C7F0,#CFDBF6', now).lastInsertRowid);
  const BO = Number(insAcc.run('BoursoBank', 'Compte courant', 'checking', 1318.90, '9546', '#F5B6D7,#F9CFE4', now).lastInsertRowid);

  const rnd = mulberry32(20261112);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const between = (a, b) => Math.round((a + rnd() * (b - a)) * 100) / 100;
  const tx = [];
  const add = (acc, date, label, amount, cat, hidden = 0) => tx.push([acc, date, label, amount, C[cat], hidden]);

  const groceries = ['CARREFOUR MARKET', 'LIDL', 'MONOPRIX', 'BIOCOOP', 'FRANPRIX'];
  const restos = ['UBER EATS', "MCDONALD'S", 'BIG MAMMA', 'PRET A MANGER', 'LE PETIT CAFE', 'BURGER KING'];
  const shops = ['FNAC', 'ZARA', 'AMAZON EU', 'DECATHLON'];
  const t = today();

  for (let i = 365; i >= 0; i--) {
    const date = addDays(t, -i);
    const [, m, d] = date.split('-').map(Number);
    const dd = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
    const wd = new Date(date + 'T12:00:00').getDay();

    // Crédit Agricole — compte courant
    if (d === 28) add(CA, date, 'VIR SEPA SALAIRE ACME SAS', 2850, 'Salaire');
    if (d === 5) add(CA, date, 'PRLV SEPA SCI DES LILAS LOYER', -890, 'Logement');
    if (d === 10) add(CA, date, 'PRLV SEPA EDF CLIENTS PARTICULIERS', -between(62, 94), 'Énergie');
    if (d === 12) add(CA, date, 'PRLV SEPA FREE MOBILE', -19.99, 'Abonnements');
    if (d === 15) add(CA, date, 'PRLV SEPA MAIF ASSURANCE', -32.40, 'Assurances');
    if (d === 8) add(CA, date, 'PRLV SEPA BASIC FIT', -29.99, 'Loisirs');
    if (d === 2) add(CA, date, 'FRAIS TENUE DE COMPTE', -2.50, 'Banque');
    if (d === 29) {
      add(CA, date, 'VIR VERS LIVRET A', -500, 'Virements internes', 1);
      add(LIV, date, 'VIR DE COMPTE COURANT', 500, 'Virements internes', 1);
    }
    if (d === 1) {
      add(CA, date, 'VIR VERS BOURSOBANK', -750, 'Virements internes', 1);
      add(BO, date, 'VIR SEPA CREDIT AGRICOLE', 750, 'Virements internes', 1);
    }
    if ((wd === 2 || wd === 6) && rnd() < 0.85) add(CA, date, `CB ${pick(groceries)} ${dd}`, -between(18, 105), 'Courses');
    if (rnd() < 0.03) add(CA, date, `RETRAIT DAB ${dd} PARIS`, -40, 'Retraits');

    // BoursoBank
    if (d === 7) add(BO, date, `CB NETFLIX.COM ${dd}`, -13.49, 'Abonnements');
    if (d === 19) add(BO, date, `CB SPOTIFY ${dd}`, -11.12, 'Abonnements');
    if (d === 22) add(BO, date, `CB AMAZON PRIME ${dd}`, -6.99, 'Abonnements');
    if (d === 3) add(BO, date, 'PRLV SEPA NAVIGO', -86.40, 'Transport');
    if (rnd() < 0.42) add(BO, date, `CB ${pick(restos)} ${dd}`, -between(8, 42), 'Restaurants');
    if (rnd() < 0.12) { const s = pick(['UBER', 'UBER', 'BOLT', 'SNCF CONNECT']); add(BO, date, `CB ${s} ${dd}`, -(s === 'SNCF CONNECT' ? between(25, 89) : between(9, 32)), 'Transport'); }
    if (rnd() < 0.07) add(BO, date, `CB ${pick(shops)} ${dd}`, -between(15, 140), 'Shopping');
    if (rnd() < 0.03) add(BO, date, `CB ${pick(['PHARMACIE DU MARCHE', 'DR MARTIN MEDECIN'])} ${dd}`, -between(8, 30), 'Santé');
    if (rnd() < 0.05) add(BO, date, `CB ${pick(['UGC CINE CITE', 'FNAC SPECTACLES', 'PATHE'])} ${dd}`, -between(9, 45), 'Loisirs');
    if (rnd() < 0.02) add(BO, date, 'VIR CPAM PARIS', between(15, 40), 'Autres revenus');

    // Livret A
    if (m === 12 && d === 31) add(LIV, date, 'INTERETS CREDITEURS', between(180, 240), 'Autres revenus');
  }

  const ins = db.prepare('INSERT INTO transactions(account_id, date, label, amount, category_id, hidden) VALUES (?,?,?,?,?,?)');
  db.exec('BEGIN');
  for (const r of tx) ins.run(...r);
  db.exec('COMMIT');

  const insRec = db.prepare('INSERT INTO recurring(label, pattern, amount, category_id, account_id, frequency, day, start_date) VALUES (?,?,?,?,?,?,?,?)');
  insRec.run('Salaire', 'SALAIRE ACME SAS', 2850, C['Salaire'], CA, 'monthly', 28, t);
  insRec.run('Loyer', 'SCI DES LILAS LOYER', -890, C['Logement'], CA, 'monthly', 5, t);
  insRec.run('EDF', 'EDF CLIENTS PARTICULIERS', -78, C['Énergie'], CA, 'monthly', 10, t);
  insRec.run('Free Mobile', 'FREE MOBILE', -19.99, C['Abonnements'], CA, 'monthly', 12, t);
  insRec.run('MAIF', 'MAIF ASSURANCE', -32.40, C['Assurances'], CA, 'monthly', 15, t);
  insRec.run('Basic-Fit', 'BASIC FIT', -29.99, C['Loisirs'], CA, 'monthly', 8, t);
  insRec.run('Netflix', 'NETFLIX.COM', -13.49, C['Abonnements'], BO, 'monthly', 7, t);
  insRec.run('Cotisation carte', 'COTISATION CARTE', -134, C['Banque'], CA, 'yearly', null, `${t.slice(0, 4)}-03-15`);
}
