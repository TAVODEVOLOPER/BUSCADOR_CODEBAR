/* Cable Scan — buscar en el CC_SCHEDULE completo (cables de todo el proyecto y todas las disciplinas), también sin cobertura. */
'use strict';
const CCD = { data: null, src: null, idx: new Map(), loading: false, tried: false };

function setCC(r) {
  CCD.data = r;
  const rows = [], n = r.data[0] ? r.data[0].length : 0, cols = r.cols.length;
  for (let i = 0; i < n; i++) { const row = new Array(cols); for (let j = 0; j < cols; j++) row[j] = r.dict[j][r.data[j][i]]; rows.push(row); }
  const columns = r.cols.map((name, i) => ({ name, letter: colLetter(i) }));
  CCD.src = { columns, rows, tagi: Math.max(0, r.cols.indexOf('CABLE_NUMBER')), stati: r.cols.indexOf('CURRENT_STATUS'), sched: true, cc: true };
  CCD.idx = new Map(); rows.forEach((row, i) => CCD.idx.set(norm(row[CCD.src.tagi]), i));
  if (typeof renderSearch === 'function' && DATA) { buildChips(); renderSearch(); }
  if (typeof paintSrcSeg === 'function') paintSrcSeg();
}
async function loadCC() { const r = await DB.get('meta', 'cc').catch(() => null); if (r && r.cols) setCC(r); }
async function pullCC(silent) {
  if (!cloud.on()) { if (!silent) toast('Conecta tu Google en Ajustes', 4000); return false; }
  CCD.loading = true; if (typeof paintSrcSeg === 'function') paintSrcSeg();
  try {
    const j = await apiGet('ccdata', CCD.data && CCD.data.hash ? { hash: CCD.data.hash } : {});
    if (j.none) { if (!silent) toast('Tu Sheet no tiene la pestaña CC_SCHEDULE con datos', 5000); return false; }
    if (j.same) { CCD.data.fecha = new Date().toISOString(); await DB.put('meta', CCD.data, 'cc'); if (!silent) toast('La tabla CC ya está al día'); return true; }
    const r = { hash: j.hash, fecha: new Date().toISOString(), cols: j.cols, dict: j.dict, data: j.data };
    await DB.put('meta', r, 'cc'); setCC(r);
    if (!silent) toast(`Tabla CC guardada para usar sin cobertura: ${CCD.src.rows.length.toLocaleString('es-ES')} cables`, 4000);
    return true;
  } catch (e) { if (!silent) toast('No se pudo descargar la tabla CC: ' + e.message, 5000); return false; }
  finally { CCD.loading = false; if (typeof paintSrcSeg === 'function') paintSrcSeg(); }
}
const ccFind = code => { const c = norm(code).replace(/\.+$/, ''); return c && CCD.idx.has(c) ? CCD.idx.get(c) : -1; };
