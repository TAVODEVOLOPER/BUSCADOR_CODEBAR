/* Almacén: ENTRADA_ALM_BW (ingresos) y SALIDA_ALM_BW (salidas). Muestra el stock (entradas menos salidas) y los movimientos, con filtros por columna */
const ALM = { data: null, view: 'stock', q: '', lim: 150, sel: '', sf: '', loading: false, cfg: LS.get('almCfg', {}), cf: {} };
const ALM_RX = { code: /^(COD|CODIGO|CÓDIGO|ITEM|REF|REFERENCIA|SKU|PARTIDA|N[°ºO]?\s*DE?\s*PARTE|PART)/i, desc: /DESCRIP|MATERIAL|ARTICULO|ARTÍCULO|DETALLE|NOMBRE|EQUIPO|INSUMO/i, qty: /^(CANT|QTY)/i, unit: /^(UNID|UND|UM$|U\.?\s?M|UNIT)/i };
const almSheet = k => ALM.data && (k === 'in' ? ALM.data.entrada : ALM.data.salida);
function almDetect(sh, key) {   // índice de columna: lo elegido por el usuario o el detectado por el nombre
  const saved = ALM.cfg[key]; const cs = sh.cols;
  if (saved) { const i = cs.findIndex(c => c.name === saved); if (i >= 0) return i; }
  if (saved === '') return -1;
  return cs.findIndex(c => ALM_RX[key.split(':')[1]].test(c.name.trim()));
}
const almNum = v => { let s = String(v ?? '').replace(/\s/g, ''); if (!s) return 0; if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); else if (/,/.test(s) && /\./.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(',', '.'); const n = parseFloat(s); return isNaN(n) ? 0 : n; };
const almFmt = n => (Math.round(n * 1000) / 1000).toLocaleString('es-ES');
function almCols(sh, k) { return { code: almDetect(sh, k + ':code'), desc: almDetect(sh, k + ':desc'), qty: almDetect(sh, k + ':qty'), unit: almDetect(sh, k + ':unit') }; }
function almStock() {
  const d = ALM.data, m = new Map(), add = (sh, k, dir) => {
    if (!sh || !sh.cols.length) return; const c = almCols(sh, k);
    sh.rows.forEach(r => {
      const code = c.code >= 0 ? String(r[c.code]).trim() : '', desc = c.desc >= 0 ? String(r[c.desc]).trim() : '', key = norm(code || desc);
      if (!key) return;
      let o = m.get(key); if (!o) { o = { key, code, desc, unit: '', in: 0, out: 0, nIn: 0, nOut: 0 }; m.set(key, o); }
      if (!o.code && code) o.code = code; if (!o.desc && desc) o.desc = desc; if (!o.unit && c.unit >= 0) o.unit = String(r[c.unit]).trim();
      const q = c.qty >= 0 ? almNum(r[c.qty]) : 0; o[dir] += q; o[dir === 'in' ? 'nIn' : 'nOut']++;
    });
  };
  add(d.entrada, 'in', 'in'); add(d.salida, 'out', 'out');
  return [...m.values()].map(o => ({ ...o, stock: o.in - o.out })).sort((a, b) => (a.code || a.desc).localeCompare(b.code || b.desc, 'es', { numeric: true }));
}
const ALM_SCOLS = [{ name: 'Código' }, { name: 'Descripción' }, { name: 'Unidad' }, { name: 'Entradas' }, { name: 'Salidas' }, { name: 'Stock' }];
const almSrow = o => [o.code, o.desc, o.unit, almFmt(o.in), almFmt(o.out), almFmt(o.stock)];
function almCF(k) {
  if (!ALM.cf[k]) ALM.cf[k] = new ColFilter({ id: 'almcf' + k, esc, norm, columns: () => k === 'stock' ? ALM_SCOLS : almSheet(k).cols, rows: () => k === 'stock' ? almStockRows() : almSheet(k).rows, defCol: () => 0, onChange: () => { ALM.lim = 150; almBody(); } });
  return ALM.cf[k];
}
let almSR = null;
const almStockRows = () => (almSR = almSR || almStock().map(almSrow));
async function loadAlm() { const d = await DB.get('meta', 'alm').catch(() => null); if (d && d.entrada) { ALM.data = d; almSR = null; } }
async function pullAlm(silent) {
  if (!cloud.on() || ALM.loading) return;
  ALM.loading = true; renderAlm();
  try {
    const j = await apiGet('almacen', ALM.data && ALM.data.hash ? { hash: ALM.data.hash } : {});
    if (!j.same) { ALM.data = j; almSR = null; await DB.put('meta', j, 'alm'); }
  } catch (e) { if (!silent) toast('No se pudo leer el almacén: ' + e.message, 5000); }
  finally { ALM.loading = false; renderAlm(); }
}
function renderAlm() {
  const root = $('#almacen'); if (!root) return;
  const d = ALM.data;
  if (!d) {
    root.innerHTML = `<div class="d-empty"><h2>Almacén sin descargar</h2><p>${cloud.on() ? (ALM.loading ? 'Descargando…' : 'Pulsa Actualizar cuando tengas cobertura. Después funciona sin conexión.') : 'Conecta tu Google para descargar las hojas ENTRADA_ALM_BW y SALIDA_ALM_BW.'}</p>${cloud.on() && !ALM.loading ? '<button class="btn primary" id="almPull">Descargar ahora</button>' : ''}</div>`; return;
  }
  if (!$('#almHead')) root.innerHTML = `<div id="almHead"></div><div id="almCF"></div><div id="almBody"></div>`;
  const miss = [d.entrada.falta ? 'ENTRADA_ALM_BW' : '', d.salida.falta ? 'SALIDA_ALM_BW' : ''].filter(Boolean);
  $('#almHead').innerHTML = `<div class="seg" id="almSeg"><button class="segbtn ${ALM.view === 'stock' ? 'active' : ''}" data-v="stock">En almacén</button><button class="segbtn ${ALM.view === 'in' ? 'active' : ''}" data-v="in">Entradas ${d.entrada.rows.length.toLocaleString('es-ES')}</button><button class="segbtn ${ALM.view === 'out' ? 'active' : ''}" data-v="out">Salidas ${d.salida.rows.length.toLocaleString('es-ES')}</button></div>
    ${miss.length ? `<p class="help">Falta la pestaña ${miss.join(' y ')} en tu Google Sheet.</p>` : ''}
    <label class="field"><span>Buscar</span><input id="almQ" type="search" autocomplete="off" value="${esc(ALM.q)}" placeholder="${ALM.view === 'stock' ? 'Código o descripción del material' : 'Texto en cualquier columna'}"></label>`;
  const host = $('#almCF'); const cf = almCF(ALM.view);
  if (host.dataset.v !== ALM.view) { host.innerHTML = ''; host.dataset.v = ALM.view; cf.mount(host); } else { cf.label(); cf.chips(); }
  $('#lbInfoAlm') && ($('#lbInfoAlm').textContent = d.generado ? 'Datos del ' + d.generado : '');
  almBody();
}
function almBody() {
  const d = ALM.data, el = $('#almBody'); if (!d || !el) return;
  const q = norm(ALM.q), cf = almCF(ALM.view), nrm = x => norm(x);
  if (ALM.view === 'stock') {
    let all = almStock();
    const cnt = { all: all.length, pos: all.filter(o => o.stock > 0).length, zero: all.filter(o => o.stock === 0).length, neg: all.filter(o => o.stock < 0).length };
    const hits = all.filter(o => (ALM.sf === '' || (ALM.sf === 'pos' ? o.stock > 0 : ALM.sf === 'zero' ? o.stock === 0 : o.stock < 0)) && cf.test(almSrow(o)) && cf.matches(almSrow(o), q, nrm));
    const c = almCols(d.entrada, 'in'), setup = d.entrada.cols.length ? c : null;
    el.innerHTML = `<div class="filters" id="almChips"><button class="filter ${ALM.sf === '' ? 'on' : ''}" data-sf="">Todos ${cnt.all}</button><button class="filter ${ALM.sf === 'pos' ? 'on' : ''}" data-sf="pos">Con stock ${cnt.pos}</button><button class="filter ${ALM.sf === 'zero' ? 'on' : ''}" data-sf="zero">Agotados ${cnt.zero}</button><button class="filter ${ALM.sf === 'neg' ? 'on' : ''}" data-sf="neg" title="Salió más de lo que entró">Negativos ${cnt.neg}</button></div>
      <div class="btn-row"><button class="btn small" id="almXlsx">Descargar Excel</button><button class="btn small" id="almPull">Actualizar</button></div>
      <p class="help">${hits.length.toLocaleString('es-ES')} materiales. Stock = entradas menos salidas por código${c.code < 0 ? ' (no hallé una columna de código: uso la descripción)' : ''}. ${c.qty < 0 ? '<b>No encuentro la columna de cantidad: elígela abajo.</b>' : ''}</p>
      <div class="table-wrap"><table class="alm-t"><thead><tr><th>Código</th><th>Descripción</th><th>Un.</th><th class="num">Entradas</th><th class="num">Salidas</th><th class="num">Stock</th></tr></thead><tbody>${hits.slice(0, ALM.lim).map(o => `<tr data-k="${esc(o.key)}" class="${o.stock < 0 ? 'neg' : o.stock === 0 ? 'zero' : ''} ${ALM.sel === o.key ? 'sel' : ''}"><td><b>${esc(o.code)}</b></td><td>${esc(o.desc)}</td><td>${esc(o.unit)}</td><td class="num">${almFmt(o.in)}</td><td class="num">${almFmt(o.out)}</td><td class="num"><b>${almFmt(o.stock)}</b></td></tr>${ALM.sel === o.key ? `<tr class="alm-mov"><td colspan="6">${almMov(o)}</td></tr>` : ''}`).join('') || '<tr><td colspan="6" class="empty">Nada coincide.</td></tr>'}</tbody></table></div>
      ${hits.length > ALM.lim ? `<button class="btn more" id="almMore">Mostrar más (${(hits.length - ALM.lim).toLocaleString('es-ES')} restantes)</button>` : ''}
      ${almSetup()}`;
    return;
  }
  const sh = almSheet(ALM.view);
  if (!sh || !sh.cols.length) { el.innerHTML = `<p class="empty">La pestaña ${ALM.view === 'in' ? 'ENTRADA_ALM_BW' : 'SALIDA_ALM_BW'} no existe o está vacía.</p>`; return; }
  const hits = sh.rows.filter(r => cf.test(r) && cf.matches(r, q, nrm));
  const show = hits.slice(0, ALM.lim);
  el.innerHTML = `<div class="btn-row"><button class="btn small" id="almXlsx">Descargar Excel</button><button class="btn small" id="almPull">Actualizar</button></div><p class="help">${hits.length.toLocaleString('es-ES')} de ${sh.rows.length.toLocaleString('es-ES')} movimientos.</p>
    <div class="table-wrap"><table class="alm-t"><thead><tr>${sh.cols.map(c => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${show.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${sh.cols.length}" class="empty">Nada coincide.</td></tr>`}</tbody></table></div>
    ${hits.length > ALM.lim ? `<button class="btn more" id="almMore">Mostrar más (${(hits.length - ALM.lim).toLocaleString('es-ES')} restantes)</button>` : ''}`;
}
function almMov(o) {   // movimientos de un material
  const part = (sh, k, tit) => {
    if (!sh || !sh.cols.length) return '';
    const c = almCols(sh, k), rows = sh.rows.filter(r => norm((c.code >= 0 ? String(r[c.code]).trim() : '') || (c.desc >= 0 ? String(r[c.desc]).trim() : '')) === o.key);
    return rows.length ? `<h4 class="h4">${tit} (${rows.length})</h4><div class="table-wrap"><table class="alm-t"><thead><tr>${sh.cols.map(x => `<th>${esc(x.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
  };
  return part(ALM.data.entrada, 'in', 'Entradas') + part(ALM.data.salida, 'out', 'Salidas') || '<p class="empty">Sin movimientos.</p>';
}
function almSetup() {   // qué columnas son código, descripción, cantidad y unidad, por si el nombre no se reconoce
  const opt = (sh, k, kind) => { const cur = almDetect(sh, k + ':' + kind); return `<select data-alm-cfg="${k}:${kind}"><option value="">(ninguna)</option>${sh.cols.map((c, i) => `<option ${i === cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`; };
  const blk = (sh, k, tit) => sh && sh.cols.length ? `<fieldset><legend>${tit}</legend>${[['code', 'Código'], ['desc', 'Descripción'], ['qty', 'Cantidad'], ['unit', 'Unidad']].map(([kind, l]) => `<label class="field"><span>${l}</span>${opt(sh, k, kind)}</label>`).join('')}</fieldset>` : '';
  return `<details class="cx-pick" id="almSetup"><summary>Columnas del stock <small class="muted">código, descripción, cantidad y unidad</small></summary><div class="alm-cfg">${blk(ALM.data.entrada, 'in', 'En ENTRADA_ALM_BW')}${blk(ALM.data.salida, 'out', 'En SALIDA_ALM_BW')}</div></details>`;
}
async function almXlsx() {
  const sh = ALM.view === 'stock' ? { cols: ALM_SCOLS, rows: null } : almSheet(ALM.view), q = norm(ALM.q), cf = almCF(ALM.view);
  const rows = ALM.view === 'stock' ? almStock().filter(o => (ALM.sf === '' || (ALM.sf === 'pos' ? o.stock > 0 : ALM.sf === 'zero' ? o.stock === 0 : o.stock < 0)) && cf.test(almSrow(o)) && cf.matches(almSrow(o), q, norm)).map(o => [o.code, o.desc, o.unit, o.in, o.out, o.stock]) : sh.rows.filter(r => cf.test(r) && cf.matches(r, q, norm));
  const ws = XLSX.utils.aoa_to_sheet([sh.cols.map(c => c.name), ...rows]), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, ALM.view === 'stock' ? 'STOCK' : ALM.view === 'in' ? 'ENTRADAS' : 'SALIDAS'); XLSX.writeFile(wb, `almacen_${ALM.view}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
$('#almacen').addEventListener('click', e => {
  const t = e.target.closest('button,tr[data-k]'); if (!t) return;
  if (t.dataset.v) { ALM.view = t.dataset.v; ALM.lim = 150; ALM.sel = ''; renderAlm(); }
  else if (t.dataset.sf !== undefined) { ALM.sf = t.dataset.sf; ALM.lim = 150; almBody(); }
  else if (t.id === 'almMore') { ALM.lim += 200; almBody(); }
  else if (t.id === 'almPull') pullAlm(false);
  else if (t.id === 'almXlsx') almXlsx();
  else if (t.dataset.k !== undefined) { ALM.sel = ALM.sel === t.dataset.k ? '' : t.dataset.k; almBody(); }
});
$('#almacen').addEventListener('input', e => { if (e.target.id === 'almQ') { ALM.q = e.target.value; ALM.lim = 150; almBody(); } });
$('#almacen').addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.almCfg; if (!k) return;
  ALM.cfg[k] = e.target.value; LS.set('almCfg', ALM.cfg); almSR = null; almBody(); const s = $('#almSetup'); if (s) s.open = true;
});
loadAlm().then(() => { if ($('#tab-almacen') && $('#tab-almacen').classList.contains('active')) renderAlm(); });
const almOnOpen = () => { renderAlm(); if (cloud.on() && navigator.onLine) pullAlm(true); };
