// Graphiques SVG faits main (aucune dépendance) : courbe lissée, donut, barres, sparkline.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let uid = 0;

export function niceScale(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  if (min === max) { min -= Math.abs(min) * 0.1 || 1; max += Math.abs(max) * 0.1 || 1; }
  const rough = (max - min) / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const n = rough / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(8)));
  return { lo, hi, ticks };
}

const compact = v => {
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: a >= 10000 ? 0 : 1 }) + ' k';
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
};

/** Courbe monotone (pas de dépassement entre deux points) — Fritsch–Carlson. */
function smoothPath(p) {
  const n = p.length;
  if (!n) return '';
  if (n === 1) return `M${p[0][0]},${p[0][1]}`;
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; m[i] = (p[i + 1][1] - p[i][1]) / (dx[i] || 1); }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0;
    else { const w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1]; t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]); }
  }
  t[n - 1] = m[n - 2];
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(p[i][0] + h).toFixed(1)},${(p[i][1] + t[i] * h).toFixed(1)} ${(p[i + 1][0] - h).toFixed(1)},${(p[i + 1][1] - t[i + 1] * h).toFixed(1)} ${p[i + 1][0].toFixed(1)},${p[i + 1][1].toFixed(1)}`;
  }
  return d;
}

/**
 * lineChart(el, { labels, series:[{ values, color, width, fill, dashed, name }], height, format, xFormat, tipFormat })
 * La dernière série avec fill:true (ou la dernière) est la série principale (survol).
 */
export function lineChart(el, { labels, series, height = 260, format = v => v, xFormat = v => v, tipFormat = v => v }) {
  const W = Math.max(260, el.clientWidth || 600), H = W < 520 ? Math.round(height * .72) : height;
  const pl = W < 520 ? 40 : 52, pr = 12, pt = 18, pb = 30;
  const n = labels.length;
  if (!n) { el.innerHTML = '<div class="empty">Pas de données sur la période</div>'; return; }

  // Échantillonnage pour une courbe douce (≈ un point tous les 10 px)
  const maxPts = Math.max(16, Math.floor((W - pl - pr) / 10));
  const idx = [];
  if (n <= maxPts) for (let i = 0; i < n; i++) idx.push(i);
  else { const step = (n - 1) / (maxPts - 1); for (let k = 0; k < maxPts; k++) idx.push(Math.round(k * step)); }
  const Lb = idx.map(i => labels[i]);
  const S = series.map(s => ({ ...s, v: idx.map(i => s.values[i]) }));
  const main = [...S].reverse().find(s => s.fill) || S.at(-1);
  const all = S.flatMap(s => s.v).filter(v => v != null && Number.isFinite(v));
  const { lo, hi, ticks } = niceScale(Math.min(...all), Math.max(...all));
  const x = i => pl + (Lb.length === 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (Lb.length - 1));
  const y = v => pt + (hi - v) / (hi - lo || 1) * (H - pt - pb);
  const gid = 'lg' + (++uid);

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="lc" role="img">
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${main.color}" stop-opacity=".16"/><stop offset="1" stop-color="${main.color}" stop-opacity="0"/>
    </linearGradient></defs>`;
  for (const tk of ticks) svg += `<line x1="${pl}" x2="${W - pr}" y1="${y(tk)}" y2="${y(tk)}" class="grid${tk === 0 && lo < 0 ? ' zero' : ''}"/><text x="${pl - 12}" y="${y(tk) + 4}" class="ytick" text-anchor="end">${esc(compact(tk))}</text>`;
  const nx = Math.min(Lb.length, Math.max(2, Math.floor((W - pl - pr) / 84)));
  let lastTxt = null;
  for (let k = 0; k < nx; k++) {
    const i = Math.round(k * (Lb.length - 1) / (nx - 1 || 1));
    const txt = xFormat(Lb[i]);
    if (txt === lastTxt) continue;
    lastTxt = txt;
    svg += `<text x="${x(i)}" y="${H - 8}" class="xtick" text-anchor="${k === 0 ? 'start' : k === nx - 1 ? 'end' : 'middle'}">${esc(xFormat(Lb[i]))}</text>`;
  }
  for (const s of S) {
    const pts = s.v.map((v, i) => [x(i), y(v ?? lo)]);
    const d = smoothPath(pts);
    if (s.fill) svg += `<path d="${d} L${x(Lb.length - 1)},${H - pb} L${x(0)},${H - pb} Z" fill="${s.fillColor || `url(#${gid})`}"/>`;
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linecap="round" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="6 6"' : ''}/>`;
  }
  svg += `<g class="hover" style="display:none"><line class="hline" y1="${pt}" y2="${H - pb}"/><circle r="6" class="hdot" stroke="${main.color}"/></g>
    <rect x="${pl}" y="0" width="${W - pl - pr}" height="${H}" fill="transparent" class="hit"/></svg>`;
  el.innerHTML = `<div class="lc-wrap">${svg}<div class="lc-tip" hidden></div></div>`;

  const svgEl = el.querySelector('svg'), tip = el.querySelector('.lc-tip'), g = svgEl.querySelector('.hover');
  const hl = g.querySelector('line'), dot = g.querySelector('circle');
  const hit = svgEl.querySelector('.hit');
  hit.addEventListener('mousemove', e => {
    const r = svgEl.getBoundingClientRect();
    const mx = (e.clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(Lb.length - 1, Math.round((mx - pl) / ((W - pl - pr) / Math.max(1, Lb.length - 1)))));
    const v = main.v[i];
    g.style.display = '';
    hl.setAttribute('x1', x(i)); hl.setAttribute('x2', x(i));
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(v));
    const others = S.filter(s => s !== main && s.name && s.v[i] != null).map(s => `<em>${esc(s.name)} : ${esc(format(s.v[i]))}</em>`).join('');
    tip.innerHTML = `<strong>${esc(format(v))}</strong><span>${esc(tipFormat(Lb[i]))}</span>${others}`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(tw / 2, Math.min(W - tw / 2, x(i))) / W * r.width + 'px';
    tip.style.top = y(v) / H * r.height + 'px';
  });
  hit.addEventListener('mouseleave', () => { g.style.display = 'none'; tip.hidden = true; });
}

