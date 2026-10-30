/* Cable Scan — pantalla Rutas: qué cables pasan por cada bandeja o tránsito (ROUTE_CODES del CC_SCHEDULE),
   de todas las disciplinas, con su disciplina y su CURRENT_STATUS. */
'use strict';

const RT = { data: null, hash: '', fecha: '', fuente: '', sel: -1, q: '', hideNon: true, disc: '', stat: '', limit: 300, cLimit: 150, loading: false, tried: false, err: '' };
const RT_NON = c => !c.startsWith('#');   // "Field routing", "Mini Route", "BY SE/EN"… no son bandejas

function setRoutes(r) {
  RT.data = r; RT.hash = r.hash || ''; RT.fecha = r.fecha || ''; RT.fuente = r.fuente || '';
  RT.sel = -1; RT.disc = ''; RT.stat = ''; RT.limit = 300; RT.cLimit = 150;
  RT.order = r.codes.map((_, i) => i).sort((a, b) => r.idx[b].length - r.idx[a].length);
  if ($('#app').dataset.tab === 'routes') renderRoutes();
}
async function loadRoutes() {
  const r = await DB.get('meta', 'routes').catch(() => null);
  if (r && r.codes) setRoutes(r);
}
async function pullRoutes(silent) {
  if (!cloud.on()) { if (!silent) toast('Conecta tu Google en Ajustes', 4000); return false; }
  RT.loading = true; RT.err = ''; if ($('#app').dataset.tab === 'routes') renderRoutes();
  try {
    const j = await apiGet('routes', RT.hash && RT.fuente === 'cloud' ? { hash: RT.hash } : {});
    if (j.none) { RT.err = 'Tu Sheet no tiene la pestaña CC_SCHEDULE con datos.'; return false; }
    if (j.same) { RT.fecha = new Date().toISOString(); if (RT.data) { RT.data.fecha = RT.fecha; await DB.put('meta', RT.data, 'routes'); } if (!silent) toast('Las rutas ya están al día'); return true; }
    const r = { hash: j.hash, fecha: new Date().toISOString(), fuente: 'cloud', discs: j.discs, stats: j.stats, levels: j.levels || [], cables: j.cables, codes: j.codes, idx: j.idx };
    await DB.put('meta', r, 'routes'); setRoutes(r);
    if (!silent) toast(`Rutas actualizadas: ${r.codes.length.toLocaleString('es-ES')} códigos`);
    return true;
  } catch (e) { RT.err = e.message; if (!silent) toast('No se pudieron leer las rutas: ' + e.message, 5000); return false; }
  finally { RT.loading = false; if ($('#app').dataset.tab === 'routes') renderRoutes(); }
}
/* Sin Google: se leen del mismo Excel del CC_SCHEDULE (llamada desde importSchedule) */
async function importRoutes(ws, ref, hr) {
  const find = n => { for (let c = ref.s.c; c <= ref.e.c; c++) { const x = ws[XLSX.utils.encode_cell({ r: hr, c })]; if (x && String(x.v).trim() === n) return c; } return -1; };
  const hc = find('CABLE_NUMBER'), dc = find('Discipline'), sc = find('CURRENT_STATUS'), rc = find('ROUTE_CODES'), lc = find('Level');
  if (rc < 0) return false;
  const get = (r, c) => { const x = c < 0 ? null : ws[XLSX.utils.encode_cell({ r, c })]; return x ? String(x.v).replace(/ /g, ' ').trim() : ''; };
  const discs = [], dm = new Map(), stats = [], sm = new Map(), levels = [], lm = new Map(), cables = [], codes = [], idx = [], cm = new Map(), seen = new Set();
  const pos = (arr, map, v) => { let i = map.get(v); if (i === undefined) { i = arr.length; map.set(v, i); arr.push(v); } return i; };
  for (let r = hr + 1; r <= ref.e.r; r++) {
    const t = get(r, hc); if (!t || seen.has(t)) continue; seen.add(t);
    const ci = cables.length;
    cables.push([t, pos(discs, dm, get(r, dc).toUpperCase()), pos(stats, sm, get(r, sc)), pos(levels, lm, get(r, lc))]);
    for (const part of get(r, rc).split(',')) {
      const code = part.trim().replace(/^\/+/, '').trim(); if (!code) continue;
      const k = pos(codes, cm, code); (idx[k] = idx[k] || []);
      if (idx[k][idx[k].length - 1] !== ci) idx[k].push(ci);
    }
  }
  const rr = { hash: 'local-' + cables.length, fecha: new Date().toISOString(), fuente: 'local', discs, stats, levels, cables, codes, idx };
  await DB.put('meta', rr, 'routes'); setRoutes(rr);
  return true;
}

