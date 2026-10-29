/* Cable Scan — pantalla Resumen: avance general y por semana.
   Total de cables = CC_SCHEDULE (solo se usa el tag y la cantidad). Estado y semana salen de la tabla CABLEADO.
   Los gráficos son SVG propio (sin librerías) para que funcionen sin conexión. */
'use strict';

/* ---------- CC_SCHEDULE: lista total de cables ---------- */
const SC = { tags: null, total: 0, hash: '', fuente: '' };

function setSchedule(s) {
  SC.tags = new Set((s.tags || []).map(norm));
  SC.total = SC.tags.size; SC.hash = s.hash || ''; SC.fuente = s.fuente || '';
  if ($('#app').dataset.tab === 'stats') renderStats();
}
async function loadSchedule() {
  const s = await DB.get('meta', 'schedule').catch(() => null);
  if (s && s.tags) setSchedule(s);
}
/* Desde tu Sheet (pestaña CC_SCHEDULE); solo se descarga si cambió */
async function pullSchedule(silent) {
  if (!cloud.on()) { if (!silent) toast('Conecta tu Google en Ajustes', 4000); return false; }
  try {
    const j = await apiGet('schedule', SC.hash && SC.fuente === 'cloud' ? { hash: SC.hash } : {});
    if (j.none) { if (!silent) toast('Tu Sheet no tiene la pestaña CC_SCHEDULE con datos', 5000); return false; }
    if (j.same) { if (!silent) toast('El CC_SCHEDULE ya está al día'); return true; }
    const s = { tags: j.tags, hash: j.hash, fuente: 'cloud' };
    await DB.put('meta', s, 'schedule'); setSchedule(s);
    if (!silent) toast(`CC_SCHEDULE actualizado: ${j.tags.length.toLocaleString('es-ES')} cables`);
    return true;
  } catch (e) { if (!silent) toast('No se pudo leer el CC_SCHEDULE: ' + e.message, 5000); return false; }
}
/* Sin Google: el Excel del CC_SCHEDULE se lee en este dispositivo (solo la columna CABLE_NUMBER) */
async function importSchedule(file) {
  try {
    toast('Leyendo el CC_SCHEDULE. Puede tardar unos segundos', 60000);
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const ref = XLSX.utils.decode_range(ws['!ref']);
    let hr = -1, hc = -1;
    for (let r = ref.s.r; r <= Math.min(ref.e.r, ref.s.r + 30) && hr < 0; r++) {
      for (let c = ref.s.c; c <= ref.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && String(cell.v).trim() === 'CABLE_NUMBER') { hr = r; hc = c; break; }
      }
    }
    if (hr < 0) throw new Error('no encuentro la columna CABLE_NUMBER');
    const seen = new Set(), tags = [];
    for (let r = hr + 1; r <= ref.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: hc })];
      const t = cell ? String(cell.v).replace(/ /g, ' ').trim() : '';
      if (t && !seen.has(t)) { seen.add(t); tags.push(t); }
    }
    const s = { tags, hash: 'local-' + tags.length, fuente: 'local' };
    await DB.put('meta', s, 'schedule'); setSchedule(s);
    toast(`CC_SCHEDULE cargado: ${tags.length.toLocaleString('es-ES')} cables (solo en este dispositivo)`, 5000);
  } catch (e) { toast('No se pudo leer el CC_SCHEDULE: ' + e.message, 6000); }
}

/* ---------- Cálculo ---------- */
const CATS = [
  { k: 'tend', name: 'Tendido', css: '--v-good', test: s => s.startsWith('TENDIDO') },
  { k: 'curso', name: 'En curso', css: '--v-warn', test: s => ['COIL', 'CORTE', 'WORKING', 'MEDICI', 'PENDING', 'CORREO'].some(x => s.startsWith(x)) },
  { k: 'inc', name: 'Incidencia', css: '--v-bad', test: s => s.startsWith('INCIDENCIA') },
  { k: 'otros', name: 'Otros', css: '--v-other', test: () => true },   // vendor, patch cord, sin status
];
const NONE = { k: 'none', name: 'Sin iniciar', css: '--v-none' };
const catOf = s => { s = String(s || '').toUpperCase(); return CATS.find(c => c.test(s)); };
const nf = n => Math.round(n).toLocaleString('es-ES');
const pc = (a, b) => b ? (a * 100 / b).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %' : '–';

