// Freenary — serveur local (aucune dépendance : Node ≥ 22.5 avec node:sqlite).
// Par défaut écoute uniquement sur 127.0.0.1 : les données ne quittent pas le Mac (hors appels à Enable Banking).
// Accès téléphone (optionnel, mot de passe obligatoire) : voir lib/access.js.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './lib/db.js';
import { seedDemo, seedReference } from './lib/seed.js';
import { EnableBanking } from './lib/enablebanking.js';
import * as L from './lib/logic.js';
import * as P from './lib/portfolio.js';
import { Access, isLoopback, lanIps, lanNames } from './lib/access.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.FREENARY_DATA || path.join(ROOT, 'data'); // FREENARY_DATA : dossier de données alternatif (tests)
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 4848;

await mkdir(DATA, { recursive: true });
const db = openDb(path.join(DATA, 'budget.db'));
seedReference(db);
P.migrate(db);
if (!db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n && process.env.NO_DEMO !== '1') {
  seedDemo(db);
  console.log('Données de démonstration créées (supprimables depuis Réglages).');
}
const eb = new EnableBanking(db, DATA, PORT);
const access = new Access(DATA);
eb.onSynced = () => { L.applyLinks(db); P.refreshAll(db).catch(() => {}); }; // synchro auto : virements liés + valorisations
// Cours et VL : toutes les 15 minutes tant que l'app tourne
setInterval(() => P.refreshAll(db).catch(e => console.warn('[cours]', e.message)), 15 * 60_000);
setTimeout(() => P.refreshAll(db).catch(() => {}), 5_000);

/* ───────────── Routes API ───────────── */

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

route('GET', '/api/accounts', () => L.listAccounts(db));
route('PATCH', '/api/accounts/:id', ({ params, body }) => L.updateAccount(db, Number(params.id), body));
route('POST', '/api/accounts', ({ body }) => L.createManualAccount(db, body));
route('DELETE', '/api/accounts/:id', ({ params }) => L.deleteManualAccount(db, Number(params.id)));
route('GET', '/api/accounts/:id/link-candidates', ({ params }) => L.linkCandidates(db, Number(params.id)));
route('GET', '/api/accounts/:id/links', ({ params }) => L.listLinks(db, Number(params.id)));
route('PUT', '/api/accounts/:id/links', ({ params, body }) => { const r = L.setLinks(db, Number(params.id), body); P.revalue(db, Number(params.id)); return r; });
route('GET', '/api/accounts/:id/portfolio', async ({ params }) => { await P.refreshAll(db).catch(() => {}); return P.getPortfolio(db, Number(params.id)); });
route('PUT', '/api/accounts/:id/portfolio', ({ params, body }) => P.setPositions(db, Number(params.id), body));
route('PUT', '/api/accounts/:id/valuation', ({ params, body }) => P.setValuation(db, Number(params.id), body.mode));
route('GET', '/api/instruments/resolve', ({ query }) => P.resolveInstrument(query.q));
route('POST', '/api/portfolio/refresh', () => P.refreshAll(db, { force: true }));
// Accès depuis le téléphone (réservé au Mac lui-même, voir remoteGate)
const accessInfo = () => ({ enabled: access.enabled, has_password: access.hasPassword, port: PORT, urls: access.urls(PORT), tls: Boolean(httpsServer) });
route('GET', '/api/access', () => accessInfo());
route('PUT', '/api/access', ({ body }) => {
  if (body.password) access.setPassword(body.password);
  if ('enabled' in body) access.setEnabled(Boolean(body.enabled));
  syncLan();
  return accessInfo();
});
route('POST', '/api/access/logout-all', () => { access.revokeSessions(); return accessInfo(); });
route('GET', '/api/categories', () => L.listCategories(db));
route('GET', '/api/transactions', ({ query }) => L.listTransactions(db, query));
route('PATCH', '/api/transactions/:id', ({ params, body }) => L.updateTransaction(db, Number(params.id), body));
route('GET', '/api/series', ({ query }) => L.balanceSeries(db, query));
route('GET', '/api/stats', ({ query }) => L.stats(db, query));
route('GET', '/api/forecast', ({ query }) => L.forecast(db, query));
route('GET', '/api/recurring', () => L.listRecurring(db));
route('GET', '/api/recurring/suggestions', () => L.suggestRecurring(db));
route('POST', '/api/recurring', ({ body }) => L.createRecurring(db, body));
route('PATCH', '/api/recurring/:id', ({ params, body }) => L.updateRecurring(db, Number(params.id), body));
route('DELETE', '/api/recurring/:id', ({ params }) => L.deleteRecurring(db, Number(params.id)));
route('POST', '/api/import', ({ body }) => L.importCsv(db, body));
route('POST', '/api/demo/clear', () => L.clearDemo(db));

