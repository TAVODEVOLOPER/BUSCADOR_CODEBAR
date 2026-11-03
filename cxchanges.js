/* Conexionado: cambios del personal (avances de campo) para filtrarlos, imputarlos y deshacerlos */
const CC2 = { est: 'pend', who: '', col: '', q: '', lim: 80, list: [] };
function ccEntries() {
  const out = [];
  if (!CX.data) return out;
  (CX.data.log || []).forEach(e => { if (e[6] === 'Deshecho') return; out.push({ date: e[0], cable: e[1], col: e[2], from: e[3], to: e[4], who: e[5], est: e[6] || '', id: e[7] || '' }); });
  CX.q.filter(x => !x.synced).forEach(x => Object.entries(x.changes).forEach(([c, v]) => out.push({ date: x.date.slice(0, 16).replace('T', ' '), cable: x.cable, col: c, from: (x.before || {})[c] || '', to: v, who: x.author, est: 'Pendiente', pend: true, qid: x.id })));
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
function ccFiltered(all, skip) {
  const q = norm(CC2.q);
  return all.filter(e => {
    if (skip !== 'est' && CC2.est === 'pend' && e.est !== 'Pendiente') return false;
    if (skip !== 'est' && CC2.est === 'done' && e.est !== 'Imputado') return false;
    if (skip !== 'who' && CC2.who && (e.who || '') !== CC2.who) return false;
    if (skip !== 'col' && CC2.col && e.col !== CC2.col) return false;
    if (q && !norm(e.cable + ' ' + e.col + ' ' + e.to + ' ' + (e.who || '')).includes(q)) return false;
    return true;
  });
}
const ccStTxt = e => e.est === 'Imputado' ? 'Imputado' : e.est === 'Descartado' ? 'Descartado' : 'Por imputar';
const ccStCls = e => e.est === 'Imputado' ? 'st-ok' : e.est === 'Descartado' ? 'st-na' : 'st-warn';
function renderCxCambios() {
  const root = $('#ccambios'); if (!root) return;
  if (!CX.data) { root.innerHTML = '<p class="empty">Todavía no hay datos de Conexionado. Pulsa Actualizar.</p>'; return; }
  const all = ccEntries(), adm = cxAdm(), hits = ccFiltered(all); CC2.list = hits;
  const base = ccFiltered(all, 'est'), nPend = base.filter(e => e.est === 'Pendiente').length, nDone = base.filter(e => e.est === 'Imputado').length;
  const who = [...new Set(all.map(e => e.who || '').filter(Boolean))].sort(), cols = [...new Set(all.map(e => e.col))].sort();
  if (!$('#ccQ')) root.innerHTML = `<label class="field"><span>Buscar cable, persona o valor</span><input id="ccQ" type="search" autocomplete="off" value="${esc(CC2.q)}"></label><div id="ccBody"></div>`;
  const markable = hits.filter(e => e.est === 'Pendiente' && e.id);
  $('#ccBody').innerHTML = `<div class="filters" id="ccEst"><button class="filter ${CC2.est === 'pend' ? 'on' : ''}" data-est="pend">Por imputar ${nPend}</button><button class="filter ${CC2.est === 'done' ? 'on' : ''}" data-est="done">Imputados ${nDone}</button><button class="filter ${CC2.est === '' ? 'on' : ''}" data-est="">Todos ${base.length}</button></div>
    <div class="grid2"><label class="field"><span>Personal</span><select id="ccWho"><option value="">Todo el personal</option>${who.map(w => `<option ${CC2.who === w ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></label>
    <label class="field"><span>Campo</span><select id="ccCol"><option value="">Todos los campos</option>${cols.map(c => `<option ${CC2.col === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label></div>
    <div class="btn-row"><button class="btn primary" id="ccPdf" ${hits.length ? '' : 'disabled'}>PDF de cambios (${hits.length})</button>${adm ? `<button class="btn" id="ccDone" ${markable.length ? '' : 'disabled'}>Marcar los ${markable.length} como imputados</button>` : ''}</div>
    <p class="help">${hits.length.toLocaleString('es-ES')} cambios. Son avances de campo: no tocan la hoja CONEXIONADO hasta que los imputes en el sistema externo.</p>
    <div class="rows">${hits.slice(0, CC2.lim).map((e, k) => `<div class="row ch-row ${ccStCls(e)}"><span class="t">${esc(String(e.cable).replace(/^#HKF\./, ''))}</span>
      <span class="m"><span class="cx-pill ${ccStCls(e)}">${ccStTxt(e)}</span>${e.pend ? '<span class="cx-pill st-na">Pendiente de subir</span>' : ''}</span>
      <span class="m"><span>${esc(e.col)}: ${esc(e.from || 'vacío')} → <b>${esc(e.to || 'vacío')}</b></span></span>
      <span class="m"><small>${esc(e.date)}${e.who ? ', ' + esc(e.who) : ''}</small></span>
      <span class="btn-row"><button class="btn small" data-cc-open="${esc(e.cable)}">Abrir cable</button>${adm && e.est === 'Pendiente' && e.id ? `<button class="btn small" data-cc-mark="${esc(e.id)}">Marcar imputado</button>` : ''}${e.est === 'Pendiente' && (adm || cxMine(e.who)) && (e.id || e.qid) ? `<button class="btn small danger" data-cc-undo="${k}">Deshacer</button>` : ''}</span></div>`).join('') || '<p class="empty">No hay cambios con estos filtros.</p>'}</div>
    ${hits.length > CC2.lim ? `<button class="btn more" id="ccMore">Mostrar más (${(hits.length - CC2.lim).toLocaleString('es-ES')} restantes)</button>` : ''}`;
}
document.addEventListener('input', e => { if (e.target.id === 'ccQ') { CC2.q = e.target.value; CC2.lim = 80; renderCxCambios(); const q = $('#ccQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); } });
document.addEventListener('change', e => { if (e.target.id === 'ccWho') { CC2.who = e.target.value; CC2.lim = 80; renderCxCambios(); } if (e.target.id === 'ccCol') { CC2.col = e.target.value; CC2.lim = 80; renderCxCambios(); } });
$('#ccambios').addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.est !== undefined) { CC2.est = t.dataset.est; CC2.lim = 80; return renderCxCambios(); }
  if (t.id === 'ccMore') { CC2.lim += 80; return renderCxCambios(); }
  if (t.id === 'ccPdf') return ccPdf(CC2.list);
  if (t.dataset.ccOpen !== undefined) { setTab('cbuscar'); return openCx(t.dataset.ccOpen); }
  const done = async (ids, msg) => { await cxMarcar(ids, 'Imputado'); renderCxCambios(); };
  if (t.id === 'ccDone') { const ids = CC2.list.filter(x => x.est === 'Pendiente' && x.id).map(x => x.id); if (confirm(`¿Marcar los ${ids.length} cambios como imputados en el sistema externo?`)) done(ids); }
  else if (t.dataset.ccMark !== undefined) done([t.dataset.ccMark]);
  else if (t.dataset.ccUndo !== undefined) {
    const x = CC2.list[+t.dataset.ccUndo]; if (!x || !confirm('¿Deshacer este cambio? Se quita de los avances por imputar.')) return;
    if (x.pend) await cxUndoQueued(x.qid, x.col); else await cxUndoId(x.id);
    renderCxCambios();
  }
});
async function ccPdf(list) {
  if (!(window.jspdf && window.jspdf.jsPDF)) { await loadScript('vendor/jspdf.umd.min.js'); await loadScript('vendor/jspdf.plugin.autotable.min.js'); }
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), when = new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  doc.autoTable({
    head: [['Cable', 'Campo', 'Antes', 'Ahora', 'Reportó', 'Fecha', 'Imputado']],
    body: list.map(e => [String(e.cable).replace(/^#HKF\./, ''), e.col, e.from || '', e.to || '', e.who || '', e.date, e.est === 'Imputado' ? 'OK' : '']),
    startY: 19, margin: { top: 19, left: 8, right: 8, bottom: 11 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, lineColor: [150, 158, 166], lineWidth: 0.15, valign: 'middle', overflow: 'linebreak', minCellHeight: 9 },
    headStyles: { fillColor: [16, 32, 48], textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [246, 248, 250] },
    columnStyles: { 0: { cellWidth: 58, fontStyle: 'bold' }, 1: { cellWidth: 36 }, 2: { cellWidth: 30 }, 3: { cellWidth: 30 }, 4: { cellWidth: 34 }, 5: { cellWidth: 32 }, 6: { cellWidth: 18, halign: 'center' } },
    rowPageBreak: 'avoid',
    didDrawCell: x => { if (x.section !== 'body' || x.column.index !== 6 || String(x.cell.raw) === 'OK') return; const c = x.cell, s = 4.2; doc.setDrawColor(40, 50, 60); doc.setLineWidth(0.35); doc.rect(c.x + (c.width - s) / 2, c.y + (c.height - s) / 2, s, s); },
    didDrawPage: x => { doc.setFontSize(13); doc.setTextColor(16, 32, 48); doc.text('Cambios del personal en Conexionado', 8, 10.5); doc.setFontSize(8.5); doc.setTextColor(90, 100, 110); doc.text(`${when}  |  ${list.length} cambios`, 8, 15.5); doc.text(`Hoja ${x.pageNumber}`, W - 8, H - 4.5, { align: 'right' }); },
  });
  doc.save(`cambios_conexionado_${new Date().toISOString().slice(0, 10)}.pdf`);
}