function statsData() {
  const zero = () => ({ tend: 0, curso: 0, inc: 0, otros: 0 });
  const table = zero(), inSched = zero(), noWeek = zero(), wk = new Map();
  let notIn = 0;
  const WI = COL.has('SEMANA') ? COL.get('SEMANA') : -1;
  for (const r of DATA.rows) {
    const k = catOf(STATI >= 0 ? r[STATI] : '').k;
    table[k]++;
    if (SC.tags) { if (SC.tags.has(norm(r[TAGI]))) inSched[k]++; else { notIn++; continue; } }   // fuera del CC_SCHEDULE no cuenta
    const w = WI >= 0 ? parseInt(r[WI], 10) : 0;
    if (w > 0) { if (!wk.has(w)) wk.set(w, zero()); wk.get(w)[k]++; } else noWeek[k]++;
  }
  const hasSched = !!SC.tags;
  const counted = hasSched ? inSched : table;
  const total = hasSched ? SC.total : DATA.rows.length;
  const sum = o => o.tend + o.curso + o.inc + o.otros;
  const started = sum(counted);
  const weeks = [];
  if (wk.size) { const a = Math.min(...wk.keys()), b = Math.max(...wk.keys()); for (let w = a; w <= b; w++) weeks.push(w); }
  return { table, counted, total, hasSched, notIn, started, notStarted: Math.max(0, total - started), tableTotal: DATA.rows.length, weeks, wk, noWeek, zero };
}

/* ---------- Dibujo ---------- */
let sTip, sState = { mode: 'tend' };
function niceMax(v) {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}
function ticksFor(max) { const st = niceMax(max) / 4; const out = []; for (let i = 0; i <= 4; i++) out.push(st * i); return out; }
const short = n => n >= 1000 ? (n / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' mil' : String(Math.round(n));
const sw = c => `<i class="sw" style="background:var(${c})"></i>`;

/* barra horizontal apilada al 100 % */
function stackBar(items, total) {
  const W = 1000, H = 22, gap = 2;
  let x = 0, out = '';
  const vis = items.filter(i => i.v > 0);
  vis.forEach((it, n) => {
    let w = it.v / total * W; w = Math.max(w, 3);
    const w2 = n < vis.length - 1 ? Math.max(1, w - gap) : Math.max(1, Math.min(w, W - x));
    out += `<rect x="${x.toFixed(1)}" y="0" width="${w2.toFixed(1)}" height="${H}" style="fill:var(${it.css})" data-n="${esc(it.name)}" data-v="${it.v}"></rect>`;
    x += w;
  });
  return `<svg class="sbar" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Barra de avance"><defs><clipPath id="cp${total}"><rect width="${W}" height="${H}" rx="4"/></clipPath></defs><g clip-path="url(#cp${total})">${out}</g></svg>`;
}

/* columnas (simples o apiladas) */
function columnsChart(host, weeks, series, o = {}) {
  const W = Math.max(300, host.clientWidth || 320), H = o.h || 230, m = { l: 40, r: 10, t: 22, b: 28 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, y0 = m.t + ih;
  const tot = weeks.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
  const peak = Math.max(1, ...tot), tk = ticksFor(peak), max = tk[tk.length - 1];
  const k = ih / max, band = iw / weeks.length, bw = Math.min(24, Math.max(3, band * 0.62));
  let g = '';
  tk.forEach(t => { const y = y0 - t * k; g += `<line class="gl" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text class="ax" x="${m.l - 6}" y="${y + 4}" text-anchor="end">${short(t)}</text>`; });
  g += `<line class="bl" x1="${m.l}" x2="${W - m.r}" y1="${y0}" y2="${y0}"/>`;
  const every = Math.ceil(24 / band);
  weeks.forEach((w, i) => { if (i % every === 0) g += `<text class="ax" x="${m.l + band * (i + .5)}" y="${H - 8}" text-anchor="middle">S${w}</text>`; });
  let bars = '';
  const pi = tot.indexOf(peak);
  weeks.forEach((w, i) => {
    const cx = m.l + band * (i + .5), x = cx - bw / 2;
    const last = series.map((s, j) => s.values[i] > 0 ? j : -1).reduce((a, b) => Math.max(a, b), -1);
    let cum = 0;
    series.forEach((s, j) => {
      const v = s.values[i]; if (v <= 0) { return; }
      const bot = y0 - cum * k - (cum > 0 ? 1 : 0), top = y0 - (cum + v) * k + (j < last ? 1 : 0);
      const h = bot - top; cum += v;
      if (h < .5) return;
      if (j === last) {
        const r = Math.min(4, h, bw / 2);
        bars += `<path style="fill:var(${s.css})" d="M${x},${bot}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${bot}Z"/>`;
      } else bars += `<rect style="fill:var(${s.css})" x="${x}" y="${top}" width="${bw}" height="${h}"/>`;
    });
    if (i === pi && peak > 0) bars += `<text class="val" x="${cx}" y="${y0 - peak * k - 6}" text-anchor="middle">${nf(peak)}</text>`;
  });
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.label || '')}">${g}<rect class="vband" x="0" y="${m.t}" width="${band}" height="${ih}" opacity="0"/>${bars}<rect class="hit" x="${m.l}" y="0" width="${iw}" height="${H}" fill="transparent"/></svg>`;
  hover(host, { m, band, n: weeks.length, W, band_h: ih }, i => ({
    title: `Semana ${weeks[i]}`,
    rows: series.map(s => ({ css: s.css, name: s.name, v: s.values[i] })).filter(r => r.v > 0 || series.length === 1),
    total: series.length > 1 ? tot[i] : null,
  }));
}

