/* Cable Scan — pantalla Resumen: avance general y por semana.
   Total de cables = CC_SCHEDULE (solo se usa el tag y la cantidad). Estado y semana salen de la tabla CABLEADO.
   Los gráficos son SVG propio (sin librerías) para que funcionen sin conexión. */
'use strict';

/* ---------- CC_SCHEDULE: lista total de cables ---------- */
const SC = { tags: null, pend: null, total: 0, hash: '', fuente: '', filtro: '', todos: 0 };

function setSchedule(s) {
  SC.tags = new Set((s.tags || []).map(norm));
  SC.pend = Array.isArray(s.pend) ? s.pend : null;   // PENDING + Released_CT = Y (solo con Google o Excel completo)
  SC.total = SC.tags.size; SC.hash = s.hash || ''; SC.fuente = s.fuente || ''; SC.filtro = s.filtro || ''; SC.todos = s.todos || SC.total;
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
    const s = { tags: j.tags, hash: j.hash, fuente: 'cloud', filtro: j.filtro || '', todos: j.todos || j.tags.length, pend: j.pend || [] };
    await DB.put('meta', s, 'schedule'); setSchedule(s);
    if (!silent) toast(`CC_SCHEDULE actualizado: ${j.tags.length.toLocaleString('es-ES')} cables${j.filtro ? ' de ' + j.filtro : ''}`);
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
    let hr = -1, hc = -1, dc = -1, sc = -1, rc = -1;
    for (let r = ref.s.r; r <= Math.min(ref.e.r, ref.s.r + 30) && hr < 0; r++) {
      for (let c = ref.s.c; c <= ref.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && String(cell.v).trim() === 'CABLE_NUMBER') { hr = r; hc = c; break; }
      }
    }
    if (hr < 0) throw new Error('no encuentro la columna CABLE_NUMBER');
    for (let c = ref.s.c; c <= ref.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: hr, c })], h = cell ? String(cell.v).trim() : '';
      if (h === 'Discipline' && dc < 0) dc = c;
      if (h === 'CURRENT_STATUS' && sc < 0) sc = c;
      if (h === 'Released_CT' && rc < 0) rc = c;
    }
    const filtro = String(CFG.disciplina || '').trim().toUpperCase();
    if (filtro && dc < 0) throw new Error('no encuentro la columna Discipline');
    const seen = new Set(), tags = [], pend = []; let todos = 0;
    const val = (r, c) => { const x = c < 0 ? null : ws[XLSX.utils.encode_cell({ r, c })]; return x ? String(x.v).trim().toUpperCase() : ''; };
    for (let r = hr + 1; r <= ref.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: hc })];
      const t = cell ? String(cell.v).replace(/\u00a0/g, ' ').trim() : '';
      if (!t || seen.has(t)) continue;
      seen.add(t); todos++;
      if (filtro) { const dcell = ws[XLSX.utils.encode_cell({ r, c: dc })]; if (!dcell || String(dcell.v).trim().toUpperCase() !== filtro) continue; }
      const st = val(r, sc);
      if (EXCLUIDOS.includes(st)) continue;   // DAMAGED y SPARE no cuentan
      tags.push(t);
      if (st === 'PENDING' && val(r, rc) === 'Y') pend.push(t);
    }
    const s = { tags, pend, hash: 'local-' + tags.length, fuente: 'local', filtro, todos };
    await DB.put('meta', s, 'schedule'); setSchedule(s);
    toast(`CC_SCHEDULE cargado: ${tags.length.toLocaleString('es-ES')} cables${filtro ? ' de ' + filtro : ''} (solo en este dispositivo)`, 5000);
  } catch (e) { toast('No se pudo leer el CC_SCHEDULE: ' + e.message, 6000); }
}