// Enable Banking
route('GET', '/api/eb/status', () => eb.status());
route('POST', '/api/eb/config', ({ body }) => eb.saveConfig(body));
route('GET', '/api/eb/aspsps', ({ query }) => eb.aspsps(query.country || 'FR'));
route('POST', '/api/eb/auth', ({ body }) => eb.startAuth(body));
route('POST', '/api/eb/complete', ({ body }) => {
  // Secours si la redirection n'arrive pas jusqu'ici : on colle l'URL finale (…?code=…&state=…)
  let code = body.code, state = body.state;
  if (body.url) { const u = new URL(body.url); code = u.searchParams.get('code'); state = u.searchParams.get('state'); }
  return eb.completeAuth(code, state);
});
route('POST', '/api/eb/sync', async () => { const r = await eb.syncAll(); r.mirrored = L.applyLinks(db); await P.refreshAll(db).catch(() => {}); return r; });
route('DELETE', '/api/eb/sessions/:id', ({ params }) => eb.deleteSession(decodeURIComponent(params.id)));

/* ───────────── Serveur HTTP ───────────── */

const MIME = { '.webmanifest': 'application/manifest+json', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

// En-têtes de sécurité : aucun script inline ni externe, pas de fuite du code OAuth via le Referer
const SEC = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://enablebanking.com; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function send(res, status, data) {
  res.writeHead(status, { ...SEC, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

/**
 * Protège l'API locale contre les sites tiers ouverts dans le même navigateur :
 *  - Host : seul localhost / 127.0.0.1 sur notre port (bloque le DNS rebinding) ;
 *  - Origin : si présent, doit être l'app elle-même ;
 *  - Sec-Fetch-Site : une écriture venue d'un autre site est refusée (le retour de la banque est un GET : non concerné).
 */
const LOCAL_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
function guard(req, remote) {
  // Une requête venue du réseau ne doit viser que les noms/adresses de ce Mac ; celle du Mac, que localhost
  // (depuis le Mac, le nom « .local » du Mac pointe vers lui-même : on l'accepte aussi ; un site tiers ne peut pas l'usurper)
  const hosts = remote ? access.remoteHosts(PORT) : new Set([...LOCAL_HOSTS, ...access.remoteHosts(PORT)]);
  if (!hosts.has(String(req.headers.host || '').toLowerCase())) return 'Hôte non autorisé';
  const origin = req.headers.origin;
  if (origin) { try { if (!hosts.has(new URL(origin).host.toLowerCase())) return 'Origine non autorisée'; } catch { return 'Origine invalide'; } }
  if (!['GET', 'HEAD'].includes(req.method)) {
    const site = req.headers['sec-fetch-site'];
    if (site && !['same-origin', 'none'].includes(site)) return 'Requête inter-sites refusée';
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 20e6) { reject(Object.assign(new Error('Corps trop volumineux'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      // Un corps non vide doit être déclaré JSON : un formulaire ou un text/plain venu d'une autre page est refusé
      if (s && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return reject(Object.assign(new Error('Content-Type application/json requis'), { status: 415 }));
      try { resolve(s ? JSON.parse(s) : {}); } catch { reject(Object.assign(new Error('JSON invalide'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const page = (title, msg, ok) => `<!doctype html><meta charset="utf-8"><title>${escHtml(title)}</title>${ok ? '<meta http-equiv="refresh" content="2;url=/#/settings">' : ''}
<body style="font-family:-apple-system,system-ui;background:#EEF1F8;display:grid;place-items:center;height:100vh;margin:0">
<div style="background:#fff;padding:32px 40px;border-radius:20px;box-shadow:0 10px 30px -12px rgba(36,52,110,.2);max-width:460px;text-align:center">
<div style="font-size:40px">${ok ? '✅' : '⚠️'}</div><h2 style="margin:.4em 0">${escHtml(title)}</h2><p style="color:#6b7391">${escHtml(msg)}</p>
<a href="/#/settings" style="display:inline-block;margin-top:12px;background:#4C6FFF;color:#fff;padding:10px 18px;border-radius:12px;text-decoration:none">Retour à l'application</a></div>`;

/* ───────── Accès depuis un autre appareil ───────── */

// Réservé au Mac : gestion de l'accès, connexion bancaire, configuration Enable Banking, effacement de la démo
const ADMIN_ONLY = /^\/api\/(access|demo\/clear|eb\/(config|auth|complete|callback|sessions|aspsps))(\/|$)/;
const REMOTE_PUBLIC = new Set(['/cert', '/manifest.webmanifest', '/icon-180.png', '/icon-512.png']); // sans donnée personnelle

const loginPage = error => `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F6F0E4"><title>Freenary</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#F6F0E4;font-family:-apple-system,system-ui,sans-serif;color:#1E1C19">
<form method="post" action="/login" style="width:min(360px,calc(100vw - 40px));background:#FFFCF6;border-radius:28px;padding:30px 26px;box-shadow:0 20px 50px -24px rgba(40,30,20,.35)">
<div style="font-size:30px;font-weight:600;letter-spacing:-.03em;margin-bottom:6px">freenary</div>
<p style="margin:0 0 20px;color:#8F8A82;font-size:14px">Entre ton mot de passe pour accéder à tes comptes.</p>
<input name="password" type="password" autocomplete="current-password" autofocus required placeholder="Mot de passe" style="width:100%;height:48px;box-sizing:border-box;border:1.5px solid #D6CEC2;border-radius:14px;padding:0 16px;font-size:16px;background:#fff">
${error ? `<p style="margin:12px 0 0;color:#C2414B;font-size:14px">${escHtml(error)}</p>` : ''}
<button style="margin-top:16px;width:100%;height:48px;border:0;border-radius:999px;background:#000;color:#fff;font-size:16px;font-weight:500">Se connecter</button>
</form>`;

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(Object.assign(new Error('Corps trop volumineux'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Contrôle d'une requête venue du réseau. Renvoie true quand la réponse a déjà été envoyée. */
async function remoteGate(req, res, url) {
  if (!access.enabled) { send(res, 403, { error: 'Accès depuis un autre appareil désactivé.' }); return true; }
  const secure = Boolean(req.socket.encrypted);
  // Mot de passe et cookie ne doivent jamais circuler en clair sur le réseau : tout passe en HTTPS
  if (!secure && httpsServer) { res.writeHead(308, { location: `https://${req.headers.host}${req.url}` }); res.end(); return true; }
  const p = url.pathname, ip = req.socket.remoteAddress;
  if (p === '/login') {
    const page = (status, err) => { res.writeHead(status, { ...SEC, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(loginPage(err)); return true; };
    if (req.method === 'GET') return page(200, '');
    if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' }) || true;
    if (access.locked(ip)) return page(429, 'Trop d’essais. Réessaie dans 15 minutes.');
    const pw = new URLSearchParams(await readRaw(req, 4096)).get('password') || '';
    await new Promise(r => setTimeout(r, 400)); // ralentit chaque essai
    if (!access.verify(pw)) { access.fail(ip); return page(401, 'Mot de passe incorrect.'); }
    access.succeed(ip);
    res.writeHead(303, { ...SEC, 'set-cookie': access.cookie(secure), location: '/', 'cache-control': 'no-store' });
    res.end();
    return true;
  }
  if (p === '/logout') { res.writeHead(303, { ...SEC, 'set-cookie': access.clearCookie(secure), location: '/login' }); res.end(); return true; }
  if (REMOTE_PUBLIC.has(p)) return false;
  if (!access.valid(req.headers.cookie)) {
    if (p.startsWith('/api/')) send(res, 401, { error: 'Connexion requise.' });
    else { res.writeHead(302, { ...SEC, location: '/login', 'cache-control': 'no-store' }); res.end(); }
    return true;
  }
  if (ADMIN_ONLY.test(p)) { send(res, 403, { error: 'Réservé à l’ordinateur : ouvre Freenary sur ton Mac pour cette action.' }); return true; }
  return false;
}

const handler = async (req, res) => {
  try {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, { error: 'URL invalide' }); }
    const remote = !isLoopback(req.socket.remoteAddress);
    const denied = guard(req, remote);
    if (denied) return send(res, 403, { error: denied });
    if (remote && await remoteGate(req, res, url)) return;
    // Certificat public à installer sur le téléphone (supprime l'avertissement de Safari) — jamais la clé privée
    if (url.pathname === '/cert') {
      const f = path.join(DATA, 'tls', 'localhost.pem');
      if (!existsSync(f)) return send(res, 404, { error: 'Pas de certificat (HTTPS indisponible).' });
      res.writeHead(200, { ...SEC, 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="freenary.crt"', 'cache-control': 'no-store' });
      return res.end(readFileSync(f));
    }
    // Retour de la banque après consentement
    if (url.pathname === '/api/eb/callback') {
      const err = url.searchParams.get('error');
      res.writeHead(200, { ...SEC, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      if (err) return res.end(page('Connexion annulée', `${err} ${url.searchParams.get('error_description') || ''}`, false));
      try {
        const r = await eb.completeAuth(url.searchParams.get('code'), url.searchParams.get('state'));
        return res.end(page('Banque connectée', `${r.accounts} compte(s) relié(s) et synchronisé(s).`, true));
      } catch (e) { return res.end(page('Échec de la connexion', e.message, false)); }
    }

    if (url.pathname.startsWith('/api/')) {
      const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
      if (!r) return send(res, 404, { error: 'Route inconnue' });
      const params = url.pathname.match(r.re).groups || {};
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : null;
      const out = await r.handler({ params, query: Object.fromEntries(url.searchParams), body });
      return send(res, 200, out ?? { ok: true });
    }

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    const data = await readFile(file).catch(() => null);
    if (!data) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { ...SEC, 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    send(res, e.status || 500, { error: e.message });
  }
};

/* ───────── Un seul port, deux protocoles ─────────
   Enable Banking peut exiger une URL de redirection en https : on sert donc
   http://localhost:4848 ET https://localhost:4848 sur le même port, avec un
   certificat auto-signé (data/tls/). Il couvre aussi les noms « .local » de ce Mac pour l'accès téléphone. */
function localCert() {
  const dir = path.join(DATA, 'tls');
  const key = path.join(dir, 'localhost-key.pem'), cert = path.join(dir, 'localhost.pem'), sanFile = path.join(dir, 'san.txt');
  const names = ['localhost', ...lanNames()];
  const san = [...names.map(n => `DNS:${n}`), 'IP:127.0.0.1', ...lanIps().map(i => `IP:${i}`)].join(',');
  const current = existsSync(sanFile) ? readFileSync(sanFile, 'utf8') : '';
  // On ne régénère que si un NOM manque (une adresse IP qui change ne justifie pas de refaire confiance au certificat sur le téléphone)
  const missingName = names.some(n => !current.includes(`DNS:${n}`));
  if (!existsSync(key) || !existsSync(cert) || missingName) {
    try {
      execFileSync('mkdir', ['-p', dir]);
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
        '-keyout', key, '-out', cert, '-subj', '/CN=Freenary',
        '-addext', `subjectAltName=${san}`, '-addext', 'keyUsage=digitalSignature,keyEncipherment', '-addext', 'extendedKeyUsage=serverAuth'], { stdio: 'ignore' });
      chmodSync(key, 0o600);
      writeFileSync(sanFile, san);
    } catch (e) {
      console.warn('Certificat HTTPS non (re)généré :', e.message);
      if (!existsSync(key) || !existsSync(cert)) return null;
    }
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

process.on('unhandledRejection', e => console.error('[unhandledRejection]', e)); // une requête fautive ne doit jamais arrêter le serveur
const httpServer = http.createServer(handler);
const tls = localCert();
const httpsServer = tls ? https.createServer(tls, handler) : null;

// Aiguille chaque connexion vers https (poignée de main TLS) ou http
const onConnection = socket => {
  socket.once('data', buf => {
    socket.pause();
    socket.unshift(buf);
    // 0x16 = début d'une poignée de main TLS → https ; sinon http
    (buf[0] === 0x16 && httpsServer ? httpsServer : httpServer).emit('connection', socket);
    process.nextTick(() => socket.resume());
  });
  socket.on('error', () => {});
};

// Toujours : 127.0.0.1 (le Mac). Accès téléphone activé : en plus, une écoute sur chaque adresse du réseau local de ce Mac.
const server = net.createServer(onConnection);
const lan = new Map(); // adresse IP → { server, sockets }

function syncLan() {
  const want = new Set(access.enabled ? lanIps() : []);
  for (const [ip, l] of lan) if (!want.has(ip)) { l.server.close(); l.sockets.forEach(s => s.destroy()); lan.delete(ip); console.log(`Accès téléphone arrêté sur ${ip}`); }
  for (const ip of want) {
    if (lan.has(ip)) continue;
    const l = { sockets: new Set(), server: null };
    l.server = net.createServer(sock => { l.sockets.add(sock); sock.on('close', () => l.sockets.delete(sock)); onConnection(sock); });
    l.server.on('error', e => { console.warn(`[réseau] ${ip} : ${e.message}`); lan.delete(ip); });
    l.server.listen(PORT, ip, () => console.log(`Accès téléphone → https://${ip}:${PORT}`));
    lan.set(ip, l);
  }
  if (access.enabled && httpsServer) { try { httpsServer.setSecureContext(localCert()); } catch { /* certificat inchangé */ } }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Freenary → http://localhost:${PORT}${httpsServer ? ` (et https://localhost:${PORT})` : ''}`);
  eb.startScheduler();
  syncLan();
  setInterval(syncLan, 60_000); // suit les changements de réseau (Wi-Fi, adresse IP)
});
