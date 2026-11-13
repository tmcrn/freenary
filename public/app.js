import { lineChart, donut, bars, sparkline } from './charts.js';

/* ───────── Utilitaires ───────── */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eur0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const signed = v => (v > 0 ? '+' : '') + eur.format(v);
/** Grand montant : euros en grand, centimes en exposant discret. */
const bigMoney = v => { const s = eur.format(v); const m = s.match(/^(.*?)(,\d{2})\s?€$/); return m ? `${esc(m[1])}<span class="cents">${m[2]} €</span>` : esc(s); };
const pct = v => (v >= 0 ? '+' : '') + v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
const pad = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => fmtDate(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmtDate(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const dLong = s => parse(s).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dShort = s => parse(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const dTip = s => parse(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const monthShort = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
const pretty = s => String(s || '').toLowerCase().replace(/(^|[\s'’\-./(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const relDay = s => { const n = daysBetween(today(), s); return n === 0 ? "Aujourd'hui" : n === 1 ? 'Demain' : n < 7 ? `Dans ${n} jours` : dShort(s); };
const qs = o => '?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3000); }

const I = {
  up: '<svg viewBox="0 0 24 24"><path d="M4 16l5-5 4 3 7-7M15 7h5v5"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M4 8l5 5 4-3 7 7M15 17h5v-5"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 5.2A10.4 10.4 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 00-14.6-4.5M4 4v4h4M4 13a8 8 0 0014.6 4.5M20 20v-4h-4"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="3.5"/><path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5"/></svg>',
};

const catIcon = (c, size = '') => `<span class="cat-icon ${size}" style="--c:${esc(c.color || '#E3DACB')}">${esc(c.icon || '•')}</span>`;

const hello = () => { const h = new Date().getHours(); return h < 5 || h >= 18 ? 'Bonsoir' : 'Bonjour'; };

/* ───────── État ───────── */
const PERIODS = { 'mtd': 'Depuis le début du mois', '30d': '30 derniers jours', '3m': '3 derniers mois', '6m': '6 derniers mois', '12m': '12 derniers mois', 'ytd': 'Depuis le 1er janvier' };
const state = {
  period: localStorage.getItem('period') || '6m',
  account: localStorage.getItem('account') || 'all',
  accounts: [], categories: [],
  q: '', category: '', showHidden: false, limit: 400,
  rows: new Map(),
};
function range() {
  const to = today();
  const back = { '30d': -30, '3m': -91, '6m': -182, '12m': -365 };
  const from = state.period === 'ytd' ? to.slice(0, 4) + '-01-01' : state.period === 'mtd' ? to.slice(0, 7) + '-01' : addDays(to, back[state.period] ?? -182);
  return { from, to };
}
const route = () => (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
const accountLabel = () => { const a = state.accounts.find(a => String(a.id) === String(state.account)); return a ? `${a.name} ${a.bank}` : 'Solde total'; };

const view = () => $('#view');
let token = 0;
let redraws = [];
const chart = fn => { redraws.push(fn); fn(); };

/* ───────── Démarrage ───────── */
async function boot() {
  await refreshRefs();
  const ps = $('#period');
  ps.innerHTML = Object.entries(PERIODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  ps.value = state.period;
  ps.onchange = () => { state.period = ps.value; localStorage.setItem('period', ps.value); render(); };

  const search = $('#search');
  search.addEventListener('keydown', e => { if (e.key === 'Enter') { state.q = search.value.trim(); if (route() !== 'transactions') location.hash = '#/transactions'; else renderView(); } });
  search.addEventListener('input', debounce(() => { if (route() === 'transactions') { state.q = search.value.trim(); renderView(); } }, 250));

  window.addEventListener('hashchange', render);
  window.addEventListener('resize', debounce(() => redraws.forEach(f => f()), 120));
  document.addEventListener('click', e => { if (!e.target.closest('#popover') && !e.target.closest('[data-pop]')) closePopover(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePopover(); closeModal(); } });
  document.addEventListener('click', globalActions);
  render();
}

async function refreshRefs() {
  [state.accounts, state.categories] = await Promise.all([api('/accounts'), api('/categories')]);
  const s = $('#account');
  s.innerHTML = '<option value="all">Tous les comptes</option>' + state.accounts.map(a => `<option value="${a.id}">${esc(a.name)} ${esc(a.bank)}</option>`).join('');
  if (!state.accounts.some(a => String(a.id) === String(state.account))) state.account = 'all';
  s.value = state.account;
  s.onchange = () => setAccount(s.value);
}

function setAccount(v) { state.account = String(v); localStorage.setItem('account', state.account); $('#account').value = state.account; render(); }

function render() {
  document.querySelectorAll('.sidebar a[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === route()));
  renderView();
  renderRightPanel();
}

async function renderView() {
  const t = ++token;
  redraws = [];
  const r = route();
  const fn = { dashboard: viewDashboard, transactions: viewTransactions, forecast: viewForecast, stats: viewStats, settings: viewSettings }[r] || viewDashboard;
  try { await fn(t); }
  catch (e) { if (t === token) view().innerHTML = `<section class="card"><h3>Oups</h3><p class="muted">${esc(e.message)}</p></section>`; console.error(e); }
}
const stale = t => t !== token;

function globalActions(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'add-recurring') openRecurringModal();
  if (act === 'import') openImportModal();
  if (act === 'all-accounts') setAccount('all');
  if (act === 'sync') syncNow(b);
}

async function syncNow(btn) {
  btn && (btn.disabled = true);
  try {
    const r = await api('/eb/sync', { method: 'POST' });
    toast(r.errors.length ? r.errors[0] : `Synchronisé : ${r.inserted} nouveau${r.inserted > 1 ? 'x' : ''} mouvement${r.inserted > 1 ? 's' : ''}`);
    await refreshRefs(); render();
  } catch (e) { toast(e.message); }
  finally { btn && (btn.disabled = false); }
}

/* ───────── Panneau droit ───────── */
async function renderRightPanel() {
  const el = $('#rightpanel');
  const recent = await api('/transactions' + qs({ limit: 7, account: state.account }));
  const total = state.accounts.reduce((s, a) => s + a.balance, 0);
  const sel = state.account;
  const hasEb = state.accounts.some(a => a.session_id);
  el.innerHTML = `
    <div class="rp-head"><h3>Mes comptes</h3><a class="round-btn" href="#/settings" title="Banques & réglages">${I.user}</a></div>
    <div class="cards-scroller">${state.accounts.map(a => bankCard(a, sel)).join('')}</div>
    <div class="dots">${state.accounts.map(a => `<i class="${String(a.id) === sel ? 'on' : ''}"></i>`).join('')}</div>
    <div class="rp-actions">
      <button class="btn primary" data-act="add-recurring">${I.plus} Prévoir un mouvement</button>
      ${hasEb ? `<button class="btn icon" data-act="sync" title="Synchroniser maintenant">${I.sync}</button>` : `<button class="btn icon" data-act="import" title="Importer un relevé CSV">${I.download}</button>`}
      <button class="btn icon" data-act="all-accounts" title="Tous les comptes">${I.grid}</button>
    </div>
    <div class="rp-total"><span>Sur tous tes comptes</span><strong>${eur.format(total)}</strong></div>
    <div class="rp-box">
    <div class="rp-section"><h3>Derniers mouvements</h3><a href="#/transactions" title="Tous les mouvements">${I.cal}</a></div>
    <ul class="tx-mini">${recent.rows.map(t => `
      <li>${catIcon(t)}<div class="t"><b>${esc(pretty(t.key || t.label))}</b><span>${esc(dShort(t.date))}, ${esc((t.category || '').toLowerCase())}</span></div>
      <span class="amount ${t.amount > 0 ? 'pos' : ''}">${signed(t.amount)}</span></li>`).join('') || '<li class="muted">Aucun mouvement</li>'}</ul>
    <a class="btn primary block" href="#/transactions">Voir tout</a>
    </div>`;
  el.querySelectorAll('.bank-card').forEach(c => c.addEventListener('click', () => setAccount(String(c.dataset.account) === sel ? 'all' : c.dataset.account)));
  const active = el.querySelector('.bank-card.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function bankCard(a, sel) {
  const [g1, g2] = (a.colors || '#C3B4EA,#D9CFF3').split(',');
  const isSel = String(a.id) === sel;
  const short = a.bank;
  return `<button class="bank-card ${isSel ? 'active' : sel !== 'all' ? 'dim' : ''}" data-account="${a.id}" style="--g1:${esc(g1)};--g2:${esc(g2)}">
    <div class="bc-top"><span class="chip"></span><span class="bc-bank">${esc(short)}</span></div>
    <div class="bc-balance">${eur.format(a.balance)}</div>
    <div class="bc-num">•••• •••• ${esc(a.last4 || '••••')}</div>
    <div class="bc-bottom"><span>${esc(a.name)}</span>${a.is_demo ? '<span class="demo-tag">DÉMO</span>' : `<span>${a.type === 'investment' ? (a.valuation === 'official' ? 'Placement, VL officielle' : 'Placement, estimé en direct') : a.type === 'savings' ? 'Épargne' : 'Courant'}${a.external_id || a.type === 'investment' ? '' : ', à la main'}</span>`}</div>
  </button>`;
}

/* ───────── Tableau de bord ───────── */
async function viewDashboard(t) {
  const { from, to } = range();
  const len = daysBetween(from, to);
  const account = state.account;
  const [cur, prev, st, fc] = await Promise.all([
    api('/series' + qs({ from, to, account })),
    api('/series' + qs({ from: addDays(from, -len), to: from, account })),
    api('/stats' + qs({ from, to, account })),
    api('/forecast' + qs({ days: 45, account })),
  ]);
  if (stale(t)) return;
  const pts = cur.points;
  const first = pts[0]?.[1] ?? 0, last = pts.at(-1)?.[1] ?? 0;
  const ch = first ? (last - first) / Math.abs(first) * 100 : 0;
  const p = st.period;
  const rate = p.income ? Math.round(p.net / p.income * 100) : 0;
  const cats = st.byCategory;
  const top = cats.slice(0, 5);
  const rest = cats.slice(5).reduce((s, c) => s + c.total, 0);
  const expTotal = cats.reduce((s, c) => s + c.total, 0) || 1;
  const months6 = st.monthly.slice(-6);
  const books = cats.slice(0, 9);
  const restBooks = cats.slice(9).reduce((s, c) => s + c.total, 0);
  if (restBooks) books.push({ name: 'Autres', icon: '📚', color: '#E3DACB', total: restBooks, other: true });
  const maxBook = Math.max(1, ...books.map(c => c.total));

  const week = fc.items.filter(i => daysBetween(today(), i.date) <= 7);
  view().innerHTML = `
    <div class="greet">
      <h1>${hello()} 👋</h1>
      <p>${week.length ? `${week.length === 1 ? 'Un mouvement est prévu' : `${week.length} mouvements sont prévus`} dans les sept prochains jours.` : 'Rien n’est prévu dans les sept prochains jours.'} Tu devrais finir le mois à <b>${eur0.format(fc.monthEnd)}</b>, et tu as mis de côté <b>${rate} %</b> de tes revenus sur la période.</p>
    </div>
    <section class="card hero tint-pink">
      <div class="hero-head">
        <div>
          <div class="eyebrow">${esc(accountLabel())}</div>
          <div class="hero-value"><span class="big">${bigMoney(last)}</span>
            <span class="pill ${ch >= 0 ? 'up' : 'down'}">${pct(ch)} ${ch >= 0 ? I.up : I.down}</span></div>
        </div>
        <div class="legend"><span><i style="background:var(--ink)"></i>Période actuelle</span><span><i style="background:transparent;border:1.5px dashed rgba(0,0,0,.45)"></i>Période précédente</span></div>
      </div>
      <div class="chart" id="c-balance"></div>
    </section>

    <section class="card shelf-card tint-white">
      <div class="card-head"><h3>Où part ton argent</h3><a href="#/stats" class="link">Voir le détail</a></div>
      ${books.length ? `<div class="shelf enter">${books.map((c, i) => {
        const r = c.total / maxBook;
        return `<button class="book ${r < .14 ? 'thin' : ''} ${c.name.length > 10 ? 'long' : ''} ${c.other ? 'leans' : ''}" style="--c:${esc(c.color)};--h:${(52 + 36 * r).toFixed(1)}%;--i:${i}" ${c.other ? 'data-other="1"' : `data-cat="${c.id}"`} title="${esc(c.name)} : ${eur.format(c.total)}" title="${esc(c.name)} : ${eur.format(c.total)}" aria-label="${esc(c.name)} : ${eur.format(c.total)}">
          ${i === 0 ? '<span class="ribbon"></span>' : ''}<span class="book-amt">${eur0.format(c.total)}</span>
          <span class="book-ico">${esc(c.icon)}</span><span class="book-name">${esc(c.name)}</span></button>`;
      }).join('')}</div>` : '<div class="empty">Aucune dépense sur la période.</div>'}
      <div class="plank"></div>
      <div class="shelf-legend"><span><b>${eur0.format(p.expense)}</b> dépensés depuis le ${esc(parse(from).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }))}</span>${books[0] ? `<span>${esc(books[0].name)} représente ${Math.round(books[0].total / expTotal * 100)} % du total</span>` : ''}</div>
    </section>

    <div class="dash-row">
      <div class="mini-col">
        <section class="card mini tint-yellow">
          <div><h4>Épargné sur la période</h4><div class="mini-value ${p.net < 0 ? 'neg' : ''}">${eur0.format(p.net)}</div>
          <div class="muted">${eur0.format(p.income)} reçus, ${eur0.format(p.expense)} dépensés</div></div>
          <div class="spark" id="s-net"></div>
        </section>
        <section class="card mini tint-blue">
          <div><h4>Taux d'épargne</h4><div class="mini-value">${rate}<small> %</small></div>
          <div class="muted">de tes revenus mis de côté</div></div>
          <div class="spark" id="s-rate"></div>
        </section>
      </div>
    <section class="card tint-green">
      <div class="card-head"><h3>À venir</h3><span style="color:rgba(23,23,26,.65)">Fin de mois estimée : <strong style="color:var(--ink)">${eur.format(fc.monthEnd)}</strong></span><a href="#/forecast" class="link">Prévisions</a></div>
      <div class="upcoming-list">${fc.items.slice(0, 6).map(it => `
        <div class="up-item">${catIcon(it, 'sm')}<div><div class="up-label">${esc(it.label)}</div><div class="muted">${relDay(it.date)}</div></div>
        <div class="amount ${it.amount > 0 ? 'pos' : ''}">${signed(it.amount)}</div></div>`).join('') || '<div class="muted">Aucun mouvement prévu. Ajoute tes abonnements depuis Prévisions.</div>'}</div>
    </section>
    </div>`;

  chart(() => lineChart($('#c-balance'), {
    labels: pts.map(p => p[0]),
    series: [
      { values: prev.points.map(p => p[1]), color: 'rgba(0,0,0,.3)', width: 1.8, dashed: true, name: 'Période préc.' },
      { values: pts.map(p => p[1]), color: '#000', width: 2.8, fill: true, fillColor: 'rgba(0,0,0,.06)' },
    ],
    height: 270, format: v => eur.format(v), xFormat: len > 120 ? (s => monthShort(s.slice(0, 7))) : dShort, tipFormat: dTip,
  }));
  const shelf = $('.shelf', view());
  if (shelf) setTimeout(() => shelf.classList.remove('enter'), 1300); // une seule fois, à l'arrivée
  shelf?.addEventListener('click', e => {
    const b = e.target.closest('.book');
    if (!b) return;
    if (b.dataset.other) { location.hash = '#/stats'; return; }
    state.category = b.dataset.cat; location.hash = '#/transactions';
  });
  chart(() => sparkline($('#s-net'), months6.map(m => m.income - m.expense), '#17171A'));
  chart(() => sparkline($('#s-rate'), months6.map(m => m.income ? (m.income - m.expense) / m.income * 100 : 0), '#17171A'));
}

/* ───────── Mouvements ───────── */
async function viewTransactions(t) {
  const { from, to } = range();
  const data = await api('/transactions' + qs({ from, to, account: state.account, category: state.category, q: state.q, hidden: state.showHidden ? 'include' : 'exclude', limit: state.limit }));
  if (stale(t)) return;
  state.rows = new Map(data.rows.map(r => [r.id, r]));
  $('#search').value = state.q;

  const groups = [];
  for (const r of data.rows) {
    if (!groups.length || groups.at(-1).date !== r.date) groups.push({ date: r.date, rows: [] });
    groups.at(-1).rows.push(r);
  }
  const tot = data.totals;
  view().innerHTML = `
    <section class="card">
      <div class="tx-toolbar">
        <div><h2>Mouvements</h2><div class="muted">${tot.n} mouvement${tot.n > 1 ? 's' : ''}, ${esc(PERIODS[state.period].toLowerCase())}${state.q ? `, recherche « ${esc(state.q)} »` : ''}</div></div>
        <div class="tx-kpis"><div><span class="muted">Entrées</span><strong class="pos">${eur.format(tot.inflow)}</strong></div><div><span class="muted">Sorties</span><strong>${eur.format(tot.outflow)}</strong></div></div>
        <div class="tx-tools">
          <label class="toggle"><input type="checkbox" id="showHidden" ${state.showHidden ? 'checked' : ''}><span></span>Afficher les masqués</label>
          <button class="btn secondary sm" data-act="import">${I.download} Importer CSV</button>
        </div>
      </div>
      <div class="chips">
        <button class="chip-btn ${!state.category ? 'on' : ''}" data-cat="">Toutes</button>
        ${state.categories.map(c => `<button class="chip-btn ${String(c.id) === String(state.category) ? 'on' : ''}" data-cat="${c.id}">${esc(c.icon)} ${esc(c.name)}</button>`).join('')}
      </div>
      <div class="tx-list">
        ${groups.map(g => {
          const sum = g.rows.filter(r => !r.hidden).reduce((s, r) => s + r.amount, 0);
          return `<div class="day-head"><span>${esc(dLong(g.date))}</span><span>${signed(Math.round(sum * 100) / 100)}</span></div>` + g.rows.map(txRow).join('');
        }).join('') || '<div class="empty">Aucun mouvement ne correspond.</div>'}
      </div>
      ${data.rows.length >= state.limit ? '<div class="load-more"><button class="btn ghost" id="more">Afficher plus</button></div>' : ''}
    </section>`;

  const v = view();
  $('#showHidden', v).onchange = e => { state.showHidden = e.target.checked; renderView(); };
  v.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { state.category = b.dataset.cat; renderView(); });
  $('#more', v)?.addEventListener('click', () => { state.limit += 400; renderView(); });
  v.querySelector('.tx-list').addEventListener('click', async e => {
    const hideBtn = e.target.closest('[data-hide]');
    if (hideBtn) {
      const r = state.rows.get(Number(hideBtn.dataset.hide));
      await api(`/transactions/${r.id}`, { method: 'PATCH', body: { hidden: !r.hidden } });
      toast(r.hidden ? 'Mouvement réaffiché' : 'Mouvement masqué — exclu des statistiques');
      renderView(); renderRightPanel();
      return;
    }
    const pill = e.target.closest('[data-pop]');
    if (pill) openCategoryPopover(pill, state.rows.get(Number(pill.dataset.pop)));
  });
}

const txRow = r => `
  <div class="tx-row ${r.hidden ? 'is-hidden' : ''}">
    ${catIcon(r)}
    <div><div class="tx-label">${esc(pretty(r.key || r.label))}</div><div class="tx-sub">${esc(r.label)}, ${esc(r.account_name.toLowerCase())} ${esc(r.bank)}</div></div>
    <button class="cat-pill" data-pop="${r.id}" style="--c:${esc(r.color || '#E3DACB')}">${esc(r.category || 'Sans catégorie')} ${I.chev}</button>
    <div class="amount ${r.amount > 0 ? 'pos' : ''}">${signed(r.amount)}</div>
    <button class="icon-btn" data-hide="${r.id}" title="${r.hidden ? 'Réafficher' : 'Masquer (exclure des stats)'}">${r.hidden ? I.eyeOff : I.eye}</button>
  </div>`;

function openCategoryPopover(anchor, tx) {
  const pop = $('#popover');
  pop.innerHTML = `
    <div class="pop-title">Catégorie</div>
    <div class="pop-list">${state.categories.map(c => `<button data-c="${c.id}" class="${c.id === tx.category_id ? 'sel' : ''}">${catIcon(c, 'sm')}<span>${esc(c.name)}</span></button>`).join('')}</div>
    <label class="pop-foot"><input type="checkbox" id="pop-similar" checked><span>Appliquer à tous les « ${esc(pretty(tx.key))} », y compris les prochains</span></label>`;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const h = pop.offsetHeight;
  pop.style.left = Math.min(r.left, innerWidth - 290) + 'px';
  pop.style.top = (r.bottom + 6 + h > innerHeight ? Math.max(10, r.top - h - 6) : r.bottom + 6) + 'px';
  pop.onclick = async e => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    const res = await api(`/transactions/${tx.id}`, { method: 'PATCH', body: { category_id: Number(b.dataset.c), applyToSimilar: $('#pop-similar').checked } });
    closePopover();
    toast(res.affected > 1 ? `${res.affected} mouvements recatégorisés, les prochains suivront` : 'Catégorie mise à jour');
    renderView(); renderRightPanel();
  };
}
function closePopover() { const p = $('#popover'); if (!p.hidden) { p.hidden = true; p.innerHTML = ''; } }

/* ───────── Prévisions ───────── */
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
function freqLabel(r) {
  if (r.frequency === 'weekly') return `Chaque ${WEEKDAYS[r.day ?? 1]}`;
  if (r.frequency === 'yearly') return `Chaque année le ${parse(r.start_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
  return `Tous les mois, le ${r.day}`;
}

async function viewForecast(t) {
  const account = state.account;
  const [fc, rec, sugg] = await Promise.all([api('/forecast' + qs({ days: 90, account })), api('/recurring'), api('/recurring/suggestions')]);
  if (stale(t)) return;
  const shown = rec.filter(r => account === 'all' || String(r.account_id) === account);
  const charges = shown.filter(r => r.active && r.amount < 0).reduce((s, r) => s + r.monthly, 0);
  const next30 = fc.items.filter(i => daysBetween(today(), i.date) <= 30);

  view().innerHTML = `
    <section class="card hero tint-blue">
      <div class="hero-head">
        <div><div class="eyebrow">Solde prévu dans 90 jours${state.account !== 'all' ? `, ${esc(accountLabel().toLowerCase())}` : ''}</div>
          <div class="hero-value"><span class="big">${bigMoney(fc.end)}</span><span class="pill ${fc.end >= fc.start ? 'up' : 'down'}">${signed(Math.round(fc.end - fc.start))}</span></div></div>
        <div class="kpi-inline">
          <div><span class="muted">Fin du mois</span><strong>${eur.format(fc.monthEnd)}</strong></div>
          <div><span class="muted">Point bas</span><strong class="${fc.min.value < 0 ? 'neg' : ''}">${eur.format(fc.min.value)}</strong><small>${esc(dShort(fc.min.date))}</small></div>
          <div><span class="muted">Charges fixes / mois</span><strong>${eur.format(charges)}</strong></div>
        </div>
      </div>
      <div class="chart" id="c-forecast"></div>
      <p class="note">Projection = mouvements prévus ci-dessous + dépenses courantes estimées (${eur.format(fc.dailyVariable)} / jour, moyenne des 90 derniers jours hors prélèvements récurrents et mouvements masqués).</p>
    </section>

    <div class="fc-grid">
      <section class="card">
        <div class="card-head"><h3>Mouvements récurrents</h3><span class="badge">${shown.length}</span><button class="btn primary sm" data-act="add-recurring">${I.plus} Ajouter</button></div>
        <div id="rec-list">${shown.map(r => `
          <div class="rec-row ${r.active ? '' : 'off'}">
            ${catIcon(r)}
            <div class="t"><b>${esc(r.label)}</b><span>${esc(freqLabel(r))}, ${esc((r.account_name || '').toLowerCase())} ${esc(r.bank || '')}</span></div>
            <div class="next">${r.next && r.active ? esc(relDay(r.next)) : '—'}</div>
            <div class="amount ${r.amount > 0 ? 'pos' : ''}">${signed(r.amount)}</div>
            <div class="rec-actions">
              <button class="icon-btn" data-rec-toggle="${r.id}" title="${r.active ? 'Suspendre' : 'Réactiver'}">${r.active ? I.pause : I.play}</button>
              <button class="icon-btn" data-rec-edit="${r.id}" title="Modifier">${I.edit}</button>
              <button class="icon-btn" data-rec-del="${r.id}" title="Supprimer">${I.trash}</button>
            </div>
          </div>`).join('') || '<div class="empty">Aucun mouvement récurrent.</div>'}</div>
      </section>
      <div class="fc-side">
        <section class="card tint-yellow">
          <div class="card-head"><h3>Abonnements détectés</h3><span class="badge">${sugg.length}</span></div>
          ${sugg.map((s, i) => `
            <div class="sugg">${catIcon(s, 'sm')}<div class="t"><b>${esc(pretty(s.key))}</b><span>Vu ${s.count} fois, vers le ${s.day} du mois</span></div>
            <span class="amount">${eur.format(s.amount)}</span><button class="btn secondary sm" data-sugg="${i}">Ajouter</button></div>`).join('') || '<p style="margin:0;color:rgba(23,23,26,.6)">Rien de nouveau : tes dépenses régulières sont déjà prévues.</p>'}
        </section>
        <section class="card tint-pink">
          <div class="card-head"><h3>30 prochains jours</h3></div>
          <ul class="timeline">${next30.map(i => `
            <li><div class="date"><b>${parse(i.date).getDate()}</b><span>${esc(parse(i.date).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''))}</span></div>
            <div class="t">${esc(i.label)}</div><div class="amount ${i.amount > 0 ? 'pos' : ''}">${signed(i.amount)}</div></li>`).join('') || '<li class="muted">Rien de prévu.</li>'}</ul>
        </section>
      </div>
    </div>`;

  chart(() => lineChart($('#c-forecast'), {
    labels: fc.points.map(p => p[0]),
    series: [{ values: fc.points.map(p => p[1]), color: '#000', width: 2.8, fill: true, fillColor: 'rgba(0,0,0,.06)' }],
    height: 240, format: v => eur.format(v), xFormat: dShort, tipFormat: dTip,
  }));

  $('.fc-grid', view()).addEventListener('click', async e => {
    const tg = e.target.closest('[data-rec-toggle]'), ed = e.target.closest('[data-rec-edit]'), del = e.target.closest('[data-rec-del]'), sg = e.target.closest('[data-sugg]');
    if (tg) { const r = rec.find(x => x.id === +tg.dataset.recToggle); await api(`/recurring/${r.id}`, { method: 'PATCH', body: { active: !r.active } }); renderView(); }
    if (ed) openRecurringModal(rec.find(x => x.id === +ed.dataset.recEdit));
    if (del) { const r = rec.find(x => x.id === +del.dataset.recDel); if (confirm(`Supprimer « ${r.label} » des prévisions ?`)) { await api(`/recurring/${r.id}`, { method: 'DELETE' }); toast('Prévision supprimée'); renderView(); } }
    if (sg) {
      const s = sugg[+sg.dataset.sugg];
      await api('/recurring', { method: 'POST', body: { label: pretty(s.key), pattern: s.key, amount: s.amount, frequency: 'monthly', day: s.day, category_id: s.category_id, account_id: s.account_id } });
      toast(`« ${pretty(s.key)} » ajouté aux prévisions`); renderView();
    }
  });
}

/* ───────── Modale : mouvement prévu ───────── */
function openModal(html) { const m = $('#modal'); m.innerHTML = `<div class="modal-box">${html}</div>`; m.hidden = false; m.onclick = e => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); }; return m; }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

function openRecurringModal(r = {}) {
  const isNew = !r.id;
  const defAcc = r.account_id || (state.account !== 'all' ? Number(state.account) : state.accounts.find(a => a.type === 'checking')?.id);
  const m = openModal(`
    <h3>${isNew ? 'Nouveau mouvement prévu' : 'Modifier la prévision'}</h3>
    <p class="sub">Abonnement, loyer, salaire… Il sera intégré au solde prévisionnel.</p>
    <form id="rec-form">
      <div class="seg">
        <label><input type="radio" name="sign" value="-1" ${r.amount > 0 ? '' : 'checked'}><span>Dépense</span></label>
        <label><input type="radio" name="sign" value="1" ${r.amount > 0 ? 'checked' : ''}><span>Revenu</span></label>
      </div>
      <label class="field"><span>Libellé</span><input name="label" required value="${esc(r.label || '')}" placeholder="Netflix, Loyer, Salaire…"></label>
      <div class="field-row">
        <label class="field"><span>Montant (€)</span><input name="amount" type="number" step="0.01" min="0.01" required value="${r.amount ? Math.abs(r.amount) : ''}"></label>
        <label class="field"><span>Fréquence</span><select name="frequency">
          <option value="monthly">Mensuelle</option><option value="weekly">Hebdomadaire</option><option value="yearly">Annuelle</option></select></label>
      </div>
      <div class="field-row">
        <label class="field f-monthly"><span>Jour du mois</span><input name="day" type="number" min="1" max="31" value="${r.frequency === 'monthly' && r.day ? r.day : new Date().getDate()}"></label>
        <label class="field f-weekly"><span>Jour</span><select name="weekday">${[1, 2, 3, 4, 5, 6, 0].map(d => `<option value="${d}" ${r.frequency === 'weekly' && r.day === d ? 'selected' : ''}>${WEEKDAYS[d]}</option>`).join('')}</select></label>
        <label class="field f-yearly"><span>Date</span><input name="yearly_date" type="date" value="${esc(r.start_date || today())}"></label>
        <label class="field"><span>Compte</span><select name="account_id">${state.accounts.map(a => `<option value="${a.id}" ${a.id === defAcc ? 'selected' : ''}>${esc(a.name)} ${esc(a.bank)}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Catégorie</span><select name="category_id">${state.categories.map(c => `<option value="${c.id}" ${c.id === r.category_id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select></label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary">Enregistrer</button></div>
    </form>`);
  const f = $('#rec-form', m);
  f.frequency.value = r.frequency || 'monthly';
  if (isNew) f.category_id.value = state.categories.find(c => c.name === 'Abonnements')?.id || f.category_id.value;
  const sync = () => ['monthly', 'weekly', 'yearly'].forEach(k => f.querySelector('.f-' + k).classList.toggle('hide', f.frequency.value !== k));
  f.frequency.onchange = sync; sync();
  f.label.focus();
  f.onsubmit = async e => {
    e.preventDefault();
    const fr = f.frequency.value;
    const body = {
      label: f.label.value.trim(),
      amount: Number(f.sign.value) * Math.abs(Number(f.amount.value)),
      frequency: fr,
      day: fr === 'monthly' ? Number(f.day.value) : fr === 'weekly' ? Number(f.weekday.value) : null,
      start_date: fr === 'yearly' ? f.yearly_date.value : (r.start_date || today()),
      category_id: Number(f.category_id.value),
      account_id: Number(f.account_id.value),
    };
    try {
      if (isNew) await api('/recurring', { method: 'POST', body }); else await api(`/recurring/${r.id}`, { method: 'PATCH', body });
      closeModal(); toast(isNew ? 'Prévision ajoutée' : 'Prévision mise à jour'); render();
    } catch (err) { toast(err.message); }
  };
}

/* ───────── Modale : import CSV ───────── */
function openImportModal() {
  // Les comptes synchronisés avec la banque n'ont pas besoin d'import (il recréerait tous leurs mouvements en double)
  const importable = state.accounts.filter(a => !a.external_id);
  if (!importable.length) {
    const m = openModal(`<h3>Importer un relevé CSV</h3>
      <p class="sub">Tes comptes bancaires se synchronisent déjà tout seuls : un import recréerait leurs mouvements en double. L'import sert aux comptes suivis à la main (livret, PEA…). Ajoute-en un dans « Banques & réglages ».</p>
      <div class="modal-actions"><button type="button" class="btn primary" data-close>Compris</button></div>`);
    return m;
  }
  const defAcc = importable.find(a => String(a.id) === state.account)?.id ?? importable[0].id;
  const m = openModal(`
    <h3>Importer un relevé CSV</h3>
    <p class="sub">Exporte tes opérations au format CSV depuis l'espace client de ta banque. Les doublons sont ignorés et chaque mouvement est classé automatiquement.</p>
    <form id="imp-form">
      <label class="field"><span>Compte</span><select name="account_id">${importable.map(a => `<option value="${a.id}" ${a.id === defAcc ? 'selected' : ''}>${esc(a.name)} ${esc(a.bank)}</option>`).join('')}</select></label>
      <label class="field"><span>Fichier</span><input name="file" type="file" accept=".csv,.txt,text/csv" required style="padding-top:10px"></label>
      <label class="field"><span>Solde actuel du compte (facultatif)</span><input name="balance" type="number" step="0.01" placeholder="ex. 1 234,56"></label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary">Importer</button></div>
    </form>`);
  const f = $('#imp-form', m);
  f.onsubmit = async e => {
    e.preventDefault();
    const buf = await f.file.files[0].arrayBuffer();
    let csv;
    try { csv = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { csv = new TextDecoder('windows-1252').decode(buf); }
    try {
      const r = await api('/import', { method: 'POST', body: { account_id: Number(f.account_id.value), csv, balance: f.balance.value } });
      closeModal(); toast(`${r.inserted} mouvement${r.inserted > 1 ? 's' : ''} importé${r.inserted > 1 ? 's' : ''}, ${r.skipped} doublon${r.skipped > 1 ? 's' : ''} ignoré${r.skipped > 1 ? 's' : ''}`);
      await refreshRefs(); render();
    } catch (err) { toast(err.message); }
  };
}

/* ───────── Statistiques ───────── */
async function viewStats(t) {
  const { from, to } = range();
  const len = daysBetween(from, to);
  const account = state.account;
  const [st, prev] = await Promise.all([
    api('/stats' + qs({ from, to, account })),
    api('/stats' + qs({ from: addDays(from, -len - 1), to: addDays(from, -1), account })),
  ]);
  if (stale(t)) return;
  const p = st.period, pp = prev.period;
  const rate = p.income ? p.net / p.income * 100 : 0, prate = pp.income ? pp.net / pp.income * 100 : 0;
  const delta = (cur, old, higherIsBad = false) => {
    if (!old) return '<span class="delta muted">—</span>';
    const d = (cur - old) / Math.abs(old) * 100;
    const good = higherIsBad ? d <= 0 : d >= 0;
    return `<span class="delta ${good ? 'good' : 'bad'}">${pct(d)} vs période préc.</span>`;
  };
  const kpi = (label, value, d, accent) => `<section class="card kpi tint-${accent}"><div class="label">${label}</div><div class="value">${value}</div>${d}</section>`;
  const prevByCat = new Map(prev.byCategory.map(c => [c.id, c.total]));
  const maxCat = Math.max(1, ...st.byCategory.map(c => c.total));
  const expTotal = st.byCategory.reduce((s, c) => s + c.total, 0) || 1;

  view().innerHTML = `
    <div class="kpi-row">
      ${kpi('Revenus', eur0.format(p.income), delta(p.income, pp.income), 'green')}
      ${kpi('Dépenses', eur0.format(p.expense), delta(p.expense, pp.expense, true), 'pink')}
      ${kpi("Taux d'épargne", Math.round(rate) + ' %', `<span class="delta ${rate >= prate ? 'good' : 'bad'}">${(rate - prate >= 0 ? '+' : '') + Math.round(rate - prate)} pts vs période préc.</span>`, 'blue')}
      ${kpi('Dépense moyenne / jour', eur.format(p.expense / (len + 1)), delta(p.expense / (len + 1), pp.expense / (len + 1), true), 'yellow')}
    </div>
    <section class="card tint-white">
      <div class="card-head"><h3>Revenus et dépenses par mois</h3>
        <div class="legend"><span><i style="background:#17171A"></i>Revenus</span><span><i style="background:#F5B6D7"></i>Dépenses</span></div></div>
      <div class="chart" id="c-bars"></div>
    </section>
    <div class="stats-grid">
      <section class="card">
        <div class="card-head"><h3>Répartition des dépenses</h3><span class="muted">évolution vs période précédente</span></div>
        ${st.byCategory.map(c => {
          const old = prevByCat.get(c.id);
          const d = old ? (c.total - old) / old * 100 : null;
          return `<div class="cat-bar-row" style="--c:${esc(c.color)}">${catIcon(c, 'sm')}<span class="name">${esc(c.name)}</span>
            <div class="track"><i style="width:${(c.total / maxCat * 100).toFixed(1)}%"></i></div>
            <span class="val">${eur0.format(c.total)}</span>
            <span class="delta ${d == null ? 'muted' : d <= 0 ? 'good' : 'bad'}">${d == null ? Math.round(c.total / expTotal * 100) + ' %' : pct(d)}</span></div>`;
        }).join('') || '<div class="empty">Aucune dépense sur la période.</div>'}
      </section>
      <section class="card">
        <div class="card-head"><h3>Où va l'argent</h3><span class="muted">top marchands</span></div>
        <ul class="merchants">${st.topMerchants.map((m, i) => `
          <li><span class="rank">${i + 1}</span>${catIcon(m, 'sm')}<div class="t"><b>${esc(pretty(m.key))}</b><span>${m.n} opération${m.n > 1 ? 's' : ''}, ${esc(m.category.toLowerCase())}</span></div><span class="amount">${eur0.format(m.total)}</span></li>`).join('') || '<li class="muted">—</li>'}</ul>
      </section>
    </div>`;

  chart(() => bars($('#c-bars'), st.monthly.map(m => ({ label: monthShort(m.month), income: m.income, expense: m.expense })), {
    keys: ['income', 'expense'], names: ['Revenus', 'Dépenses'], colors: ['#17171A', '#F5B6D7'], height: 250, format: v => eur.format(v),
  }));
}

/* ───────── Réglages & connexion bancaire ───────── */
async function viewSettings(t) {
  const st = await api('/eb/status');
  // La gestion de l'accès téléphone n'existe que depuis le Mac lui-même
  const onMac = ['localhost', '127.0.0.1'].includes(location.hostname);
  const acc = onMac ? await api('/access').catch(() => null) : null;
  if (stale(t)) return;
  const demo = state.accounts.filter(a => a.is_demo).length;
  const manual = state.accounts.filter(a => !a.external_id && !a.is_demo);
  const fmtDT = s => s ? new Date(s).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'jamais';

  view().innerHTML = `
    <div class="settings-grid">
      <section class="card">
        <div class="card-head"><h3>Banques connectées</h3>
          ${st.sessions.length ? `<button class="btn secondary sm" data-act="sync" ${st.configured ? '' : 'disabled'}>${I.sync} Synchroniser</button>` : ''}
          <button class="btn primary sm" id="connect" ${st.configured ? '' : 'disabled'}>${I.plus} Connecter une banque</button></div>
        ${st.sessions.map(s => `
          <div class="session">
            <span class="cat-icon" style="--c:#B4C7F0">🏦</span>
            <div class="t"><b>${esc(s.aspsp_name)}</b>
              <span>${s.accounts.map(a => `${esc(a.name)} ••${esc(a.last4 || '')}`).join(', ') || 'Aucun compte'}</span>
              <span>Dernière synchro : ${fmtDT(s.last_sync)}</span><span>Accès autorisé jusqu’au ${s.valid_until ? new Date(s.valid_until).toLocaleDateString('fr-FR') : '?'}</span>
              ${s.last_error ? `<span class="err-msg">${esc(s.last_error)}</span>` : ''}</div>
            <span class="status-dot ${s.expired ? 'err' : s.last_error ? 'warn' : 'ok'}">${s.expired ? 'Expiré' : s.last_error ? 'Erreur' : 'Actif'}</span>
            ${s.expired || s.last_error ? `<button class="btn primary sm" data-reconnect="${esc(s.aspsp_name)}" data-country="${esc(s.aspsp_country)}">Reconnecter</button>` : ''}
            <button class="icon-btn" data-del-session="${esc(s.session_id)}" title="Déconnecter">${I.trash}</button>
          </div>`).join('') || `<p class="muted" style="margin:0 0 8px">Aucune banque connectée pour l'instant${st.configured ? '.' : ' : configure d’abord Enable Banking ci-contre.'}</p>`}
        <div id="bank-picker"></div>
        <details style="margin-top:14px">
          <summary class="muted" style="cursor:pointer;font-size:12.5px">La redirection ne revient pas sur l'app ? Colle l'URL finale ici</summary>
          <form id="manual" style="display:flex;gap:10px;margin-top:10px">
            <label class="field" style="margin:0"><input name="url" placeholder="https://…?code=…&state=…" required></label>
            <button class="btn secondary">Valider</button>
          </form>
        </details>
        <p class="note">Synchronisation automatique toutes les ${st.sync_hours} h tant que l'app tourne (≈ 4 fois/jour, la limite usuelle des banques). Le consentement DSP2 est à renouveler tous les ~180 jours.</p>
      </section>

      <section class="card tint-white">
        <div class="card-head"><h3>Enable Banking</h3><span class="status-dot ${st.configured ? 'ok' : 'warn'}">${st.configured ? 'Configuré' : 'À configurer'}</span></div>
        <ol class="steps">
          <li>Crée un compte sur <b>enablebanking.com</b>, puis une application <b>Production</b> dans le Control Panel. Garde le fichier de clé privée <code>.pem</code>.</li>
          <li>Dans l'application, ajoute l'URL de redirection : <code>${esc(st.redirect_url)}</code></li>
          <li>Active-la avec « Activate by linking accounts » (mode restreint : uniquement tes propres comptes, usage personnel).</li>
          <li>Colle ci-dessous l'<b>Application ID</b> et la clé privée, puis « Connecter une banque ».</li>
        </ol>
        <form id="eb-form" style="margin-top:16px">
          <label class="field"><span>Application ID</span><input name="application_id" value="${esc(st.application_id)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></label>
          <label class="field"><span>Clé privée (.pem) ${st.has_key ? '— <span class="pos">déjà enregistrée</span>' : ''}</span>
            <textarea name="private_key" placeholder="${st.has_key ? 'Laisse vide pour conserver la clé actuelle' : '-----BEGIN PRIVATE KEY-----\n…'}"></textarea></label>
          <label class="field"><span>Ou choisis le fichier .pem</span><input type="file" name="pem" accept=".pem,.key,.txt" style="padding-top:10px"></label>
          <label class="field"><span>URL de redirection</span><input name="redirect_url" value="${esc(st.redirect_url)}"></label>
          <div class="modal-actions"><button class="btn primary">Enregistrer</button></div>
        </form>
        <p class="note">La clé reste sur ton Mac (<code>data/enablebanking.pem</code>, droits 600) et n'est jamais renvoyée au navigateur.</p>
      </section>

      <section class="card tint-yellow">
        <div class="card-head"><h3>Comptes suivis à la main</h3>${manual.length ? `<span class="badge">${manual.length}</span>` : ''}</div>
        <p class="note" style="margin:0 0 14px">Livrets, PEA, assurance-vie… Les banques ne les transmettent pas par Enable Banking : la directive européenne ne couvre que les comptes courants. Saisis leur solde ici et mets-le à jour de temps en temps.</p>
        ${manual.map(a => `
          <form class="session manual-acc" data-id="${a.id}">
            <span class="cat-icon" style="--c:${a.type === 'investment' ? '#C3B4EA' : '#A9DDBD'}">${a.type === 'investment' ? '📈' : '🐷'}</span>
            <div class="t"><b>${esc(a.name)}</b><span>${esc(a.bank)}, solde saisi le ${new Date(a.updated_at).toLocaleDateString('fr-FR')}</span>
              <span class="links-summary" data-links-for="${a.id}"></span></div>
            <label class="field" style="margin:0;max-width:150px"><input name="balance" type="number" step="0.01" value="${a.balance}" aria-label="Solde de ${esc(a.name)}"></label>
            <button class="btn secondary sm">Mettre à jour</button>
            ${a.type === 'investment' ? `<button type="button" class="btn primary sm" data-pos-acc="${a.id}">Positions</button>` : ''}
            <button type="button" class="btn ghost sm" data-link-acc="${a.id}">Lier des virements</button>
            <button type="button" class="icon-btn" data-del-acc="${a.id}" title="Supprimer ce compte">${I.trash}</button>
          </form>`).join('')}
        <form id="add-manual" style="margin-top:${manual.length ? 14 : 0}px">
          <div class="field-row">
            <label class="field"><span>Banque</span><input name="bank" required placeholder="Crédit Agricole" list="banks-list"></label>
            <label class="field"><span>Nom du compte</span><input name="name" required placeholder="Livret A, LDDS, PEA…"></label>
          </div>
          <div class="field-row">
            <label class="field"><span>Type</span><select name="type"><option value="savings">Épargne (livret)</option><option value="investment">Placement (PEA, assurance-vie)</option></select></label>
            <label class="field"><span>Solde ou valorisation (€)</span><input name="balance" type="number" step="0.01" required></label>
          </div>
          <datalist id="banks-list"><option value="Crédit Agricole"><option value="BoursoBank"></datalist>
          <div class="modal-actions"><button class="btn primary">${I.plus} Ajouter ce compte</button></div>
        </form>
      </section>

      ${acc ? `
      <section class="card tint-blue">
        <div class="card-head"><h3>Accès depuis le téléphone</h3><span class="status-dot ${acc.enabled ? 'ok' : 'warn'}">${acc.enabled ? 'Activé' : 'Désactivé'}</span></div>
        <p class="note" style="margin:0 0 14px">Ouvre Freenary sur ton iPhone, tant que le Mac est allumé, que Freenary tourne et que les deux sont sur le même Wi-Fi. Ton mot de passe est demandé sur le téléphone, pas sur le Mac.</p>
        ${acc.enabled ? `
        <div class="session" style="flex-direction:column;align-items:stretch;gap:6px">
          <b>Adresse à ouvrir dans Safari</b>
          ${acc.urls.map((u, i) => `<div style="display:flex;align-items:center;gap:8px"><code style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(u)}</code><button type="button" class="btn secondary sm" data-copy="${esc(u)}">Copier</button></div>${i === 0 ? '<span class="muted" style="font-size:12px;margin-top:-2px">Préfère cette adresse : elle ne change pas, contrairement aux adresses numériques ci-dessous.</span>' : ''}`).join('') || '<span class="muted">Aucune adresse réseau trouvée : connecte le Mac au Wi-Fi.</span>'}
        </div>` : ''}
        <form id="access-form" style="margin-top:14px">
          <label class="field"><span>${acc.has_password ? 'Nouveau mot de passe (laisse vide pour garder l’actuel)' : 'Choisis un mot de passe (8 caractères minimum)'}</span><input name="password" type="password" autocomplete="new-password" minlength="8"></label>
          <label class="toggle"><input type="checkbox" name="enabled" ${acc.enabled ? 'checked' : ''}><span></span>Autoriser l'accès depuis mon Wi-Fi</label>
          <div class="modal-actions" style="justify-content:flex-start;margin-top:14px">
            <button class="btn primary">Enregistrer</button>
            ${acc.enabled ? '<button type="button" class="btn ghost" id="access-revoke">Déconnecter tous les téléphones</button>' : ''}
          </div>
        </form>
        <ol class="steps" style="margin-top:16px">
          <li>La première fois, macOS peut demander d'autoriser les connexions entrantes pour Node : accepte.</li>
          <li>Sur le téléphone, Safari avertit que la connexion n'est pas privée : le certificat est celui de ton Mac. Touche « Afficher les détails », puis « Visiter ce site web ».</li>
          <li>Facultatif, pour supprimer l'avertissement et installer Freenary sur l'écran d'accueil : ouvre <code>/cert</code> sur le téléphone, installe le profil, puis active-le dans Réglages › Général › Informations › Réglages des certificats.</li>
        </ol>
        <p class="note">Hors de chez toi, ça ne marche pas : le Mac n'est joignable que sur ton réseau. Les actions sensibles (connexion bancaire, clé Enable Banking) restent réservées au Mac.</p>
      </section>` : ''}

      <section class="card">
        <div class="card-head"><h3>Données</h3></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn secondary" data-act="import">${I.download} Importer un CSV</button>
          ${demo ? `<button class="btn danger" id="clear-demo">${I.trash} Supprimer les données de démo (${demo} comptes)</button>` : ''}
        </div>
        <p class="note">Tant que tu n'as rien connecté, l'app affiche des comptes fictifs pour la démonstration.</p>
      </section>
    </div>`;

  const v = view();
  $('#eb-form', v).onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    let key = f.private_key.value.trim();
    if (!key && f.pem.files[0]) key = (await f.pem.files[0].text()).trim();
    try {
      await api('/eb/config', { method: 'POST', body: { application_id: f.application_id.value, redirect_url: f.redirect_url.value, ...(key ? { private_key: key } : {}) } });
      toast('Configuration enregistrée'); renderView();
    } catch (err) { toast(err.message); }
  };
  $('#connect', v).onclick = () => showBankPicker();
  $('#manual', v).onsubmit = async e => {
    e.preventDefault();
    try { const r = await api('/eb/complete', { method: 'POST', body: { url: e.target.url.value.trim() } }); toast(`${r.accounts} compte(s) relié(s)`); await refreshRefs(); render(); }
    catch (err) { toast(err.message); }
  };
  // Résumé des virements liés sous chaque compte manuel
  for (const a of manual) {
    api(`/accounts/${a.id}/links`).then(links => {
      const el = v.querySelector(`[data-links-for="${a.id}"]`);
      if (el) el.textContent = links.length ? `Mis à jour par ${links.length} virement${links.length > 1 ? 's' : ''} lié${links.length > 1 ? 's' : ''} (${links.reduce((s, l) => s + l.applied, 0)} reporté${links.reduce((s, l) => s + l.applied, 0) > 1 ? 's' : ''})` : 'Aucun virement lié : solde mis à jour à la main';
    }).catch(() => {});
  }
  v.querySelectorAll('[data-pos-acc]').forEach(b => b.onclick = () => openPortfolioModal(state.accounts.find(x => x.id === Number(b.dataset.posAcc))));
  v.querySelectorAll('[data-link-acc]').forEach(b => b.onclick = () => openLinksModal(state.accounts.find(x => x.id === Number(b.dataset.linkAcc))));
  $('#add-manual', v).onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/accounts', { method: 'POST', body: { bank: f.bank.value, name: f.name.value, type: f.type.value, balance: f.balance.value } });
      toast(`« ${f.name.value.trim()} » ajouté`); await refreshRefs(); render();
    } catch (err) { toast(err.message); }
  };
  v.querySelectorAll('.manual-acc').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    try { await api(`/accounts/${f.dataset.id}`, { method: 'PATCH', body: { balance: f.balance.value } }); toast('Solde mis à jour'); await refreshRefs(); render(); }
    catch (err) { toast(err.message); }
  });
  v.querySelectorAll('[data-del-acc]').forEach(b => b.onclick = async () => {
    const a = state.accounts.find(x => x.id === Number(b.dataset.delAcc));
    if (!confirm(`Supprimer « ${a.name} » et son historique de soldes ? C'est définitif.`)) return;
    await api(`/accounts/${a.id}`, { method: 'DELETE' }); toast('Compte supprimé'); await refreshRefs(); render();
  });
  v.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Adresse copiée'); } catch { toast('Copie impossible : sélectionne l’adresse à la main.'); } });
  $('#access-form', v)?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/access', { method: 'PUT', body: { ...(f.password.value ? { password: f.password.value } : {}), enabled: f.enabled.checked } });
      toast(f.enabled.checked ? 'Accès depuis le téléphone activé' : 'Accès depuis le téléphone désactivé'); renderView();
    } catch (err) { toast(err.message); }
  });
  $('#access-revoke', v)?.addEventListener('click', async () => {
    if (!confirm('Déconnecter tous les téléphones ? Ils devront retaper le mot de passe.')) return;
    await api('/access/logout-all', { method: 'POST' }); toast('Tous les téléphones sont déconnectés');
  });
  $('#clear-demo', v)?.addEventListener('click', async () => {
    if (!confirm('Supprimer définitivement les comptes de démonstration et leurs mouvements ?')) return;
    await api('/demo/clear', { method: 'POST' }); toast('Données de démo supprimées'); await refreshRefs(); render();
  });
  v.querySelectorAll('[data-reconnect]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { const r = await api('/eb/auth', { method: 'POST', body: { name: b.dataset.reconnect, country: b.dataset.country } }); location.href = r.url; }
    catch (err) { toast(err.message); b.disabled = false; }
  });
  v.querySelectorAll('[data-del-session]').forEach(b => b.onclick = async () => {
    if (!confirm('Déconnecter cette banque ? Les mouvements déjà importés sont conservés.')) return;
    await api(`/eb/sessions/${encodeURIComponent(b.dataset.delSession)}`, { method: 'DELETE' }); toast('Banque déconnectée'); await refreshRefs(); render();
  });
}

const pct2 = v => (v >= 0 ? '+' : '') + (v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' %';
const units = v => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 4 });

async function openPortfolioModal(acc) {
  const m = openModal('<div class="skeleton" style="height:180px"></div>');
  let pf;
  try { pf = await api(`/accounts/${acc.id}/portfolio`); } catch (e) { closeModal(); toast(e.message); return; }
  let rows = pf.lines.map(l => ({ id: l.id, isin: l.isin, symbol: l.symbol, proxy_symbol: l.proxy_symbol, name: l.name, quantity: l.quantity, alloc: l.alloc, cost: l.cost, live: l.live, value: l.value }));
  const box = $('.modal-box', m);
  const draw = () => {
    const total = rows.reduce((s, r) => s + (r.value || 0), 0) + Number(pf.cash || 0);
    const allocSum = rows.reduce((s, r) => s + (Number(r.alloc) || 0), 0);
    box.innerHTML = `
      <h3>Positions de « ${esc(acc.name)} »</h3>
      <p class="sub">Saisis tes parts une fois. La valeur suit ensuite les cours : VL officielle, estimée en direct pour les fonds à partir de l'ETF qu'ils suivent. Les versements liés sont convertis en parts selon la répartition.</p>
      <form id="pf-form">
        <div class="pf-list">${rows.map((r, i) => `
          <div class="pf-row" data-i="${i}">
            <div class="pf-name"><b>${esc(r.name)}</b><span>${esc(r.isin || r.symbol)}${r.live ? `, ${r.live.estimated ? `VL estimée ${eur.format(r.live.price)} (officielle ${eur.format(r.live.official)} du ${esc(dShort(r.live.officialDate))}, ${pct2(r.live.proxy.change)} depuis)` : `cours ${eur.format(r.live.price)} du ${esc(dShort(r.live.date))}`}` : ', cours en attente'}</span></div>
            <label class="field"><span>Parts</span><input name="quantity" type="number" step="any" min="0" value="${r.quantity ?? ''}" required></label>
            <label class="field"><span>% versements</span><input name="alloc" type="number" step="any" min="0" max="100" value="${r.alloc ?? 0}"></label>
            <label class="field"><span>Investi (€)</span><input name="cost" type="number" step="0.01" min="0" value="${r.cost ?? ''}" placeholder="facultatif"></label>
            <div class="pf-val"><b>${r.value != null ? eur.format(r.value) : '—'}</b>${r.value != null && r.cost ? `<span class="${r.value >= r.cost ? 'pos' : 'neg'}">${pct2(r.value / r.cost - 1)}</span>` : ''}</div>
            <button type="button" class="icon-btn" data-rm="${i}" title="Retirer cette ligne">${I.trash}</button>
          </div>`).join('') || '<p class="muted" style="margin:0 0 8px">Aucune ligne pour l’instant.</p>'}</div>
        <div class="pf-add">
          <label class="field" style="margin:0"><input id="pf-q" placeholder="ISIN ou ticker (ex. FR001400RWK6 pour Bourso Monde)"></label>
          <button type="button" class="btn secondary" id="pf-search">${I.plus} Ajouter</button>
        </div>
        <div class="pf-quick">Raccourcis : <button type="button" class="link" data-q="FR001400RWK6">Bourso Monde</button> <button type="button" class="link" data-q="FR001400RWL4">Bourso US</button></div>
        ${pf.total_live != null ? `
        <div class="seg" id="pf-mode" style="margin-top:14px">
          <label><input type="radio" name="mode" value="live" ${pf.mode !== 'official' ? 'checked' : ''}><span>Valeur en direct</span></label>
          <label><input type="radio" name="mode" value="official" ${pf.mode === 'official' ? 'checked' : ''}><span>Valeur officielle</span></label>
        </div>
        <p class="note" style="margin-top:0"><b>En direct : ${eur.format(pf.total_live)}</b>, estimée aujourd'hui à partir des ETF que suivent tes fonds. <b>Officielle : ${eur.format(pf.total_official)}</b>, dernière valeur liquidative publiée (${esc(dShort(pf.lines[0]?.live?.officialDate || today()))}), celle qu'affiche ton appli de courtier, avec quelques jours de retard.</p>` : ''}
        <div class="field-row" style="margin-top:14px">
          <label class="field"><span>Espèces sur le compte (€)</span><input id="pf-cash" type="number" step="0.01" value="${pf.cash ?? 0}"></label>
          <div class="field"><span>Valeur totale</span><div class="pf-total">${eur.format(total)}</div></div>
        </div>
        ${allocSum && Math.abs(allocSum - 100) > 0.01 ? `<p class="note">La répartition des versements fait ${allocSum} % : le reste restera en espèces.</p>` : ''}
        <div class="modal-actions"><button type="button" class="btn ghost" data-close>Fermer</button><button class="btn primary">Enregistrer</button></div>
      </form>`;
    const read = () => box.querySelectorAll('.pf-row').forEach(el => { const r = rows[+el.dataset.i]; r.quantity = el.querySelector('[name=quantity]').value; r.alloc = el.querySelector('[name=alloc]').value; r.cost = el.querySelector('[name=cost]').value; });
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { read(); rows.splice(+b.dataset.rm, 1); draw(); });
    const add = async q => {
      read();
      try {
        const ins = await api('/instruments/resolve?q=' + encodeURIComponent(q));
        if (rows.some(r => r.symbol === ins.symbol)) { toast('Cette ligne est déjà dans la liste'); return; }
        rows.push({ isin: ins.isin, symbol: ins.symbol, proxy_symbol: ins.proxy_symbol, name: ins.name, quantity: '', alloc: 0, cost: '' });
        draw(); box.querySelector('.pf-row:last-child [name=quantity]')?.focus();
      } catch (e) { toast(e.message); }
    };
    box.querySelectorAll('#pf-mode [name=mode]').forEach(r => r.onchange = async () => {
      try {
        pf = await api(`/accounts/${acc.id}/valuation`, { method: 'PUT', body: { mode: r.value } });
        rows = pf.lines.map(l => ({ ...l }));
        toast(r.value === 'official' ? `Valeur officielle : ${eur.format(pf.total)}` : `Valeur en direct : ${eur.format(pf.total)}`);
        await refreshRefs(); renderRightPanel(); draw();
      } catch (err) { toast(err.message); }
    });
    $('#pf-search', box).onclick = () => add($('#pf-q', box).value);
    $('#pf-q', box).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(e.target.value); } };
    box.querySelectorAll('[data-q]').forEach(b => b.onclick = () => add(b.dataset.q));
    $('#pf-form', box).onsubmit = async e => {
      e.preventDefault(); read();
      try {
        pf = await api(`/accounts/${acc.id}/portfolio`, { method: 'PUT', body: { positions: rows, cash: $('#pf-cash', box).value } });
        rows = pf.lines.map(l => ({ ...l }));
        toast(`Valeur du compte : ${eur.format(pf.total ?? 0)}`);
        await refreshRefs(); renderRightPanel(); draw();
      } catch (err) { toast(err.message); }
    };
  };
  draw();
}

async function openLinksModal(acc) {
  const m = openModal('<div class="skeleton" style="height:160px"></div>');
  let cands;
  try { cands = await api(`/accounts/${acc.id}/link-candidates`); } catch (e) { closeModal(); toast(e.message); return; }
  const since = new Date(acc.updated_at).toLocaleDateString('fr-FR');
  $('.modal-box', m).innerHTML = `
    <h3>Mettre à jour « ${esc(acc.name)} » automatiquement</h3>
    <p class="sub">Coche ce qui alimente ce compte : les virements <b>sortants</b> de ton compte courant sont des versements (le solde monte), les <b>entrants</b> sont des retraits (le solde baisse). Seuls les virements postérieurs au ${since}, date de ton dernier solde saisi, sont pris en compte.</p>
    <form id="links-form">
      <div class="link-list">${cands.map((c, i) => `
        <label class="link-opt ${c.saving ? 'reco' : ''}">
          <input type="checkbox" name="l" value="${i}" ${c.linked ? 'checked' : ''}>
          <span class="t"><b>${esc(pretty(c.pattern))}</b>
            <span>${esc(c.account_name)} ${esc(c.bank)}, ${c.direction === 'out' ? 'sortants' : 'entrants'}, ${c.n} fois, dernier le ${esc(dShort(c.last))}</span>
            <span class="ex">${esc(c.example)}</span></span>
          <span class="amt">${c.out ? `<span>−${eur0.format(c.out)}</span>` : ''}${c.in ? `<span class="pos">+${eur0.format(c.in)}</span>` : ''}</span>
        </label>`).join('') || '<p class="muted">Aucun virement vers tes propres comptes trouvé pour l’instant.</p>'}</div>
      <p class="note">Les virements surlignés en rose évoquent l'épargne (PEA, livret, plan d'épargne). Pour un PEA, seuls les versements sont suivis : mets à jour la valorisation de temps en temps pour refléter la bourse.</p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary">Enregistrer</button></div>
    </form>`;
  $('#links-form', m).onsubmit = async e => {
    e.preventDefault();
    const links = [...e.target.querySelectorAll('input[name=l]:checked')].map(i => cands[+i.value]).map(c => ({ source_account_id: c.source_account_id, pattern: c.pattern, direction: c.direction }));
    try {
      const r = await api(`/accounts/${acc.id}/links`, { method: 'PUT', body: { links } });
      closeModal();
      toast(links.length ? `${links.length} virement${links.length > 1 ? 's' : ''} lié${links.length > 1 ? 's' : ''}${r.applied ? `, ${r.applied} déjà reporté${r.applied > 1 ? 's' : ''}` : ''}` : 'Liens retirés');
      await refreshRefs(); render();
    } catch (err) { toast(err.message); }
  };
}

async function showBankPicker() {
  const box = $('#bank-picker');
  box.innerHTML = '<div class="skeleton" style="height:120px;margin-top:12px"></div>';
  try {
    const list = await api('/eb/aspsps?country=FR');
    const isReco = a => /agricole|bourso/i.test(a.name);
    list.sort((a, b) => (isReco(b) - isReco(a)) || a.name.localeCompare(b.name));
    box.innerHTML = `
      <label class="field" style="margin:14px 0 0"><input id="bank-q" placeholder="Rechercher ta banque (ex. Crédit Agricole Île-de-France)"></label>
      <div class="bank-list">${list.map((a, i) => `<button class="bank-opt ${isReco(a) ? 'reco' : ''}" data-i="${i}">${a.logo ? `<img src="${esc(a.logo)}" alt="">` : '🏦'}<span>${esc(a.name)}</span></button>`).join('')}</div>`;
    $('#bank-q').oninput = e => { const q = e.target.value.toLowerCase(); box.querySelectorAll('.bank-opt').forEach(b => b.classList.toggle('hide', !b.textContent.toLowerCase().includes(q))); };
    box.querySelectorAll('.bank-opt').forEach(b => b.onclick = async () => {
      const a = list[+b.dataset.i];
      b.disabled = true;
      try { const r = await api('/eb/auth', { method: 'POST', body: a }); location.href = r.url; }
      catch (err) { toast(err.message); b.disabled = false; }
    });
  } catch (e) { box.innerHTML = `<p class="err-msg" style="color:var(--red)">${esc(e.message)}</p>`; }
}

boot();
