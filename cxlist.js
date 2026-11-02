/* Conexionado: lista de trabajo. Se arma desde Buscar (cables de tu hoja con 0 %, 50 % o 100 % de avance y cables nuevos del CC_SCHEDULE)
   y se manda a una pestaña del Sheet, a Excel o a un PDF de trabajo, igual que la lista de Cableado. */
'use strict';
CX.list = LS.get('cxList', []);
const cxListSave = () => { LS.set('cxList', CX.list); cxListPaint(); if (typeof cxAddBtn === 'function') cxAddBtn(); };
const cxListSheet = () => LS.get('cxSheetName', 'LISTA_CONEXIONADO') || 'LISTA_CONEXIONADO';
const cxIsNew = tag => !CX.data || !CX.idx.has(norm(tag));

function cxListAdd(tags) {
  const have = new Set(CX.list.map(x => norm(x.tag))); let add = 0;
  for (const tag of tags) { const k = norm(tag); if (have.has(k)) continue; have.add(k); CX.list.push({ tag, nuevo: cxIsNew(tag), time: new Date().toISOString() }); add++; }
  cxListSave(); return add;
}
function cxListToggle(tag, add) {
  const k = norm(tag), i = CX.list.findIndex(x => norm(x.tag) === k);
  if (i >= 0) { CX.list.splice(i, 1); cxListSave(); toast('Quitado de la lista'); }
  else { cxListAdd([tag]); toast('Añadido a la lista'); }
}
function cxAddAllHits() {
  let tags;
  if (CX.src === 'new') { const hits = cxNewHits() || []; tags = hits.map(ri => CCD.src.rows[ri][CCD.src.tagi]); }
  else tags = cxHits().map(i => CX.data.rows[i][CX.ti]);
  if (tags.length > 400 && !confirm(`Se van a añadir ${tags.length.toLocaleString('es-ES')} cables a la lista. ¿Seguro?`)) return;
  const n = cxListAdd(tags); toast(n ? `Añadidos ${n} a la lista` : 'Todos esos cables ya estaban en la lista');
  renderCxSearch();
}

/* valor de una columna de la hoja CONEXIONADO para un cable de la lista; si es nuevo, de las columnas del CC_SCHEDULE con el mismo nombre */
function cxItemAv(x) { const i = CX.data && CX.idx.get(norm(x.tag)); return i === undefined || i === null ? 0 : cxAv(CX.data.rows[i]); }
function cxItemVal(x, name) {
  if (name === 'Avance') return cxItemAv(x) + ' %';
  if (name === 'Origen') return cxIsNew(x.tag) ? 'Nuevo del CC_SCHEDULE' : 'CONEXIONADO';
  const i = CX.data ? CX.idx.get(norm(x.tag)) : undefined;
  if (i !== undefined) { let ci = CX.ci.get(name); if (ci === undefined) ci = CX.data.cols.findIndex(k => nname(k.name) === nname(name)); return ci < 0 ? '' : (CX.data.rows[i][ci] ?? ''); }
  if (typeof CCD !== 'undefined' && CCD.src) {
    const ri = CCD.idx.get(norm(x.tag)); if (ri === undefined) return '';
    const ci = CCD.src.columns.findIndex(c => nname(c.name) === nname(name));
    return ci < 0 ? '' : (CCD.src.rows[ri][ci] ?? '');
  }
  return '';
}
const cxNice = v => (typeof fmtVal === 'function' ? fmtVal(String(v ?? '')) : String(v ?? ''));
function cxListMatrix() {
  const cols = CX.data ? CX.data.cols.map(c => c.name).filter(n => n !== 'CABLE_NUMBER') : [];
  const head = ['#', 'Hora', 'CABLE_NUMBER', 'Origen', 'Avance', ...cols];
  return { head, rows: CX.list.map((x, n) => [n + 1, new Date(x.time).toLocaleString('es-ES'), x.tag, cxItemVal(x, 'Origen'), cxItemVal(x, 'Avance'), ...cols.map(c => cxNice(cxItemVal(x, c)))]) };
}