/* línea acumulada */
function lineChart(host, weeks, values, total, o = {}) {
  const W = Math.max(300, host.clientWidth || 320), H = o.h || 230, m = { l: 40, r: 64, t: 22, b: 28 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, y0 = m.t + ih;
  const peak = Math.max(1, ...values), tk = ticksFor(peak), max = tk[tk.length - 1], k = ih / max;
  const step = weeks.length > 1 ? iw / (weeks.length - 1) : 0;
  const px = i => m.l + (weeks.length > 1 ? step * i : iw / 2), py = v => y0 - v * k;
  let g = '';
  tk.forEach(t => { const y = py(t); g += `<line class="gl" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text class="ax" x="${m.l - 6}" y="${y + 4}" text-anchor="end">${short(t)}</text>`; });
  g += `<line class="bl" x1="${m.l}" x2="${W - m.r}" y1="${y0}" y2="${y0}"/>`;
  const every = Math.ceil(30 / Math.max(step, 1));
  weeks.forEach((w, i) => { if (i % every === 0) g += `<text class="ax" x="${px(i)}" y="${H - 8}" text-anchor="middle">S${w}</text>`; });
  const pts = values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`);
  const area = `M${px(0)},${y0}L${pts.join('L')}L${px(weeks.length - 1)},${y0}Z`;
  const li = values.length - 1, lv = values[li];
  const line = `<path d="${area}" style="fill:var(--v-good);opacity:.1"/><polyline points="${pts.join(' ')}" fill="none" style="stroke:var(--v-good)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${px(li)}" cy="${py(lv)}" r="5" style="fill:var(--v-good);stroke:var(--surface-v)" stroke-width="2"/>`
    + `<text class="val" x="${px(li) + 10}" y="${py(lv) + 4}">${nf(lv)}</text>`;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.label || '')}">${g}<line class="cross" x1="0" x2="0" y1="${m.t}" y2="${y0}" opacity="0"/>${line}<circle class="hdot" r="5" opacity="0" style="fill:var(--v-good);stroke:var(--surface-v)" stroke-width="2"/><rect class="hit" x="${m.l - 6}" y="0" width="${iw + 12}" height="${H}" fill="transparent"/></svg>`;
  host._line = { px, py };
  hover(host, { m, band: step || iw, n: weeks.length, W, line: true, px, py, values }, i => ({
    title: `Hasta la semana ${weeks[i]}`,
    rows: [{ css: '--v-good', name: 'Tendidos acumulados', v: values[i] }],
    total: null, extra: total ? pc(values[i], total) + ' del total' : '',
  }));
}

/* tooltip al pasar el ratón o tocar */
function hover(host, geo, info) {
  const svg = host.querySelector('svg'), hit = svg.querySelector('.hit');
  const move = e => {
    const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (geo.W / r.width);
    let i = geo.line && geo.n > 1 ? Math.round((x - geo.m.l) / geo.band) : Math.floor((x - geo.m.l) / geo.band);
    i = Math.max(0, Math.min(geo.n - 1, i));
    const d = info(i);
    sTip.innerHTML = `<b>${esc(d.title)}</b>` + d.rows.map(r => `<span>${sw(r.css)}${esc(r.name)}<em>${nf(r.v)}</em></span>`).join('')
      + (d.total != null ? `<span class="tt">Total<em>${nf(d.total)}</em></span>` : '') + (d.extra ? `<span class="tt">${esc(d.extra)}</span>` : '');
    sTip.hidden = false;
    const hr = host.getBoundingClientRect();
    let left = e.clientX - hr.left + 14; const tw = sTip.offsetWidth;
    if (left + tw > hr.width) left = e.clientX - hr.left - tw - 14;
    sTip.style.left = Math.max(0, left) + 'px'; sTip.style.top = Math.max(0, e.clientY - hr.top - 20) + 'px';
    host.appendChild(sTip);
    const vb = svg.querySelector('.vband');
    if (vb) { vb.setAttribute('x', geo.m.l + geo.band * i); vb.setAttribute('opacity', .1); vb.style.fill = 'var(--ink)'; }
    const cr = svg.querySelector('.cross'), hd = svg.querySelector('.hdot');
    if (cr) { const cx = geo.px(i); cr.setAttribute('x1', cx); cr.setAttribute('x2', cx); cr.setAttribute('opacity', .35); hd.setAttribute('cx', cx); hd.setAttribute('cy', geo.py(geo.values[i])); hd.setAttribute('opacity', 1); }
  };
  const leave = () => {
    sTip.hidden = true;
    svg.querySelectorAll('.vband,.cross,.hdot').forEach(n => n.setAttribute('opacity', 0));
  };
  hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move); hit.addEventListener('pointerleave', leave);
}

