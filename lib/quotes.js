// Cours et valeurs liquidatives (Yahoo Finance, sans clé). Seuls des ISIN / tickers sont envoyés, jamais de donnée perso.
//
// Fonds (OPCVM) : la valeur liquidative (VL) n'est publiée qu'une fois par jour, avec 1 à 3 jours de décalage.
// Pour une valeur « en direct », on estime la VL du jour à partir de l'ETF dans lequel le fonds est investi
// (son « proxy ») : VL estimée = dernière VL × (cours ETF maintenant / cours ETF à la date de cette VL).
// Vérifié sur 63 jours pour Bourso Monde et Bourso US : écart moyen 0,003 %, max 0,01 %.

const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Freenary/0.1', Accept: 'application/json' } };
const day = ts => new Date(ts * 1000).toISOString().slice(0, 10);

// Fonds connus → ETF suivi en temps réel
export const KNOWN_PROXIES = {
  FR001400RWK6: { proxy: 'WPEA.PA', note: 'iShares MSCI World Swap PEA' }, // Bourso Monde
  FR001400RWL4: { proxy: 'PSP5.PA', note: 'Amundi PEA S&P 500' },          // Bourso US
};

export async function searchInstrument(q) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`;
  const j = await (await fetch(url, UA)).json();
  return (j.quotes || []).filter(x => x.symbol).map(x => ({
    symbol: x.symbol, name: x.longname || x.shortname || x.symbol, type: x.quoteType, exchange: x.exchDisp,
  }));
}

/** Historique quotidien + dernier cours. */
export async function chart(symbol, range = '1y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const j = await (await fetch(url, UA)).json();
  const r = j.chart?.result?.[0];
  if (!r) throw new Error(`Cours introuvable pour ${symbol}`);
  const closes = r.indicators?.quote?.[0]?.close || [];
  const points = (r.timestamp || []).map((t, i) => [day(t), closes[i]]).filter(([, v]) => v != null);
  const m = r.meta;
  // Dernier cours : en séance, regularMarketPrice est plus frais que la dernière clôture
  const last = { date: day(m.regularMarketTime), price: m.regularMarketPrice, time: new Date(m.regularMarketTime * 1000).toISOString() };
  if (!points.length || points.at(-1)[0] < last.date) points.push([last.date, last.price]);
  else points[points.length - 1] = [points.at(-1)[0], last.price];
  return { symbol, name: m.longName || m.shortName || symbol, currency: m.currency, type: m.instrumentType, points, last };
}