function cxListPaint() {
  $$('.cxcount').forEach(c => { c.textContent = CX.list.length; });
  const t = $('#cxListTable'); if (!t) return;
  const nn = CX.list.filter(x => cxIsNew(x.tag)).length;
  $('#cxListHint').textContent = CX.list.length
    ? `${CX.list.length.toLocaleString('es-ES')} ${CX.list.length === 1 ? 'cable' : 'cables'}${nn ? `, ${nn} nuevos del CC_SCHEDULE` : ''}. Los nuevos llevan los datos que tienen en el CC_SCHEDULE.`
    : 'La lista está vacía. En Buscar elige cables con 0 % o 50 % de avance, o cables nuevos del CC_SCHEDULE, y pulsa Añadir.';
  const sh = x => String(x ?? '').replace(/^#HKF\./, '');
  t.innerHTML = '<thead><tr><th>#</th><th>Cable</th><th>From</th><th>Status From</th><th>To</th><th>Status To</th><th>Avance</th><th>Origen</th><th></th></tr></thead><tbody>' +
    CX.list.map((x, n) => `<tr data-n="${n}" class="${cxIsNew(x.tag) ? '' : ''}"><td>${n + 1}</td><td class="tagc">${esc(x.tag)}</td><td>${esc(sh(cxItemVal(x, 'From_Tag')))}</td><td>${esc(cxNice(cxItemVal(x, 'STATUS_FROM')))}</td><td>${esc(sh(cxItemVal(x, 'To_Tag')))}</td><td>${esc(cxNice(cxItemVal(x, 'STATUS_TO')))}</td><td>${cxItemAv(x)} %</td><td>${cxIsNew(x.tag) ? 'Nuevo' : 'Hoja'}</td><td><button class="x" data-del="${n}" aria-label="Quitar de la lista">✕</button></td></tr>`).join('') + '</tbody>';
}
const cxNeedList = () => CX.list.length ? true : (toast('La lista está vacía. Añade cables desde Buscar.'), false);
const cxStamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

document.addEventListener('click', async e => {
  const t = e.target.closest('button,tr'); if (!t) return;
  if (t.closest('#cxListTable')) {
    const dl = e.target.closest('[data-del]');
    if (dl) { CX.list.splice(+dl.dataset.del, 1); cxListSave(); return; }
    const tr = e.target.closest('tr[data-n]');
    if (tr) { const x = CX.list[+tr.dataset.n]; if (x && cxHas(x.tag)) openCx(x.tag); else toast('Es un cable nuevo: todavía no tiene fila en CONEXIONADO'); }
    return;
  }
  if (t.id === 'cxBtnXlsx') {
    if (!cxNeedList()) return;
    const { head, rows } = cxListMatrix(), ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = head.map(h => ({ wch: Math.min(38, Math.max(10, String(h).length + 2)) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'LISTA_CONEXIONADO'); XLSX.writeFile(wb, `lista_conexionado_${cxStamp()}.xlsx`);
  } else if (t.id === 'cxBtnSheet') {
    if (!cxNeedList()) return;
    if (!cloud.on()) { toast('Conecta tu Google (URL y clave) en Ajustes', 4000); return; }
    const { head, rows } = cxListMatrix();
    try { const j = await apiPost('scans', { sheet: cxListSheet(), header: head, rows }); toast(`Enviadas ${j.added} filas a la pestaña ${cxListSheet()}`, 3500); }
    catch (er) { toast('No se pudo enviar la lista: ' + er.message, 4500); }
  } else if (t.id === 'cxBtnPdf') {
    if (!cxNeedList()) return;
    if (typeof openPdf === 'function') { pdfMode = 'con'; openPdf(); }
  } else if (t.id === 'cxBtnClear') {
    if (!CX.list.length) return;
    if (!confirm(cloud.on() ? `¿Vaciar la lista de conexionado? También se borran las filas de la pestaña ${cxListSheet()} de tu Google Sheet.` : '¿Vaciar la lista de conexionado?')) return;
    if (cloud.on() && !(await cloudDelete('clearScans', { sheet: cxListSheet() }))) return;
    CX.list = []; cxListSave(); toast('Lista vaciada');
  }
});
/* "Añadir a la lista" de la ficha */
$('#vAddList').addEventListener('click', () => {
  if ($('#app').dataset.mod !== 'con' || !CX.sel) return;
  if (cxInList(CX.sel)) return toast('Ese cable ya está en la lista');
  cxListAdd([CX.sel]); toast('Añadido a la lista'); renderCxSearch();
});
cxListPaint();


/* ---------- PDF de trabajo de campo (compacto: unos 15 cables por hoja) ---------- */
async function cxWorkPdf(title) {
  if (!(window.jspdf && window.jspdf.jsPDF)) { await loadScript('vendor/jspdf.umd.min.js'); await loadScript('vendor/jspdf.plugin.autotable.min.js'); }
  const sh = v => String(v ?? '').replace(/^#HKF\./, '').trim(), V = (x, n) => String(cxItemVal(x, n) ?? '').trim();
  const key = x => (V(x, 'From_Area') || '~') + '|' + (V(x, 'To_Area') || '~') + '|' + x.tag;   // por área; los nuevos sin área al final
  const items = CX.list.slice().sort((a, b) => key(a).localeCompare(key(b), 'es', { numeric: true }));
  const cols = pdfSel.length ? pdfSel.slice() : pdfDefaults();   // las columnas que eligió el usuario, en su orden
  const isSt = n => /^STATUS_(FROM|TO)$/i.test(n);
  const head = ['#'], kinds = ['n'];
  cols.forEach(n => {
    if (n === PDF_NOTAS) { head.push('Observaciones'); kinds.push('notes'); return; }
    head.push(n.replace(/_/g, ' ')); kinds.push(isSt(n) ? 'st' : n === 'CABLE_NUMBER' ? 'cable' : 'v');
    if (isSt(n)) { head.push('Conex.'); kinds.push('box'); }
  });
  const body = items.map((x, k) => {
    const row = [k + 1];
    cols.forEach(n => {
      if (n === PDF_NOTAS) return row.push('');
      if (n === 'CABLE_NUMBER') return row.push(sh(x.tag) + (cxIsNew(x.tag) ? '\nNUEVO (CC_SCHEDULE)' : ''));
      if (n === 'Avance') return row.push(cxItemAv(x) + ' %');
      if (isSt(n)) { const st = V(x, n).toUpperCase(); row.push(st === 'IMPUTADO' ? 'HECHO' : (st || 'SIN STATUS')); return row.push(st === 'IMPUTADO' ? 'OK' : ''); }
      row.push(sh(cxNice(cxItemVal(x, n))));
    });
    return row;
  });
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), when = new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  const nn = items.filter(x => cxIsNew(x.tag)).length, colStyles = {};
  // fechas cortas y anchos medidos: ninguna columna se parte letra por letra
  body.forEach(rw => rw.forEach((v, k) => { if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) rw[k] = v.slice(8) + '/' + v.slice(5, 7) + '/' + v.slice(2, 4); else if (typeof v === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) rw[k] = v.replace(/\/(\d{2})(\d{2})$/, '/$2'); }));
  const avail = W - 16, PAD = 3.4, wOf = (t, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); return doc.getTextWidth(t); };
  let fs = 7.5, mins = [], ideals = [];
  const measure = () => {
    doc.setFontSize(fs); mins = []; ideals = [];
    head.forEach((h, k) => {
      const kd = kinds[k];
      if (kd === 'n') { mins.push(7); ideals.push(7); return; }
      if (kd === 'box') { mins.push(11); ideals.push(11); return; }
      let mn = Math.max(...String(h).split(/\s+/).map(w => wOf(w, true))), id = wOf(String(h), true);
      body.forEach(rw => String(rw[k] ?? '').split('\n').forEach(line => { id = Math.max(id, wOf(line, kd === 'cable')); line.split(/\s+/).forEach(w => { mn = Math.max(mn, wOf(w, kd === 'cable' || kd === 'st')); }); }));
      if (kd === 'notes') { mn = Math.max(mn, 30 / 1); id = Math.max(id, 45); }
      mins.push(mn + PAD); ideals.push(Math.min(id + PAD, kd === 'notes' ? 70 : 46));
    });
  };
  measure(); while (mins.reduce((a, b) => a + b, 0) > avail && fs > 5.6) { fs -= 0.3; measure(); }
  const widths = mins.slice(), extra = avail - mins.reduce((a, b) => a + b, 0), want = ideals.map((v, k) => Math.max(0, v - mins[k])), wantSum = want.reduce((a, b) => a + b, 0);
  if (extra > 0) { const f = wantSum ? Math.min(1, extra / wantSum) : 0; want.forEach((v, k) => { widths[k] += v * f; }); const left = avail - widths.reduce((a, b) => a + b, 0); if (left > 0) { const nk = kinds.lastIndexOf('notes'), t = nk >= 0 ? nk : widths.length - 1; widths[t] += left; } }
  else { const sc = avail / widths.reduce((a, b) => a + b, 0); widths.forEach((v, k) => { widths[k] = v * sc; }); }
  kinds.forEach((kd, k) => { colStyles[k] = { cellWidth: widths[k], halign: kd === 'n' || kd === 'box' || kd === 'st' ? 'center' : 'left', fontStyle: kd === 'cable' ? 'bold' : 'normal' }; });
  doc.autoTable({
    head: [head], body,
    startY: 19, margin: { top: 19, left: 8, right: 8, bottom: 11 },
    styles: { font: 'helvetica', fontSize: fs, cellPadding: { top: 1.4, bottom: 1.4, left: 1.7, right: 1.7 }, lineColor: [150, 158, 166], lineWidth: 0.15, valign: 'middle', overflow: 'linebreak', minCellHeight: 11 },
    headStyles: { fillColor: [16, 32, 48], textColor: 255, fontStyle: 'bold', minCellHeight: 7, fontSize: fs, valign: 'middle' },
    tableWidth: avail,
    alternateRowStyles: { fillColor: [246, 248, 250] },
    columnStyles: colStyles,
    rowPageBreak: 'avoid',
    didParseCell: d => {
      if (d.section !== 'body') return;
      if (kinds[d.column.index] === 'st') { const v = String(d.cell.raw); d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = v === 'HECHO' ? [10, 120, 80] : v === 'FALTA' || v === 'NO ENCONTRADO' ? [190, 40, 30] : [150, 100, 0]; }
    },
    didDrawCell: d => {   // casilla vacía para marcar en campo
      if (d.section !== 'body' || kinds[d.column.index] !== 'box') return;
      const c = d.cell, s = 4.2, x = c.x + (c.width - s) / 2, y = c.y + (c.height - s) / 2;
      doc.setDrawColor(40, 50, 60); doc.setLineWidth(0.35); if (String(c.raw) !== 'OK') doc.rect(x, y, s, s);
    },
    didDrawPage: d => {
      doc.setFontSize(13); doc.setTextColor(16, 32, 48); doc.text(title, 8, 10.5);
      doc.setFontSize(8.5); doc.setTextColor(90, 100, 110); doc.text(`${when}  |  ${items.length} cables${nn ? `, ${nn} nuevos` : ''}`, 8, 15.5);
      doc.text(`Hoja ${d.pageNumber}`, W - 8, H - 4.5, { align: 'right' });
    },
  });
  doc.save(`lista_conexionado_${cxStamp()}.pdf`);
}

/* ---------- PDF de avances de campo por imputar (para pasarlos al sistema externo) ---------- */
async function cxAvancesPdf(hits) {
  if (!(window.jspdf && window.jspdf.jsPDF)) { await loadScript('vendor/jspdf.umd.min.js'); await loadScript('vendor/jspdf.plugin.autotable.min.js'); }
  const d = CX.data, sh = v => String(v ?? '').replace(/^#HKF\./, '').trim(), fd = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : v;
  const body = [];
  hits.forEach(i => {
    const r = d.rows[i], tag = r[CX.ti], o = CX.pmap.get(norm(tag)); if (!o) return;
    const sides = {};
    o.forEach((e, col) => { const c = d.cols[CX.ci.get(col)]; if (!c) return; const g = cxGrp(c) || 'GENERAL'; (sides[g] = sides[g] || []).push([c, e]); });
    ['FROM', 'TO', ...Object.keys(sides).filter(g => g !== 'FROM' && g !== 'TO')].forEach(g => {
      const list = sides[g]; if (!list) return;
      const find = re => list.find(([c]) => re.test(c.name)), st = find(/^STATUS_(FROM|TO)$/i), fe = find(/^FECHA_/i);
      const rest = list.filter(x => x !== st && x !== fe).map(([c, e]) => `${c.name.replace(/_/g, ' ')}: ${fd(e.to) || '(vacío)'}`).join('\n');
      const who = list.map(([, e]) => e).sort((a, b) => b.date.localeCompare(a.date))[0];
      const tg = g === 'FROM' ? sh(r[CX.ci.get('From_Tag')]) : g === 'TO' ? sh(r[CX.ci.get('To_Tag')]) : '';
      body.push([sh(tag), g === 'GENERAL' ? 'General' : (g === 'FROM' ? 'From' : g === 'TO' ? 'To' : g) + (tg ? '\n' + tg : ''), st ? (st[1].to || '(vacío)') : '', fe ? fd(fe[1].to) : '', rest, `${who.who || ''}\n${who.date}`, '']);
    });
  });
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), when = new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  doc.autoTable({
    head: [['Cable', 'Punta', 'Status', 'Fecha status', 'Otros datos', 'Reportó', 'Imputado']], body,
    startY: 19, margin: { top: 19, left: 8, right: 8, bottom: 11 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, lineColor: [150, 158, 166], lineWidth: 0.15, valign: 'middle', overflow: 'linebreak', minCellHeight: 10 },
    headStyles: { fillColor: [16, 32, 48], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 248, 250] },
    columnStyles: { 0: { cellWidth: 56, fontStyle: 'bold' }, 1: { cellWidth: 50 }, 2: { cellWidth: 28, fontStyle: 'bold' }, 3: { cellWidth: 24 }, 4: { cellWidth: 'auto' }, 5: { cellWidth: 38 }, 6: { cellWidth: 18 } },
    rowPageBreak: 'avoid',
    didDrawCell: x => { if (x.section !== 'body' || x.column.index !== 6) return; const c = x.cell, s = 4.4; doc.setDrawColor(40, 50, 60); doc.setLineWidth(0.35); doc.rect(c.x + (c.width - s) / 2, c.y + (c.height - s) / 2, s, s); },
    didDrawPage: x => {
      doc.setFontSize(13); doc.setTextColor(16, 32, 48); doc.text('Avances de conexionado por imputar', 8, 10.5);
      doc.setFontSize(8.5); doc.setTextColor(90, 100, 110); doc.text(`${when}  |  ${hits.length} cables`, 8, 15.5); doc.text(`Hoja ${x.pageNumber}`, W - 8, H - 4.5, { align: 'right' });
    },
  });
  doc.save(`avances_conexionado_${cxStamp()}.pdf`);
}