/* ---------- Cálculo ---------- */
const EXCLUIDOS = ['DAMAGED', 'SPARE'];   // estados del CC_SCHEDULE que no cuentan en el total
const CATS = [
  { k: 'tend', name: 'Tendido', css: '--v-good', test: s => s.startsWith('TENDIDO') },
  { k: 'curso', name: 'En curso', css: '--v-warn', test: s => ['COIL', 'CORTE', 'WORKING', 'MEDICI', 'PENDING', 'CORREO'].some(x => s.startsWith(x)) },
  { k: 'inc', name: 'Incidencia', css: '--v-bad', test: s => s.startsWith('INCIDENCIA') },
  { k: 'otros', name: 'Otros', css: '--v-other', test: () => true },   // vendor, patch cord, sin status
];
/* Metros: columna elegida en Ajustes (por defecto la medida de cable en campo) y meta semanal */
const METROS_DEF = ['REAL_TENDIDO', 'Cable_Routing_Produc', 'CUT_RutaMedida_2', 'Real Length', 'Cable_Routing'];
const metrosCol = () => { const n = LS.get('colMetros', ''); if (n && COL.has(n)) return n; return METROS_DEF.find(x => COL.has(x)) || ''; };
const metaSemanal = () => { const v = parseFloat(LS.get('metaSemanal', CFG.metaSemanal || 3000)); return v > 0 ? v : 3000; };
const meterKind = s => { s = String(s || '').toUpperCase(); return s.startsWith('TENDIDO') ? 'tend' : s.startsWith('COIL') ? 'coil' : ''; };   // metros: tendido o coil
const MM_MODES = [{ k: 'all', name: 'Tendido + Coil' }, { k: 'tend', name: 'Tendido' }, { k: 'coil', name: 'Coil' }];
const toNum = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const NONE = { k: 'none', name: 'Sin iniciar', css: '--v-none' };
const catOf = s => { s = String(s || '').toUpperCase(); return CATS.find(c => c.test(s)); };
const nf = n => Math.round(n).toLocaleString('es-ES');
const pc = (a, b) => b ? (a * 100 / b).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %' : '–';

function statsData() {
  const zero = () => ({ tend: 0, curso: 0, inc: 0, otros: 0 });
  const table = zero(), inSched = zero(), noWeek = zero(), wk = new Map(), statuses = new Map(), mw = { all: new Map(), tend: new Map(), coil: new Map() }, mT = { all: 0, tend: 0, coil: 0 }, mC = { all: 0, tend: 0, coil: 0 }, mNW = { all: 0, tend: 0, coil: 0 };
  let kWork = 0, kCoil = 0;
  const RI = COL.has('Released_CT_2') ? COL.get('Released_CT_2') : -1;
  let notIn = 0;
  const MI = metrosCol() ? COL.get(metrosCol()) : -1;
  const WI = COL.has('SEMANA') ? COL.get('SEMANA') : -1;
  for (const r of DATA.rows) {
    const k = catOf(STATI >= 0 ? r[STATI] : '').k;
    table[k]++;
    const stName = String(STATI >= 0 ? r[STATI] : '').trim() || '(sin status)';
    statuses.set(stName, (statuses.get(stName) || 0) + 1);
    if (SC.tags) { if (SC.tags.has(norm(r[TAGI]))) inSched[k]++; else { notIn++; continue; } }   // fuera del CC_SCHEDULE no cuenta
    const w = WI >= 0 ? parseInt(r[WI], 10) : 0;
    const stU = String(STATI >= 0 ? r[STATI] : '').trim().toUpperCase();
    if (RI >= 0 && String(r[RI]).trim().toUpperCase() === 'Y') { if (stU === 'WORKING') kWork++; else if (stU === 'COIL') kCoil++; }
    const mk = MI >= 0 ? meterKind(stU) : '';
    if (mk) {
      const m = toNum(r[MI]);
      for (const key of ['all', mk]) {
        mT[key] += m; mC[key]++;
        if (w > 0) mw[key].set(w, (mw[key].get(w) || 0) + m); else mNW[key] += m;
      }
    }
    if (w > 0) { if (!wk.has(w)) wk.set(w, zero()); wk.get(w)[k]++; } else noWeek[k]++;
  }
  const hasSched = !!SC.tags;
  const counted = hasSched ? inSched : table;
  const total = hasSched ? SC.total : DATA.rows.length;
  const sum = o => o.tend + o.curso + o.inc + o.otros;
  const started = sum(counted);
  const weeks = [];
  const wkeys = [...wk.keys(), ...mw.all.keys()];
  if (wkeys.length) { const a = Math.min(...wkeys), b = Math.max(...wkeys); for (let w = a; w <= b; w++) weeks.push(w); }
  return { statuses: [...statuses.entries()].sort((a, b) => b[1] - a[1]), mw, mT, mC, mNW, kWork, kCoil, table, counted, total, hasSched, notIn, started, notStarted: Math.max(0, total - started), tableTotal: DATA.rows.length, weeks, wk, noWeek, zero };
}