/** donut(el, [{ value, color, label, title }], { size, stroke, center, sub }) */
export function donut(el, items, { size = 176, stroke = 22, center = '', sub = '' } = {}) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r;
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const gap = items.length > 1 ? 3 : 0;
  let off = 0, arcs = '';
  for (const it of items) {
    const len = it.value / total * C;
    const dash = Math.max(0.5, len - gap);
    arcs += `<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${it.color}" stroke-width="${stroke}" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-off}"><title>${esc(it.title || it.label)}</title></circle>`;
    off += len;
  }
  el.innerHTML = `<div class="donut" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><g transform="rotate(-90 ${size / 2} ${size / 2})">
      <circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="#F1F4FA" stroke-width="${stroke}"/>${arcs}</g></svg>
    <div class="donut-center"><strong>${esc(center)}</strong><span>${esc(sub)}</span></div></div>`;
}

/** bars(el, [{ label, ...valeurs }], { keys, colors, names, height, format }) — barres groupées arrondies */
export function bars(el, data, { keys = ['income', 'expense'], colors = ['#4C6FFF', '#FF8FA3'], names = keys, height = 250, format = v => v } = {}) {
  const W = Math.max(260, el.clientWidth || 600), H = W < 520 ? Math.round(height * .8) : height, pl = W < 520 ? 40 : 52, pr = 8, pt = 14, pb = 30;
  const max = Math.max(1, ...data.flatMap(d => keys.map(k => d[k] || 0)));
  const { hi, ticks } = niceScale(0, max);
  const y = v => pt + (hi - v) / hi * (H - pt - pb);
  const gw = (W - pl - pr) / data.length, bw = Math.max(5, Math.min(14, gw / (keys.length + 1.6)));
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="bc">`;
  for (const tk of ticks) svg += `<line x1="${pl}" x2="${W - pr}" y1="${y(tk)}" y2="${y(tk)}" class="grid"/><text x="${pl - 12}" y="${y(tk) + 4}" class="ytick" text-anchor="end">${esc(compact(tk))}</text>`;
  data.forEach((d, gi) => {
    const cx = pl + gi * gw + gw / 2;
    svg += `<g class="bar-group"><rect x="${pl + gi * gw + 2}" y="${pt}" width="${gw - 4}" height="${H - pt - pb}" class="bar-bg" rx="10"/>`;
    keys.forEach((k, ki) => {
      const v = d[k] || 0, h = Math.max(v ? 3 : 0, (v / hi) * (H - pt - pb));
      const bx = cx + (ki - keys.length / 2) * (bw + 4) + 2;
      svg += `<rect x="${bx}" y="${H - pb - h}" width="${bw}" height="${h}" rx="${Math.min(bw / 2, h / 2)}" fill="${colors[ki]}"><title>${esc(d.label)} — ${esc(names[ki])} : ${esc(format(v))}</title></rect>`;
    });
    svg += `<text x="${cx}" y="${H - 8}" class="xtick" text-anchor="middle">${esc(d.label)}</text></g>`;
  });
  el.innerHTML = svg + '</svg>';
}

/** sparkline(el, values, color) — petite courbe avec remplissage et point final */
export function sparkline(el, values, color = '#4C6FFF') {
  const W = el.clientWidth || 120, H = el.clientHeight || 64, p = 6;
  if (!values.length) { el.innerHTML = ''; return; }
  const min = Math.min(...values), max = Math.max(...values);
  const x = i => p + i * (W - 2 * p) / Math.max(1, values.length - 1);
  const y = v => p + (max - v) / ((max - min) || 1) * (H - 2 * p);
  const pts = values.map((v, i) => [x(i), y(v)]);
  const d = smoothPath(pts);
  const gid = 'sp' + (++uid);
  const li = values.length - 1, mi = Math.max(0, values.length - 2);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${x(mi)}" x2="${x(mi)}" y1="${p}" y2="${H}" stroke="${color}" stroke-opacity=".18"/>
    <path d="${d} L${x(li)},${H} L${x(0)},${H} Z" fill="url(#${gid})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${x(mi)}" cy="${y(values[mi])}" r="3.5" fill="${color}"/>
  </svg>`;
}