/* ---------- Pantalla ---------- */
const WEEK_MODES = [
  { k: 'tend', name: 'Tendidos' }, { k: 'curso', name: 'En curso' }, { k: 'inc', name: 'Incidencias' }, { k: 'all', name: 'Todos los estados' },
];

function renderStats() {
  const host = $('#stats'); if (!host) return;
  if (!DATA) { host.innerHTML = '<p class="empty">Todavía no hay tabla cargada. Conecta tu Google en Ajustes.</p>'; return; }
  const d = statsData();
  $('#statsInfo').textContent = d.hasSched ? `${nf(d.total)} cables en el CC_SCHEDULE` : `${nf(d.total)} cables en la tabla`;
  const tendTot = d.counted.tend;

  // barra y leyenda (la leyenda es también la vista en tabla)
  const itemsTotal = [...CATS.map(c => ({ ...c, v: d.counted[c.k] })), ...(d.hasSched ? [{ ...NONE, v: d.notStarted }] : [])];
  const itemsTable = CATS.map(c => ({ ...c, v: d.counted[c.k] }));
  const legendRows = itemsTotal.map(it => {
    const inTable = it.k === 'none' ? null : d.counted[it.k];
    return `<tr><td>${sw(it.css)}${esc(it.name)}</td><td>${nf(it.v)}</td><td>${pc(it.v, d.total)}</td>${d.hasSched ? `<td>${inTable == null ? '–' : pc(inTable, d.started)}</td>` : ''}</tr>`;
  }).join('');

  host.innerHTML = `
  <section class="viz">
    <h3>Avance general</h3>
    <div class="hero">
      <div class="hero-num">${(tendTot * 100 / (d.total || 1)).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}<small> %</small></div>
      <p><b>${nf(tendTot)}</b> de <b>${nf(d.total)}</b> cables ${d.hasSched ? 'del CC_SCHEDULE ' : ''}están tendidos.${d.hasSched ? '' : ' Carga el CC_SCHEDULE en Ajustes para medir sobre el total del proyecto.'}</p>
    </div>
    <div class="sb"><div class="sb-t">Sobre ${d.hasSched ? 'el total del CC_SCHEDULE' : 'la tabla'} <b>${nf(d.total)}</b></div>${stackBar(itemsTotal, d.total)}</div>
    ${d.hasSched ? `<div class="sb"><div class="sb-t">Entre los cables del CC_SCHEDULE que ya están en la tabla <b>${nf(d.started)}</b></div>${stackBar(itemsTable, d.started)}</div>` : ''}
    <table class="legend">
      <thead><tr><th>Estado</th><th>Cables</th><th>% del total</th>${d.hasSched ? '<th>% de la tabla</th>' : ''}</tr></thead>
      <tbody>${legendRows}</tbody>
    </table>
    ${d.hasSched && d.notIn ? `<p class="note-s">${nf(d.notIn)} ${d.notIn === 1 ? 'cable de la tabla no figura' : 'cables de la tabla no figuran'} en el CC_SCHEDULE y no se cuentan en el avance sobre el total.</p>` : ''}
  </section>

  <section class="viz">
    <h3>Por semana</h3>
    ${d.weeks.length ? `
    <div class="wk">
      <div class="chips" id="wkChips">${WEEK_MODES.map(m => `<button class="filter ${sState.mode === m.k ? 'on' : ''}" data-m="${m.k}">${m.name}</button>`).join('')}</div>
      <p class="chart-t" id="wkTitle"></p>
      <div class="chart" id="chWeek"></div>
      <details class="tv"><summary>Ver como tabla</summary><div class="table-wrap"><table id="wkTable"></table></div></details>
    </div>
    <div class="wk">
      <p class="chart-t">Tendidos acumulados${d.hasSched ? ' (sobre ' + nf(d.total) + ' cables)' : ''}</p>
      <div class="chart" id="chCum"></div>
    </div>
    ${d.noWeek.tend + d.noWeek.curso + d.noWeek.inc + d.noWeek.otros ? `<p class="note-s">${nf(d.noWeek.tend + d.noWeek.curso + d.noWeek.inc + d.noWeek.otros)} cables de la tabla no tienen semana y no salen en estos gráficos${d.noWeek.tend ? ` (${nf(d.noWeek.tend)} de ellos tendidos)` : ''}.</p>` : ''}
    ` : '<p class="empty">La tabla no tiene la columna SEMANA con valores, así que no se puede dibujar el avance por semana.</p>'}
  </section>
  <div class="vtip" id="vtip" hidden></div>`;
  sTip = $('#vtip');
  // el tooltip se mueve dentro del contenedor del gráfico; vuelve a crearse en cada render
  drawWeekly(d);
  $$('#stats .sbar rect').forEach(r => {
    r.addEventListener('pointermove', e => {
      const hr = $('#stats').getBoundingClientRect(), tot = r.closest('.sb').querySelector('b').textContent;
      sTip.innerHTML = `<b>${esc(r.dataset.n)}</b><span>${nf(+r.dataset.v)}<em>${pc(+r.dataset.v, parseInt(tot.replace(/\./g, ''), 10))}</em></span>`;
      sTip.hidden = false; $('#stats').appendChild(sTip);
      sTip.style.left = Math.min(hr.width - sTip.offsetWidth, Math.max(0, e.clientX - hr.left + 12)) + 'px'; sTip.style.top = (e.clientY - hr.top - 52) + 'px';
    });
    r.addEventListener('pointerleave', () => { sTip.hidden = true; });
  });
}