/* ---------- Dibujo ---------- */
let sTip, sState = { mode: 'tend', mm: 'all' };
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
  const barPeak = Math.max(1, ...tot), peak = Math.max(barPeak, o.goal || 0), tk = ticksFor(peak), max = tk[tk.length - 1];
  const css = (s, i) => (o.colorFn ? o.colorFn(i) : s.css);
  const k = ih / max, band = iw / weeks.length, bw = Math.min(24, Math.max(3, band * 0.62));
  let g = '';
  tk.forEach(t => { const y = y0 - t * k; g += `<line class="gl" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text class="ax" x="${m.l - 6}" y="${y + 4}" text-anchor="end">${short(t)}</text>`; });
  g += `<line class="bl" x1="${m.l}" x2="${W - m.r}" y1="${y0}" y2="${y0}"/>`;
  const every = Math.ceil(24 / band);
  weeks.forEach((w, i) => { if (i % every === 0) g += `<text class="ax" x="${m.l + band * (i + .5)}" y="${H - 8}" text-anchor="middle">S${w}</text>`; });
  let bars = '';
  const pi = tot.indexOf(barPeak);
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
        bars += `<path class="vb" style="--d:${i};fill:var(${css(s, i)})" d="M${x},${bot}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${bot}Z"/>`;
      } else bars += `<rect class="vb" style="--d:${i};fill:var(${css(s, i)})" x="${x}" y="${top}" width="${bw}" height="${h}"/>`;
    });
    if (i === pi && barPeak > 0) bars += `<text class="val" x="${cx}" y="${y0 - barPeak * k - 6}" text-anchor="middle">${nf(barPeak)}</text>`;
  });
  if (o.goal) { const gy = y0 - o.goal * k; bars += `<line class="goal" x1="${m.l}" x2="${W - m.r}" y1="${gy}" y2="${gy}"/><text class="val" x="${m.l + 2}" y="${gy - 5}" text-anchor="start">${esc(o.goalLabel || '')}</text>`; }
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.label || '')}">${g}<rect class="vband" x="0" y="${m.t}" width="${band}" height="${ih}" opacity="0"/>${bars}<rect class="hit" x="${m.l}" y="0" width="${iw}" height="${H}" fill="transparent"/></svg>`;
  hover(host, { m, band, n: weeks.length, W, band_h: ih }, i => ({
    title: `Semana ${weeks[i]}`,
    rows: series.map(s => ({ css: css(s, i), name: s.name, v: s.values[i] })).filter(r => r.v > 0 || series.length === 1),
    total: series.length > 1 ? tot[i] : null, extra: o.extra ? o.extra(i) : '', unit: o.unit || '',
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
  const line = `<path class="ar" d="${area}" style="fill:var(--v-good);opacity:.1"/><polyline class="ln" pathLength="1" points="${pts.join(' ')}" fill="none" style="stroke:var(--v-good)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
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
    sTip.innerHTML = `<b>${esc(d.title)}</b>` + d.rows.map(r => `<span>${sw(r.css)}${esc(r.name)}<em>${nf(r.v)}${d.unit || ''}</em></span>`).join('')
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
  const sn = SC.filtro ? `CC_SCHEDULE ${SC.filtro}` : 'CC_SCHEDULE';
  $('#statsInfo').textContent = d.hasSched ? `${nf(d.total)} cables ${SC.filtro ? 'de ' + SC.filtro : 'en el CC_SCHEDULE'}${SC.todos > d.total ? ' (de ' + nf(SC.todos) + ' en el CC_SCHEDULE)' : ''}` : `${nf(d.total)} cables en la tabla`;
  const tendTot = d.counted.tend;

  const itemsTotal = [...CATS.map(c => ({ ...c, v: d.counted[c.k] })), ...(d.hasSched ? [{ ...NONE, v: d.notStarted }] : [])];
  const itemsTable = CATS.map(c => ({ ...c, v: d.counted[c.k] }));
  const legendRows = itemsTotal.map(it => {
    const inTable = it.k === 'none' ? null : d.counted[it.k];
    return `<tr><td>${sw(it.css)}${esc(it.name)}</td><td>${nf(it.v)}</td><td>${pc(it.v, d.total)}</td>${d.hasSched ? `<td>${inTable == null ? '–' : pc(inTable, d.started)}</td>` : ''}</tr>`;
  }).join('');
  const stRows = d.statuses.filter(([n]) => !/^PENDING/i.test(n)).map(([n, v]) => { const c = catOf(n); return `<tr><td>${sw(c.css)}${esc(n)}</td><td>${nf(v)}</td><td>${pc(v, d.tableTotal)}</td></tr>`; }).join('');

  // metros por semana
  const meta = metaSemanal(), mcol = metrosCol();
  const mm = sState.mm, mmName = MM_MODES.find(x => x.k === mm).name;
  const mvals = d.weeks.map(w => d.mw[mm].get(w) || 0);
  const nOk = mvals.filter(v => v >= meta).length, lastW = d.weeks[d.weeks.length - 1], lastV = mvals[mvals.length - 1] || 0;
  const avg = mvals.length ? mvals.reduce((a, b) => a + b, 0) / mvals.length : 0;
  const mHtml = d.weeks.length && mcol ? `
    <div class="kpis">
      <div class="kpi"><span>Última semana (S${lastW})</span><b data-cnt="${Math.round(lastV)}" data-sfx=" m">${nf(lastV)} m</b><small>${pc(lastV, meta)} de la meta</small></div>
      <div class="kpi"><span>Promedio semanal</span><b data-cnt="${Math.round(avg)}" data-sfx=" m">${nf(avg)} m</b><small>${pc(avg, meta)} de la meta</small></div>
      <div class="kpi"><span>Semanas con la meta cumplida</span><b>${nOk} de ${mvals.length}</b><small>meta ${nf(meta)} m por semana</small></div>
      <div class="kpi"><span>Total ${mm === 'all' ? 'tendido y en coil' : mm === 'tend' ? 'tendido' : 'en coil'}</span><b data-cnt="${Math.round(d.mT[mm])}" data-sfx=" m">${nf(d.mT[mm])} m</b><small>${nf(d.mC[mm])} cables</small></div>
    </div>
    <p class="chart-t">Metros por semana: ${esc(mmName.toLowerCase())}</p>
    <div class="chips" id="mmChips">${MM_MODES.map(x => `<button class="filter ${mm === x.k ? 'on' : ''}" data-mm="${x.k}">${x.name}</button>`).join('')}</div>
    <div class="chart" id="chMeters"></div>
    <div class="klg"><span>${sw('--v-good')}Cumple la meta</span><span>${sw('--v-warn')}Por debajo de la meta</span><span><i class="sw goalkey"></i>Meta ${nf(meta)} m</span></div>
    <p class="note-s">Suma de la columna <b>${esc(mcol)}</b> de los cables en ${mm === 'all' ? 'TENDIDO y COIL' : mm === 'tend' ? 'TENDIDO' : 'COIL'}, por la semana de su último estado.${d.mNW[mm] ? ` ${nf(d.mNW[mm])} m no tienen semana y no salen en el gráfico.` : ''}</p>
    <details class="tv"><summary>Ver metros como tabla</summary><div class="table-wrap"><table id="mTable"></table></div></details>` : '<p class="empty">No encuentro una columna de metros en la tabla. Elígela en Ajustes → Resumen.</p>';

  const pendN = SC.pend ? SC.pend.length : null;
  const keyBtn = (key, title, n, sub, hint) => `<button type="button" class="kpi act" data-key="${key}" title="${esc(hint)}"><span>${title}</span><b ${n == null ? '' : `data-cnt="${n}"`}>${n == null ? '–' : nf(n)}</b><small>${sub}</small></button>`;
  host.innerHTML = `
  <section class="viz">
    <h3>Etiquetas clave</h3>
    <div class="kpis keys">
      ${keyBtn('working', 'Working por completar', d.kWork, 'WORKING + Released_CT_2 = Y', 'Ver estos cables en Buscar')}
      ${keyBtn('coil', 'Coil por completar', d.kCoil, 'COIL + Released_CT_2 = Y', 'Ver estos cables en Buscar')}
      ${keyBtn('pending', 'Pending por tender', pendN, pendN == null ? 'actualiza el CC_SCHEDULE en Ajustes' : 'CC_SCHEDULE: PENDING + Released_CT = Y', 'Ver estos cables en Buscar')}
    </div>
    <h3 class="h3b">Avance general</h3>
    <div class="hero">
      <div class="hero-num">${(tendTot * 100 / (d.total || 1)).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}<small> %</small></div>
      <p><b>${nf(tendTot)}</b> de <b>${nf(d.total)}</b> cables ${d.hasSched ? 'del ' + esc(sn) + ' ' : ''}están tendidos.${d.hasSched ? '' : ' Carga el CC_SCHEDULE en Ajustes para medir sobre el total de tu disciplina.'}</p>
    </div>
    <div class="sb"><div class="sb-t">Sobre ${d.hasSched ? 'el total del ' + esc(sn) : 'la tabla'} <b>${nf(d.total)}</b></div>${stackBar(itemsTotal, d.total)}</div>
    ${d.hasSched ? `<div class="sb"><div class="sb-t">Entre los cables del ${esc(sn)} que ya están en la tabla <b>${nf(d.started)}</b></div>${stackBar(itemsTable, d.started)}</div>` : ''}
    <table class="legend">
      <thead><tr><th>Estado</th><th>Cables</th><th>% del total</th>${d.hasSched ? '<th>% de la tabla</th>' : ''}</tr></thead>
      <tbody>${legendRows}</tbody>
    </table>
    ${d.hasSched && d.notIn ? `<p class="note-s">${nf(d.notIn)} ${d.notIn === 1 ? 'cable de la tabla no figura' : 'cables de la tabla no figuran'} en el ${esc(sn)} y no se cuentan en el avance ni en los metros.</p>` : ''}
    <h3 class="h3b">Estados en la tabla</h3>
    <table class="legend">
      <thead><tr><th>Status actual</th><th>Cables</th><th>% de la tabla</th></tr></thead>
      <tbody>${stRows}</tbody>
    </table>
  </section>

  <section class="viz">
    <h3>Por semana</h3>
    ${d.weeks.length ? `
    <div class="wk">${mHtml}</div>
    <div class="wk">
      <h4 class="h4">Cables por semana</h4>
      <div class="chips" id="wkChips">${WEEK_MODES.map(m => `<button class="filter ${sState.mode === m.k ? 'on' : ''}" data-m="${m.k}">${m.name}</button>`).join('')}</div>
      <p class="chart-t" id="wkTitle"></p>
      <div class="chart" id="chWeek"></div>
      <details class="tv"><summary>Ver como tabla</summary><div class="table-wrap"><table id="wkTable"></table></div></details>
    </div>
    <div class="wk">
      <p class="chart-t">Cables tendidos acumulados${d.hasSched ? ' (sobre ' + nf(d.total) + ' cables)' : ''}</p>
      <div class="chart" id="chCum"></div>
    </div>
    ${d.noWeek.tend + d.noWeek.curso + d.noWeek.inc + d.noWeek.otros ? `<p class="note-s">${nf(d.noWeek.tend + d.noWeek.curso + d.noWeek.inc + d.noWeek.otros)} cables de la tabla no tienen semana y no salen en los gráficos por semana${d.noWeek.tend ? ` (${nf(d.noWeek.tend)} de ellos tendidos)` : ''}.</p>` : ''}
    ` : '<p class="empty">La tabla no tiene la columna SEMANA con valores, así que no se puede dibujar el avance por semana.</p>'}
  </section>
  <div class="vtip" id="vtip" hidden></div>`;
  sTip = $('#vtip');
  drawWeekly(d);
  countUp(host);
  if (d.weeks.length && mcol) {
    columnsChart($('#chMeters'), d.weeks, [{ k: 'm', name: 'Metros', css: '--v-good', values: mvals }], {
      label: 'Metros por semana: ' + mmName, goal: meta, goalLabel: `Meta ${nf(meta)} m`, unit: ' m',
      colorFn: i => mvals[i] >= meta ? '--v-good' : '--v-warn',
      extra: i => `${pc(mvals[i], meta)} de la meta`,
    });
    $('#mTable').innerHTML = '<thead><tr><th>Semana</th><th>Metros</th><th>% de la meta</th></tr></thead><tbody>'
      + d.weeks.map((w, i) => `<tr><td>S${w}</td><td>${nf(mvals[i])}</td><td>${pc(mvals[i], meta)}</td></tr>`).join('') + '</tbody>';
  }
  $$('#stats .sbar rect').forEach(rc => {
    rc.addEventListener('pointermove', e => {
      const hr = $('#stats').getBoundingClientRect(), tot = rc.closest('.sb').querySelector('b').textContent;
      sTip.innerHTML = `<b>${esc(rc.dataset.n)}</b><span>${nf(+rc.dataset.v)}<em>${pc(+rc.dataset.v, parseInt(tot.replace(/\./g, ''), 10))}</em></span>`;
      sTip.hidden = false; $('#stats').appendChild(sTip);
      sTip.style.left = Math.min(hr.width - sTip.offsetWidth, Math.max(0, e.clientX - hr.left + 12)) + 'px'; sTip.style.top = (e.clientY - hr.top - 52) + 'px';
    });
    rc.addEventListener('pointerleave', () => { sTip.hidden = true; });
  });
}

/* los números grandes suben desde cero al abrir la pantalla (se omite con "reducir movimiento") */
function countUp(host) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  host.querySelectorAll('[data-cnt]').forEach(el => {
    const to = +el.dataset.cnt, sfx = el.dataset.sfx || '', t0 = performance.now(), dur = 900;
    const tick = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = nf(to * e) + sfx; if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
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
  columnsChart($('#chWeek'), weeks, series, { label: $('#wkTitle').textContent });
  const leg = $('#chWeek').parentNode.querySelector('.klg'); if (leg) leg.remove();
  if (series.length > 1) $('#chWeek').insertAdjacentHTML('afterend', `<div class="klg">${series.map(s => `<span>${sw(s.css)}${esc(s.name)}</span>`).join('')}</div>`);
  let run = 0; const cum = weeks.map(w => run += val('tend', w));
  lineChart($('#chCum'), weeks, cum, d.hasSched ? d.total : d.tableTotal, { label: 'Cables tendidos acumulados por semana' });
  $('#wkTable').innerHTML = `<thead><tr><th>Semana</th>${all.map(c => `<th>${c.name}</th>`).join('')}<th>Tendidos acumulados</th></tr></thead><tbody>`
    + weeks.map((w, i) => `<tr><td>S${w}</td>${all.map(c => `<td>${nf(val(c.k, w))}</td>`).join('')}<td>${nf(cum[i])}</td></tr>`).join('') + '</tbody>';
}

document.addEventListener('click', e => {
  const mb = e.target.closest('#mmChips .filter');
  if (mb) { sState.mm = mb.dataset.mm; renderStats(); return; }
  const kb = e.target.closest('#stats [data-key]');
  if (kb) {
    const k = kb.dataset.key;
    if (k === 'working') applySearchPreset([['Status Actual', ['WORKING']], ['Released_CT_2', ['Y']]]);
    else if (k === 'coil') applySearchPreset([['Status Actual', ['COIL']], ['Released_CT_2', ['Y']]]);
    else if (SC.pend) applySearchPreset([], true);
    else toast('Actualiza el CC_SCHEDULE en Ajustes para ver los pending', 4000);
    return;
  }
  const b = e.target.closest('#wkChips .filter'); if (!b) return;
  sState.mode = b.dataset.m; $$('#wkChips .filter').forEach(x => x.classList.toggle('on', x === b));
  drawWeekly(statsData());
});
let rzT;
window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if ($('#app').dataset.tab === 'stats') renderStats(); }, 150); });
