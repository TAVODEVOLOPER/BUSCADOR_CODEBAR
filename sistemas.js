/* Avance por sistemas: FDS, HVAC, PROCESOS, VESDA, TIERRA (hojas AVANCE_* del Excel de Dossa) */
const SIS = {
  FDS:      { name: 'FDS',      sheet: 'AVANCE_FDS',      qty: 'COMPL_QTY', date: 'DATE',   week: 'SEMANA', st: 'COMPLETED', unit: 'ud', css: '--v-other', what: 'Equipos instalados' },
  HVAC:     { name: 'HVAC',     sheet: 'AVANCE_HVAC',     qty: 'COMPL_QTY', date: 'DATE',   week: 'SEMANA', st: 'COMPLETED', unit: 'ud', css: '--v-good', what: 'Equipos instalados' },
  PROCESOS: { name: 'Procesos', sheet: 'AVANCE_PROCESOS', qty: 'COMPL_QTY', date: 'DATE',   week: 'SEMANA', st: 'COMPLETED', unit: 'ud', css: '--v-warn', what: 'Equipos instalados' },
  VESDA:    { name: 'VESDA',    sheet: 'AVANCE_VESDA',    qty: 'COMPL_QTY', date: 'DATE',   week: 'WEEK',   st: 'COMPLETED', unit: 'm',  css: '--v-good', what: 'Tubería instalada (m)' },
  TIERRA:   { name: 'Tierra',   sheet: 'AVANCE_TIERRA',   qty: 'QTY_COMPL', date: 'DATE_1', week: 'SEMANA', st: 'COMPLETED', unit: '',   css: '--v-good', what: 'Cantidad completada' },
};
const SV = { data: null, sys: '', q: '', st: '', wk: '', lim: 80, busy: false };
const svOk = k => typeof sysOk === 'function' ? sysOk(k) : true;
const svKeys = () => Object.keys(SIS).filter(k => svOk(k) && SV.data && SV.data.sistemas && SV.data.sistemas[k]);
async function loadSv() { SV.data = (await DB.get('meta', 'avance').catch(() => null)) || null; }
async function pullSv(silent) {
  if (!cloud.on() || SV.busy) return false;
  SV.busy = true;
  try {
    const j = await apiGet('avance', SV.data && SV.data.hash ? { hash: SV.data.hash } : {});
    if (j.same) return true;
    SV.data = j; await DB.put('meta', j, 'avance');
    if (['sresumen', 'sdetalle'].includes($('#app').dataset.tab)) svRepaint();
    return true;
  } catch (e) { if (!silent) toast('No se pudo leer el avance por sistemas: ' + e.message, 5000); return false; }
  finally { SV.busy = false; }
}
function svRepaint() { const t = $('#app').dataset.tab; if (t === 'sresumen') renderSvResumen(); else if (t === 'sdetalle') renderSvDetalle(); }
/* semana + año a partir de la fecha; la semana viene del Excel (WEEKNUM, la semana empieza en domingo) */
function svRows(k) {
  const d = SV.data.sistemas[k], s = SIS[k], ix = n => d.cols.indexOf(n), iq = ix(s.qty), id = ix(s.date), iw = ix(s.week), ist = ix(s.st);
  return d.rows.map(r => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(r[id]) ? r[id] : '', wk = parseInt(r[iw], 10) || 0, q = Number(r[iq]) || 0;
    let y = date ? +date.slice(0, 4) : 0; const mo = date ? +date.slice(5, 7) : 0;
    if (y && wk === 1 && mo === 12) y++; if (y && wk >= 52 && mo === 1) y--;
    return { r, date, wk, q, key: y && wk ? y * 100 + wk : 0, done: q > 0 && !!date, st: String(r[ist] ?? '') };
  });
}
function svWeekly(k) {
  const rows = svRows(k).filter(x => x.done && x.key), m = new Map();
  rows.forEach(x => { const o = m.get(x.key) || { q: 0, n: 0 }; o.q += x.q; o.n++; m.set(x.key, o); });
  return m;
}
function svWeekList(maps) {
  const keys = [...new Set(maps.flatMap(m => [...m.keys()]))].sort((a, b) => a - b); if (!keys.length) return [];
  const out = []; let y = Math.floor(keys[0] / 100), w = keys[0] % 100; const last = keys[keys.length - 1];
  while (y * 100 + w <= last && out.length < 150) { out.push(y * 100 + w); w++; if (w > 53 || (w === 53 && !keys.includes(y * 100 + 53))) { w = 1; y++; } }
  return out;
}
const svFmt = (v, u) => nfd(v) + (u ? ' ' + u : '');
const nfd = n => (Math.round(n * 10) / 10).toLocaleString('es-ES');
function renderSvResumen() {
  const root = $('#sResumen'); if (!root) return;
  const keys = svKeys(), adm = cloud.admin();
  const imp = adm ? `<div class="btn-row"><button class="btn primary" id="svImport">Cargar Excel de avance</button><input id="svFile" type="file" accept=".xlsx,.xlsm" hidden></div><p class="help">Elige tu Excel completo. La app lee solo las hojas AVANCE_FDS, AVANCE_HVAC, AVANCE_PROCESOS, AVANCE_VESDA y AVANCE_TIERRA y las guarda para todo el equipo.</p>` : '';
  if (!keys.length) { root.innerHTML = `<div class="d-empty"><h2>Sin avance por sistemas</h2><p>${adm ? 'Carga tu Excel de avance para verlo aquí.' : 'Todavía no hay datos. Avisa al administrador.'}</p></div>${imp}`; $('#svInfo').textContent = ''; return; }
  const inf = SV.data.info || {}; $('#svInfo').textContent = inf.fecha ? 'Cargado el ' + inf.fecha : '';
  if (SV.sys && !keys.includes(SV.sys)) SV.sys = '';
  const maps = {}; keys.forEach(k => { maps[k] = svWeekly(k); });
  const shown = SV.sys ? [SV.sys] : keys, weeks = svWeekList(shown.map(k => maps[k])), wl = weeks.map(k => k % 100);
  const chips = `<div class="filters" id="svSys"><button class="filter ${SV.sys === '' ? 'on' : ''}" data-sys="">Todos</button>${keys.map(k => `<button class="filter ${SV.sys === k ? 'on' : ''}" data-sys="${k}">${SIS[k].name}</button>`).join('')}</div>`;
  const kp = shown.map(k => {
    const rows = svRows(k), done = rows.filter(x => x.done), tot = done.reduce((a, x) => a + x.q, 0), lastK = [...maps[k].keys()].sort((x, y) => x - y).pop() || 0, lv = (maps[k].get(lastK) || { q: 0 }).q, ws = [...maps[k].values()];
    const avg = ws.length ? ws.reduce((a, o) => a + o.q, 0) / ws.length : 0, pend = rows.length - done.length;
    return `<div class="kpi"><span>${SIS[k].name}</span><b>${svFmt(tot, SIS[k].unit)}</b><small>${done.length} de ${rows.length} filas con avance${pend ? `, ${pend} sin fecha` : ''}. Última semana S${lastK % 100}: ${svFmt(lv, SIS[k].unit)}. Media ${svFmt(avg, SIS[k].unit)} por semana</small></div>`;
  }).join('');
  const chartBox = (id, title) => `<p class="chart-t">${title}</p><div id="${id}" class="chart"></div>`;
  const unitKeys = shown.filter(k => SIS[k].unit === 'ud'), otherKeys = shown.filter(k => SIS[k].unit !== 'ud');
  let charts = '';
  if (unitKeys.length) charts += chartBox('svC_ud', unitKeys.length > 1 ? 'Equipos instalados por semana' : SIS[unitKeys[0]].what + ' por semana') + 'LEG';
  otherKeys.forEach(k => { charts += chartBox('svC_' + k, SIS[k].what + ' por semana, ' + SIS[k].name); });
  const leg = unitKeys.length > 1 ? `<div class="klg">${unitKeys.map(k => `<span><i class="sw" style="background:var(${SIS[k].css})"></i>${SIS[k].name}</span>`).join('')}</div>` : '';
  const tbl = `<div class="tw"><table class="tbl"><thead><tr><th>Semana</th>${shown.map(k => `<th>${SIS[k].name}</th>`).join('')}</tr></thead><tbody>${[...weeks].reverse().map(w => `<tr><td>S${w % 100} <small>${Math.floor(w / 100)}</small></td>${shown.map(k => { const o = maps[k].get(w); return `<td>${o ? svFmt(o.q, SIS[k].unit) : '-'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  root.innerHTML = chips + `<div class="kpis">${kp}</div>` + charts.replace('LEG', leg) + `<p class="chart-t">Resumen por semana</p>${tbl}<p class="note-s">La semana es la del Excel (WEEKNUM: empieza en domingo), por eso puede diferir una unidad de la semana ISO.</p><div class="vtip" id="svtip" hidden></div>` + imp;
  sTip = $('#svtip');
  if (unitKeys.length) columnsChart($('#svC_ud'), wl, unitKeys.map(k => ({ k, name: SIS[k].name, css: SIS[k].css, values: weeks.map(w => (maps[k].get(w) || { q: 0 }).q) })), { label: 'Equipos instalados por semana', unit: '' });
  otherKeys.forEach(k => { const v = weeks.map(w => (maps[k].get(w) || { q: 0 }).q); columnsChart($('#svC_' + k), wl, [{ k, name: SIS[k].name, css: SIS[k].css, values: v }], { label: SIS[k].what, unit: SIS[k].unit ? ' ' + SIS[k].unit : '' }); });
}
function renderSvDetalle() {
  const root = $('#sDetalle'); if (!root) return;
  const keys = svKeys(); if (!keys.length) { root.innerHTML = '<div class="d-empty"><h2>Sin avance por sistemas</h2><p>Carga el Excel desde la pestaña Resumen.</p></div>'; return; }
  const k = SV.sys && keys.includes(SV.sys) ? SV.sys : keys[0]; SV.sys = k;
  const s = SIS[k], all = svRows(k), d = SV.data.sistemas[k], q = norm(SV.q);
  const sts = [...new Set(all.map(x => x.st))].filter(Boolean).sort(), wks = [...new Set(all.filter(x => x.key).map(x => x.key))].sort((a, b) => b - a);
  const hits = all.filter(x => (!SV.st || x.st === SV.st) && (!SV.wk || String(x.key) === SV.wk) && (!q || norm(x.r.join(' ')).includes(q)));
  const cols = d.cols.slice(0, 40), pick = ['TAG', 'DESCRIPTION', 'DESCRIPCION ROOM', 'AREA', 'ROOM', 'SORCODE', 'EARTHING_TYPE', 'SIZE_1', s.qty, s.date, s.week, s.st, 'DOSSA COMMENTS', 'COMENTARIOS', 'NOTES'].filter(c => cols.includes(c));
  if (!$('#svQ')) root.innerHTML = '<div id="svTop"></div><label class="field"><span>Buscar en la tabla</span><input id="svQ" type="search" autocomplete="off"></label><div id="svBody"></div>';
  $('#svTop').innerHTML = `<div class="filters" id="svSys">${keys.map(x => `<button class="filter ${k === x ? 'on' : ''}" data-sys="${x}">${SIS[x].name}</button>`).join('')}</div>`;
  $('#svBody').innerHTML = `<div class="grid2"><label class="field"><span>Estado</span><select id="svSt"><option value="">Todos</option>${sts.map(x => `<option ${SV.st === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
    <label class="field"><span>Semana</span><select id="svWk"><option value="">Todas</option>${wks.map(w => `<option value="${w}" ${SV.wk === String(w) ? 'selected' : ''}>S${w % 100} (${Math.floor(w / 100)})</option>`).join('')}</select></label></div>
    <div class="btn-row"><button class="btn" id="svXls" ${hits.length ? '' : 'disabled'}>Descargar Excel (${hits.length})</button></div>
    <p class="help">${hits.length.toLocaleString('es-ES')} de ${all.length.toLocaleString('es-ES')} filas de ${s.name}.</p>
    <div class="rows">${hits.slice(0, SV.lim).map(x => { const g = c => { const i = d.cols.indexOf(c); return i < 0 ? '' : x.r[i]; };
      const ok = /INSTAL|COMPLE|OK|SI/i.test(x.st) || (x.q > 0 && x.done);
      return `<div class="row ch-row ${ok ? 'st-ok' : 'st-warn'}"><span class="t">${esc(String(g('TAG')).replace(/^#HKF\./, ''))}</span>
        <span class="m"><span class="cx-pill ${ok ? 'st-ok' : 'st-warn'}">${esc(x.st || (x.done ? 'Con avance' : 'Sin avance'))}</span>${x.key ? `<span class="cx-pill st-na">S${x.key % 100}</span>` : ''}</span>
        <span class="m"><span>${esc([g('DESCRIPTION') || g('DESCRIPCION ROOM'), g('AREA') || g('ROOM')].filter(Boolean).join(', '))}</span></span>
        <span class="m"><small>${x.q ? 'Cantidad ' + nfd(x.q) + (s.unit ? ' ' + s.unit : '') : 'Sin cantidad'}${x.date ? ', ' + x.date.split('-').reverse().join('/') : ''}</small></span>
        ${[g('DOSSA COMMENTS'), g('COMENTARIOS'), g('NOTES')].filter(Boolean).map(c => `<span class="m"><small>${esc(c)}</small></span>`).join('')}</div>`; }).join('') || '<p class="empty">No hay filas con estos filtros.</p>'}</div>
    ${hits.length > SV.lim ? `<button class="btn more" id="svMore">Mostrar más (${(hits.length - SV.lim).toLocaleString('es-ES')} restantes)</button>` : ''}`;
  SV.cols = pick; SV.hits = hits;
}
async function svImport(file) {
  try {
    toast('Leyendo el Excel...', 8000);
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }), out = {}, ymd = t => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`, found = [];
    Object.keys(SIS).forEach(k => {
      const ws = wb.Sheets[SIS[k].sheet]; if (!ws) return;
      const a = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }); if (a.length < 2) return;
      let w = a[0].length; while (w > 0 && String(a[0][w - 1]).trim() === '') w--;
      const cols = a[0].slice(0, w).map(x => String(x).trim()), rows = [];
      for (let i = 1; i < a.length; i++) {
        const r = a[i]; if (!String(r[0] ?? '').trim()) continue;
        rows.push(cols.map((_, c) => { const v = r[c]; if (v instanceof Date) return isNaN(v) ? '' : ymd(new Date(v.getTime() + 12 * 36e5)); return typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : String(v ?? '').trim(); }));
      }
      out[k] = { cols, rows }; found.push(`${SIS[k].name} ${rows.length}`);
    });
    if (!found.length) return toast('Ese archivo no tiene las hojas AVANCE_FDS, AVANCE_HVAC, AVANCE_PROCESOS, AVANCE_VESDA ni AVANCE_TIERRA', 6000);
    if (!confirm('Se van a guardar estas hojas: ' + found.join(', ') + '. Sustituyen a las anteriores. ¿Continuar?')) return;
    const j = await apiPost('subirAvance', { sistemas: out, archivo: file.name, author: cloud.author() });
    SV.data = null; await pullSv(true); renderSvResumen(); toast('Guardado: ' + j.hojas.join(', '), 5000);
  } catch (e) { toast('No se pudo cargar: ' + e.message, 6000); }
}
async function svXls() {
  const k = SV.sys, d = SV.data.sistemas[k], rows = SV.hits.map(x => x.r);
  const ws = XLSX.utils.aoa_to_sheet([d.cols, ...rows]), wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, SIS[k].sheet.slice(0, 31));
  XLSX.writeFile(wb, `avance_${k.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
document.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t || !$('#tab-sresumen,#tab-sdetalle')) return;
  const inS = t.closest('#sResumen,#sDetalle'); if (!inS) return;
  if (t.dataset.sys !== undefined) { SV.sys = t.dataset.sys; SV.lim = 80; return svRepaint(); }
  if (t.id === 'svImport') return $('#svFile').click();
  if (t.id === 'svMore') { SV.lim += 80; return svRepaint(); }
  if (t.id === 'svXls') return svXls();
});
document.addEventListener('change', e => {
  if (e.target.id === 'svFile' && e.target.files[0]) { const f = e.target.files[0]; e.target.value = ''; svImport(f); }
  if (e.target.id === 'svSt') { SV.st = e.target.value; SV.lim = 80; renderSvDetalle(); }
  if (e.target.id === 'svWk') { SV.wk = e.target.value; SV.lim = 80; renderSvDetalle(); }
});
document.addEventListener('input', e => { if (e.target.id === 'svQ') { SV.q = e.target.value; SV.lim = 80; renderSvDetalle(); const q = $('#svQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); } });
loadSv().then(() => { if (cloud.on()) pullSv(true); });
