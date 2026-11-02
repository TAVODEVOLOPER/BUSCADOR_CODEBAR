/* Cableado: cambios del personal (status de campo y notas) para filtrarlos, imputarlos y deshacerlos */
const CH = { est: 'pend', tipo: '', who: '', q: '', lim: 80, list: [] };
const chLabel = n => n.estado ? (FS_ES[n.estado.tipo] || n.estado.tipo) : 'Nota';
const chDetail = n => n.estado ? fsDetail(n.estado) : String(n.text || '');
const chMine = n => !n.author || n.author === cloud.author();
function chFiltered(all, skip) {
  const q = norm(CH.q);
  return all.filter(n => {
    if (skip !== 'est' && CH.est === 'pend' && n.rev === 'Imputado') return false;
    if (skip !== 'est' && CH.est === 'done' && n.rev !== 'Imputado') return false;
    if (skip !== 'tipo' && CH.tipo && chLabel(n) !== CH.tipo) return false;
    if (skip !== 'who' && CH.who && (n.author || '') !== CH.who) return false;
    if (q && !norm(n.tag + ' ' + chDetail(n) + ' ' + (n.author || '')).includes(q)) return false;
    return true;
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
async function renderCambios() {
  const root = $('#cambios'); if (!root) return;
  const all = await DB.all('notes'), adm = cloud.admin();
  const hits = chFiltered(all); CH.list = hits;
  const nPend = chFiltered(all, 'est').filter(n => n.rev !== 'Imputado').length, nDone = chFiltered(all, 'est').filter(n => n.rev === 'Imputado').length;
  const tipos = [...new Set(all.map(chLabel))], who = [...new Set(all.map(n => n.author || '').filter(Boolean))].sort();
  if (!$('#chQ')) root.innerHTML = `<label class="field"><span>Buscar cable, persona o texto</span><input id="chQ" type="search" autocomplete="off" value="${esc(CH.q)}"></label><div id="chBody"></div>`;
  $('#chBody').innerHTML = `<div class="filters" id="chEst"><button class="filter ${CH.est === 'pend' ? 'on' : ''}" data-est="pend">Por imputar ${nPend}</button><button class="filter ${CH.est === 'done' ? 'on' : ''}" data-est="done">Imputados ${nDone}</button><button class="filter ${CH.est === '' ? 'on' : ''}" data-est="">Todos ${nPend + nDone}</button></div>
    <div class="filters" id="chTipo"><button class="filter ${CH.tipo === '' ? 'on' : ''}" data-tipo="">Todos los tipos</button>${tipos.map(t => `<button class="filter ${CH.tipo === t ? 'on' : ''}" data-tipo="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <label class="field"><span>Personal</span><select id="chWho"><option value="">Todo el personal</option>${who.map(w => `<option ${CH.who === w ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></label>
    <div class="btn-row"><button class="btn primary" id="chPdf" ${hits.length ? '' : 'disabled'}>PDF de cambios (${hits.length})</button>${adm ? `<button class="btn" id="chDone" ${hits.some(n => n.synced && n.rev !== 'Imputado') ? '' : 'disabled'}>Marcar los ${hits.filter(n => n.synced && n.rev !== 'Imputado').length} como imputados</button>` : ''}</div>
    <p class="help">${hits.length.toLocaleString('es-ES')} cambios. Son los status de campo y notas que puso el personal; no tocan la tabla CABLEADO.</p>
    <div class="rows">${hits.slice(0, CH.lim).map(n => `<div class="row ch-row ${n.rev === 'Imputado' ? 'st-ok' : 'st-warn'}"><span class="t">${esc(n.tag)}</span>
      <span class="m"><span class="fs-pill ${n.estado ? fsCls(n.estado.tipo) : ''}">${esc(chLabel(n))}</span><span class="cx-pill ${n.rev === 'Imputado' ? 'st-ok' : 'st-warn'}">${n.rev === 'Imputado' ? 'Imputado' : 'Por imputar'}</span>${n.synced ? '' : '<span class="cx-pill st-na">Pendiente de subir</span>'}</span>
      <span class="m"><span>${esc(chDetail(n))}</span></span>
      <span class="m"><small>${esc(new Date(n.date).toLocaleString('es-ES'))}${n.author ? ', ' + esc(n.author) : ''}</small></span>
      <span class="btn-row"><button class="btn small" data-ch-open="${esc(n.tag)}">Abrir cable</button>${adm && n.synced ? `<button class="btn small" data-ch-rev="${n.id}">${n.rev === 'Imputado' ? 'Quitar imputado' : 'Marcar imputado'}</button>` : ''}${(adm || chMine(n)) ? `<button class="btn small danger" data-ch-undo="${n.id}">Deshacer</button>` : ''}</span></div>`).join('') || '<p class="empty">No hay cambios con estos filtros.</p>'}</div>
    ${hits.length > CH.lim ? `<button class="btn more" id="chMore">Mostrar más (${(hits.length - CH.lim).toLocaleString('es-ES')} restantes)</button>` : ''}`;
}
document.addEventListener('input', e => { if (e.target.id === 'chQ') { CH.q = e.target.value; CH.lim = 80; renderCambios().then(() => { const q = $('#chQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); } });
document.addEventListener('change', e => { if (e.target.id === 'chWho') { CH.who = e.target.value; CH.lim = 80; renderCambios(); } });
$('#cambios').addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.est !== undefined) { CH.est = t.dataset.est; CH.lim = 80; return renderCambios(); }
  if (t.dataset.tipo !== undefined) { CH.tipo = t.dataset.tipo; CH.lim = 80; return renderCambios(); }
  if (t.id === 'chMore') { CH.lim += 80; return renderCambios(); }
  if (t.id === 'chPdf') return chPdf(CH.list);
  if (t.dataset.chOpen !== undefined) { const i = IDX.get(norm(t.dataset.chOpen)); if (i === undefined) return toast('Ese cable no está en tu tabla CABLEADO'); setTab('search'); return openCable(i, true); }
  const toggle = async (list, estado) => {
    const ids = list.filter(n => n.synced).map(n => n.uid); if (!ids.length) return toast('Esperando a que los cambios suban');
    try { await apiPost('revNotas', { ids, estado, author: cloud.author() }); for (const n of list) if (n.synced) { n.rev = estado; await DB.put('notes', n); } toast(estado ? 'Marcados como imputados' : 'Marca quitada'); }
    catch (er) { toast('No se pudo marcar: ' + er.message, 5000); }
    renderCambios();
  };
  if (t.id === 'chDone') { const l = CH.list.filter(n => n.rev !== 'Imputado'); if (confirm(`¿Marcar los ${l.length} cambios como imputados en el sistema externo?`)) toggle(l, 'Imputado'); }
  else if (t.dataset.chRev !== undefined) { const n = CH.list.find(x => String(x.id) === t.dataset.chRev); if (n) toggle([n], n.rev === 'Imputado' ? '' : 'Imputado'); }
  else if (t.dataset.chUndo !== undefined) {
    const n = CH.list.find(x => String(x.id) === t.dataset.chUndo); if (!n) return;
    if (!confirm(n.estado ? '¿Deshacer este status de campo? Se quita también para el resto del equipo.' : '¿Borrar esta nota? Se borrará también para el resto del equipo.')) return;
    if (n.synced && !(await cloudDelete('delNote', { id: n.uid }))) return;
    await DB.del('notes', n.id); await refreshFlags(); renderCambios();
  }
});
async function chPdf(list) {
  if (!(window.jspdf && window.jspdf.jsPDF)) { await loadScript('vendor/jspdf.umd.min.js'); await loadScript('vendor/jspdf.plugin.autotable.min.js'); }
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), when = new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  doc.autoTable({
    head: [['Cable', 'Tipo', 'Detalle', 'Reportó', 'Fecha', 'Imputado']],
    body: list.map(n => [String(n.tag).replace(/^#HKF\./, ''), chLabel(n), chDetail(n), n.author || '', new Date(n.date).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }), n.rev === 'Imputado' ? 'OK' : '']),
    startY: 19, margin: { top: 19, left: 8, right: 8, bottom: 11 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, lineColor: [150, 158, 166], lineWidth: 0.15, valign: 'middle', overflow: 'linebreak', minCellHeight: 9 },
    headStyles: { fillColor: [16, 32, 48], textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [246, 248, 250] },
    columnStyles: { 0: { cellWidth: 58, fontStyle: 'bold' }, 1: { cellWidth: 22 }, 2: { cellWidth: 'auto' }, 3: { cellWidth: 34 }, 4: { cellWidth: 30 }, 5: { cellWidth: 18, halign: 'center' } },
    rowPageBreak: 'avoid',
    didDrawCell: x => { if (x.section !== 'body' || x.column.index !== 5 || String(x.cell.raw) === 'OK') return; const c = x.cell, s = 4.2; doc.setDrawColor(40, 50, 60); doc.setLineWidth(0.35); doc.rect(c.x + (c.width - s) / 2, c.y + (c.height - s) / 2, s, s); },
    didDrawPage: x => { doc.setFontSize(13); doc.setTextColor(16, 32, 48); doc.text('Cambios del personal en Cableado', 8, 10.5); doc.setFontSize(8.5); doc.setTextColor(90, 100, 110); doc.text(`${when}  |  ${list.length} cambios`, 8, 15.5); doc.text(`Hoja ${x.pageNumber}`, W - 8, H - 4.5, { align: 'right' }); },
  });
  doc.save(`cambios_cableado_${new Date().toISOString().slice(0, 10)}.pdf`);
}