function drawWeekly(d) {
  if (!d.weeks.length) return;
  const mode = sState.mode, weeks = d.weeks;
  const val = (c, w) => (d.wk.get(w) || d.zero())[c];
  const all = CATS.slice(0, 4);
  const series = mode === 'all' ? all.map(c => ({ ...c, values: weeks.map(w => val(c.k, w)) }))
    : [{ ...CATS.find(c => c.k === mode), values: weeks.map(w => val(mode, w)) }];
  $('#wkTitle').textContent = mode === 'all' ? 'Cables por semana según su estado' : `${WEEK_MODES.find(m => m.k === mode).name} por semana`;
  const cap = $('#wkTitle').textContent;
  columnsChart($('#chWeek'), weeks, series, { label: cap });
  // leyenda visible solo con varias series
  const leg = $('#chWeek').parentNode.querySelector('.klg'); if (leg) leg.remove();
  if (series.length > 1) $('#chWeek').insertAdjacentHTML('afterend', `<div class="klg">${series.map(s => `<span>${sw(s.css)}${esc(s.name)}</span>`).join('')}</div>`);
  // acumulado de tendidos
  let run = 0; const cum = weeks.map(w => run += val('tend', w));
  lineChart($('#chCum'), weeks, cum, d.hasSched ? d.total : d.tableTotal, { label: 'Tendidos acumulados por semana' });
  // tabla
  $('#wkTable').innerHTML = `<thead><tr><th>Semana</th>${all.map(c => `<th>${c.name}</th>`).join('')}<th>Tendidos acumulados</th></tr></thead><tbody>`
    + weeks.map((w, i) => `<tr><td>S${w}</td>${all.map(c => `<td>${nf(val(c.k, w))}</td>`).join('')}<td>${nf(cum[i])}</td></tr>`).join('') + '</tbody>';
}

document.addEventListener('click', e => {
  const b = e.target.closest('#wkChips .filter'); if (!b) return;
  sState.mode = b.dataset.m; $$('#wkChips .filter').forEach(x => x.classList.toggle('on', x === b));
  drawWeekly(statsData());
});
let rzT;
window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if ($('#app').dataset.tab === 'stats') renderStats(); }, 150); });