const lvOf = c => (RT.data.levels && c[3] !== undefined ? RT.data.levels[c[3]] : '') || '';
const statCat = s => { s = String(s || '').toUpperCase(); return s === 'PULLED' ? '--v-good' : s === 'DAMAGED' ? '--v-bad' : s === 'SPARE' ? '--v-none' : '--v-warn'; };
const STAT_ES = { PULLED: 'Tendido (Pulled)' };
const fmtDate = iso => { try { return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };

function renderRoutes() {
  const host = $('#routes'); if (!host) return;
  if (!RT.data) {
    $('#rtInfo').textContent = '';
    host.innerHTML = `<div class="empty-big"><h3>${RT.loading ? 'Descargando las rutas…' : 'Todavía no hay datos de rutas'}</h3>
      <p>${RT.err ? esc(RT.err) : 'Aquí verás qué cables pasan por cada bandeja o tránsito, de todas las disciplinas, con su estado.'}</p>
      ${RT.loading ? '' : `<div class="btn-row"><button class="btn primary" id="rtPull">Descargar las rutas del CC_SCHEDULE</button></div>
      <p class="help">${cloud.on() ? 'Se leen de la columna ROUTE_CODES de tu pestaña CC_SCHEDULE. Puede tardar unos segundos.' : 'Conecta tu Google en Ajustes, o importa el Excel del CC_SCHEDULE en Ajustes → Sin Google.'}</p>`}</div>`;
    if (!RT.tried && !RT.loading && cloud.on()) { RT.tried = true; pullRoutes(true); }
    return;
  }
  $('#rtInfo').textContent = `${RT.data.codes.length.toLocaleString('es-ES')} códigos, ${RT.data.cables.length.toLocaleString('es-ES')} cables`;
  host.innerHTML = `
  <div class="rt ${RT.sel >= 0 ? 'has-sel' : ''}">
    <div class="rt-side">
      <label class="field"><span>Código de bandeja o tránsito</span>
        <input id="rtQ" type="search" placeholder="Por ejemplo UMS10-UG03 o WG11" autocomplete="off" value="${esc(RT.q)}"></label>
      <label class="opt"><input type="checkbox" id="rtHide" ${RT.hideNon ? 'checked' : ''}> Ocultar Field routing, Mini Route y BY SE/EN</label>
      <p class="help" id="rtCount"></p>
      <div class="rt-codes" id="rtCodes"></div>
      <p class="help rt-upd">Datos del ${esc(fmtDate(RT.fecha))}. <button class="btn small quiet" id="rtPull">${RT.loading ? 'Actualizando…' : 'Actualizar'}</button></p>
    </div>
    <div class="rt-main" id="rtMain"></div>
  </div>`;
  paintCodes(); paintRouteDetail();
}

function paintCodes() {
  const d = RT.data, q = norm(RT.q), out = [];
  for (const i of RT.order) {
    const c = d.codes[i];
    if (RT.hideNon && RT_NON(c)) continue;
    if (q && !norm(c).includes(q)) continue;
    out.push(i);
  }
  RT.listed = out;
  const shown = out.slice(0, RT.cLimit);
  $('#rtCount').textContent = out.length ? `${out.length.toLocaleString('es-ES')} códigos, ordenados por cables que pasan` : '';
  $('#rtCodes').innerHTML = shown.map(i => `<button class="rt-code ${i === RT.sel ? 'sel' : ''}" data-i="${i}"><span>${esc(d.codes[i].replace(/^#HKF\./, ''))}</span><b>${d.idx[i].length.toLocaleString('es-ES')}</b></button>`).join('')
    || '<p class="empty">Ningún código coincide. Prueba con otra parte del texto.</p>';
  if (out.length > shown.length) $('#rtCodes').insertAdjacentHTML('beforeend', `<button class="btn more" id="rtMore">Mostrar más (${(out.length - shown.length).toLocaleString('es-ES')} restantes)</button>`);
}

function routeRows() {
  const d = RT.data, ids = d.idx[RT.sel] || [];
  return ids.map(ci => d.cables[ci]).filter(c => (!RT.disc || d.discs[c[1]] === RT.disc) && (!RT.stat || d.stats[c[2]] === RT.stat));
}

function paintRouteDetail() {
  const main = $('#rtMain'), d = RT.data;
  if (RT.sel < 0) {
    main.innerHTML = '<div class="d-empty"><h2>Elige una bandeja o tránsito</h2><p>Busca el código a la izquierda y verás todos los cables que pasan por él, de cualquier disciplina, con su estado.</p></div>';
    return;
  }
  const code = d.codes[RT.sel], all = (d.idx[RT.sel] || []).map(ci => d.cables[ci]);
  const dc = new Map(), sc = new Map();
  all.forEach(c => { dc.set(c[1], (dc.get(c[1]) || 0) + 1); sc.set(c[2], (sc.get(c[2]) || 0) + 1); });
  const ord = [...dc].sort((a, b) => (d.discs[a[0]] === 'INS' ? -1 : 0) - (d.discs[b[0]] === 'INS' ? -1 : 0) || b[1] - a[1]);
  const rows = routeRows(), shown = rows.slice(0, RT.limit);
  const ins = all.filter(c => d.discs[c[1]] === 'INS').length;
  main.innerHTML = `
    <button class="btn quiet rt-back" id="rtBack">← Todas las rutas</button>
    <div class="marker"><span class="sleeve"></span><span class="mk-body"><b>${esc(code)}</b></span><button class="btn small quiet copy" id="rtCopyCode">Copiar</button></div>
    <div class="kpis rt-k">
      <div class="kpi"><span>Cables que pasan</span><b>${all.length.toLocaleString('es-ES')}</b><small>todas las disciplinas</small></div>
      <div class="kpi"><span>Nuestros (INS)</span><b>${ins.toLocaleString('es-ES')}</b><small>${all.length ? Math.round(ins * 100 / all.length) : 0} % del total</small></div>
    </div>
    <p class="chart-t">Disciplina</p>
    <div class="chips" id="rtDisc"><button class="filter ${RT.disc === '' ? 'on' : ''}" data-d="">Todas ${all.length}</button>${ord.map(([k, n]) => `<button class="filter ${RT.disc === d.discs[k] ? 'on' : ''}" data-d="${esc(d.discs[k])}">${esc(d.discs[k] || '(sin)')} ${n}</button>`).join('')}</div>
    <p class="chart-t">Status del cable (CURRENT_STATUS)</p>
    <div class="chips" id="rtStat"><button class="filter ${RT.stat === '' ? 'on' : ''}" data-s="">Todos</button>${[...sc].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<button class="filter ${RT.stat === d.stats[k] ? 'on' : ''}" data-s="${esc(d.stats[k])}">${esc(d.stats[k] || '(sin)')} ${n}</button>`).join('')}</div>
    <div class="toolbar rt-tools">
      <span class="muted">${rows.length.toLocaleString('es-ES')} cables</span>
      <button class="btn" id="rtAdd">Añadir los ${rows.length.toLocaleString('es-ES')} a la lista</button>
      <button class="btn" id="rtCopy">Copiar tags</button>
      <button class="btn primary" id="rtPdf">PDF</button>
    </div>
    <div class="table-wrap"><table class="legend rt-table"><thead><tr><th>Tag</th><th>Disciplina</th><th>Level</th><th>Status</th><th>Status en la tabla</th></tr></thead><tbody>
      ${shown.map(c => {
        const ri = IDX.get(norm(c[0])), st = d.stats[c[2]], tb = ri !== undefined && STATI >= 0 ? DATA.rows[ri][STATI] : '';
        return `<tr><td class="tagc">${esc(c[0])}</td><td>${esc(d.discs[c[1]] || '')}</td><td>${esc(lvOf(c))}</td><td>${sw(statCat(st))}${esc(STAT_ES[String(st).toUpperCase()] || st || '')}</td><td>${esc(tb ? sentence(tb) : '')}</td></tr>`;
      }).join('') || '<tr><td colspan="5" class="empty">Ningún cable con esos filtros.</td></tr>'}
    </tbody></table></div>
    ${rows.length > shown.length ? `<button class="btn more" id="rtMoreRows">Mostrar más (${(rows.length - shown.length).toLocaleString('es-ES')} restantes)</button>` : ''}`;
}

document.addEventListener('click', async e => {
  if (!e.target.closest('#routes')) return;
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'rtPull') { await pullRoutes(false); return; }
  if (t.id === 'rtMore') { RT.cLimit += 200; paintCodes(); return; }
  if (t.id === 'rtMoreRows') { RT.limit += 400; paintRouteDetail(); return; }
  if (t.classList.contains('rt-code')) {
    RT.sel = +t.dataset.i; RT.disc = ''; RT.stat = ''; RT.limit = 300;
    $('.rt').classList.add('has-sel'); paintCodes(); paintRouteDetail();
    $('#rtMain').scrollIntoView({ block: 'start' });
    return;
  }
  if (t.id === 'rtBack') { RT.sel = -1; $('.rt').classList.remove('has-sel'); paintCodes(); paintRouteDetail(); return; }
  if (t.dataset.d !== undefined && t.closest('#rtDisc')) { RT.disc = t.dataset.d; RT.limit = 300; paintRouteDetail(); return; }
  if (t.dataset.s !== undefined && t.closest('#rtStat')) { RT.stat = t.dataset.s; RT.limit = 300; paintRouteDetail(); return; }
  if (t.id === 'rtCopyCode') { try { await navigator.clipboard.writeText(RT.data.codes[RT.sel]); toast('Código copiado'); } catch { toast('No se pudo copiar'); } return; }
  if (t.id === 'rtCopy') { try { await navigator.clipboard.writeText(routeRows().map(c => c[0]).join('\n')); toast('Tags copiados'); } catch { toast('No se pudo copiar'); } return; }
  if (t.id === 'rtPdf') { await routesPdf(); return; }
  if (t.id === 'rtAdd') {
    const have = new Set(scanList.map(x => norm(x.tag))), now = new Date().toISOString(); let add = 0;
    for (const c of routeRows()) { if (have.has(norm(c[0]))) continue; have.add(norm(c[0])); scanList.push({ tag: c[0], code: c[0], found: true, time: now, sched: true }); add++; }
    LS.set('scanList', scanList); renderList();
    toast(add ? `${add.toLocaleString('es-ES')} cables añadidos a la lista` : 'Todos esos cables ya estaban en la lista', 3500);
  }
});
document.addEventListener('input', e => { if (e.target.id === 'rtQ') { RT.q = e.target.value; RT.cLimit = 150; paintCodes(); } });
document.addEventListener('change', e => { if (e.target.id === 'rtHide') { RT.hideNon = e.target.checked; RT.cLimit = 150; paintCodes(); } });

/* PDF con los cables de la bandeja o tránsito elegido (con los filtros de disciplina y status puestos) */
async function routesPdf() {
  const d = RT.data, rows = routeRows();
  if (RT.sel < 0 || !rows.length) return toast('No hay cables que exportar');
  const btn = $('#rtPdf'); btn.disabled = true;
  try {
    toast('Preparando el PDF', 8000);
    if (!(window.jspdf && window.jspdf.jsPDF)) { await loadScript('vendor/jspdf.umd.min.js'); await loadScript('vendor/jspdf.plugin.autotable.min.js'); }
    const code = d.codes[RT.sel], doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const filt = [RT.disc && 'Disciplina ' + RT.disc, RT.stat && 'Status ' + RT.stat].filter(Boolean).join(', ');
    const byD = new Map(); rows.forEach(c => byD.set(d.discs[c[1]] || '(sin)', (byD.get(d.discs[c[1]] || '(sin)') || 0) + 1));
    const resumen = [...byD].map(([k, n]) => `${k} ${n}`).join('   ');
    const stampTxt = new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
    doc.autoTable({
      head: [['Tag', 'Disciplina', 'Level', 'Status (CURRENT_STATUS)', 'Status en la tabla']],
      body: rows.map(c => { const ri = IDX.get(norm(c[0])); return [c[0], d.discs[c[1]] || '', lvOf(c), d.stats[c[2]] || '', ri !== undefined && STATI >= 0 ? sentence(DATA.rows[ri][STATI]) : '']; }),
      startY: 27, margin: { top: 27, left: 8, right: 8, bottom: 12 },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.5, lineColor: [140, 150, 160], lineWidth: 0.15, valign: 'middle' },
      headStyles: { fillColor: [16, 32, 48], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 248, 250] }, rowPageBreak: 'avoid',
      didDrawPage: p => {
        doc.setFontSize(14); doc.setTextColor(16, 32, 48); doc.text('Transit y bandejas', 8, 11);
        doc.setFontSize(10); doc.text(code, 8, 17);
        doc.setFontSize(8.5); doc.setTextColor(90, 100, 110);
        doc.text(`${rows.length} cables${filt ? '  |  ' + filt : ''}  |  ${resumen}`, 8, 22.5);
        doc.text(stampTxt, W - 8, 11, { align: 'right' });
        doc.text(`Pagina ${p.pageNumber}`, W - 8, H - 5, { align: 'right' });
      },
    });
    doc.save(`transit_${code.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}_${stamp()}.pdf`);
    toast('PDF descargado', 3000);
  } catch (e) { toast('No se pudo crear el PDF: ' + e.message, 5000); }
  finally { btn.disabled = false; }
}
