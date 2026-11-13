// Petits utilitaires de dates et de libellés, partagés par le serveur.

const pad = n => String(n).padStart(2, '0');

export const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => fmtDate(new Date());
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); };
export const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m : 1-12
export const round2 = v => Math.round(v * 100) / 100;

/**
 * Transforme un libellé bancaire brut en « clé marchand » stable :
 * « CB NETFLIX.COM 07/03 » → « NETFLIX.COM », « PRLV SEPA FREE MOBILE » → « FREE MOBILE ».
 * Sert à regrouper les mouvements, appliquer les règles et détecter les abonnements.
 */
export function normalizeLabel(label = '') {
  return String(label)
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    // Formats Crédit Agricole : « VIREMENT EN VOTRE FAVEUR DE X », « VIREMENT EMIS WEB X », « … VIR INST VERS X »
    .replace(/^VIREMENT EN VOTRE FAVEUR\s+(DE\s+)?(VIR INST DE\s+)?/, '')
    .replace(/^VIREMENT EMIS\s+(WEB\s+)?(VIR INST VERS\s+)?/, '')
    .replace(/^(CB|CARTE( X?\d+)?|PAIEMENT( PAR)? CARTE( X?\d+)?|PRLV( SEPA)?|PRELEVEMENT( SEPA)?|VIR( SEPA)?( INST(ANTANE)?)?|VIREMENT( SEPA)?( EMIS| RECU)?)\s+/, '')
    .replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, ' ')
    .replace(/\bX?\d{3,}\b/g, ' ')
    .replace(/[*#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
