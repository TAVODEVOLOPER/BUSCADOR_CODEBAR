/* Sistema CONEXIONADO: se alimenta de la pestaña CONEXIONADO del Sheet.
   Las columnas con cabecera verde son editables; el resto viene con fórmulas y solo se lee.
   Filas y columnas se leen tal cual están, así que la tabla puede crecer sin tocar la app.
   Las ediciones se guardan en el teléfono, se suben solas (aunque no haya cobertura) y quedan en el historial. */
let cxFields = LS.get('cxFields', null);   // null = mostrar todos los campos en la ficha
let cxPickOpen = false;
const CX = { data: null, ci: new Map(), ti: 0, idx: new Map(), hay: [], q: [], qText: '', st: '', lim: 120, sel: '', draft: {}, pulling: false, src: 'sheet', who: '', pmap: new Map(), av: '', unlock: new Set(), list: [], newKey: '', newIdx: [], newHay: [] };

const cxStCls = s => { s = String(s || '').toUpperCase(); return s === 'IMPUTADO' ? 'st-ok' : (s === 'FALTA' || s === 'NO ENCONTRADO') ? 'st-bad' : (s === '' || s === 'REASIGNADO') ? 'st-na' : 'st-warn'; };
const cxToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const cxCol = n => CX.ci.get(n);
const cxCan = () => typeof canConex === 'function' && canConex();
const cxAdm = () => typeof cloud !== 'undefined' && cloud.admin && cloud.admin();
const cxIsWeek = n => /SEM|WEEK/i.test(n);
const cxGrp = c => /^OBSERV/i.test(c.name) ? '' : String(c.group || '').toUpperCase().trim();
/* una punta (FROM / TO) con STATUS IMPUTADO queda bloqueada para todos. Solo un administrador la puede desbloquear a propósito */
const cxStatCol = g => CX.data.cols.findIndex(c => nname(c.name) === 'STATUS' + g);
function cxLocked(g, r) { if (g !== 'FROM' && g !== 'TO') return false; const si = cxStatCol(g); return si >= 0 && String(r[si] || '').trim().toUpperCase() === 'IMPUTADO'; }
const cxUnl = (tag, g) => cxAdm() && CX.unlock.has(norm(tag) + '|' + g);
const cxLockOn = (tag, g, r) => cxLocked(g, r) && !cxUnl(tag, g);
function cxWeekNum(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return ''; const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), dn = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dn); return String(Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7)); }

function setCx(d) {
  CX.data = d;
  CX.ci = new Map(d.cols.map((c, i) => [c.name, i]));
  CX.ti = CX.ci.get('CABLE_NUMBER');
  CX.idx = new Map();
  d.rows.forEach((r, i) => CX.idx.set(norm(r[CX.ti]), i));
  cxApplyQueue();
  CX.hay = d.rows.map(r => r.join(' ').toLowerCase());
}
/* Avances de campo pendientes de imputar: se ven encima de la tabla, pero NO se escriben en la hoja CONEXIONADO */
function cxBuildPend() {
  const pm = new Map(), put = (cable, col, from, to, who, date, id) => {
    const k = norm(cable); let o = pm.get(k); if (!o) { o = new Map(); pm.set(k, o); }
    const e = o.get(col); if (e) { e.to = to; e.who = who; e.date = date; if (id) e.ids.push(id); } else o.set(col, { from, to, who, date, ids: id ? [id] : [] });
  };
  if (CX.data) (CX.data.log || []).forEach(e => { if (e[6] === 'Pendiente') put(e[1], e[2], e[3], e[4], e[5], e[0], e[7]); });
  CX.q.filter(x => !x.synced).forEach(x => Object.entries(x.changes).forEach(([c, v]) => put(x.cable, c, (x.before || {})[c] || '', v, x.author, x.date.slice(0, 16).replace('T', ' '), '')));
  CX.pmap = pm; return pm;
}
function cxApplyQueue() {
  const pm = cxBuildPend();
  pm.forEach((o, k) => { const i = CX.idx.get(k); if (i === undefined) return; o.forEach((e, col) => { const ci = CX.ci.get(col); if (ci !== undefined) CX.data.rows[i][ci] = e.to; }); });
}
async function loadCx() {
  CX.q = (await DB.get('meta', 'conexQ').catch(() => null)) || [];
  const d = await DB.get('meta', 'conex').catch(() => null);
  if (d && d.cols) setCx(d);
  cxRepaint();
}
async function pullCx(silent) {
  if (!cloud.on()) return false;
  CX.pulling = true;
  try {
    const j = await apiGet('conex', CX.data && CX.data.hash ? { hash: CX.data.hash } : {});
    if (j.none) { CX.none = true; return true; }
    if (j.same) return true;
    await DB.put('meta', j, 'conex');
    setCx(j); cxRepaint(); if (typeof avCheck === 'function') avCheck();
    return true;
  } catch (e) {
    if (!silent) toast('No se pudo leer el conexionado: ' + e.message, 5000);
    return false;
  } finally { CX.pulling = false; }
}
/* sube las ediciones pendientes (en orden) y trae lo de los demás */
async function cxSync(force) {
  if (!cloud.on() || !navigator.onLine || cxSync.busy) return;
  cxSync.busy = true;
  try {
    for (const it of CX.q.filter(x => !x.synced)) {
      try { await apiPost('setConex', { id: it.id, cable: it.cable, changes: it.changes, author: cloud.author() }); it.synced = true; }
      catch (e) {
        if (/permiso|no está en|no se puede editar|no válido|Falta|administrador|IMPUTADA/.test(e.message)) { it.synced = true; toast(`No se pudo guardar ${it.cable}: ${e.message}`, 6000); }
        else throw e;   // sin cobertura: se reintenta luego
      }
    }
    const had = CX.q.length; CX.q = CX.q.filter(x => !x.synced); if (had !== CX.q.length) await DB.put('meta', CX.q, 'conexQ');
    if (force || had !== CX.q.length || $('#app').dataset.mod === 'con' || !CX.data) await pullCx(true);
  } catch { /* sin cobertura */ }
  finally { cxSync.busy = false; if (CX.data) cxRepaint(); }
}
const cxPending = () => CX.q.filter(x => !x.synced).length;

async function cxSave(tag, changes) {
  const i = CX.idx.get(norm(tag)); if (i === undefined) return;
  const before = {}; for (const k of Object.keys(changes)) before[k] = CX.data.rows[i][CX.ci.get(k)] || '';
  const it = { id: newUid(), cable: tag, changes, before, date: new Date().toISOString(), author: cloud.author(), synced: false };
  CX.q.push(it); await DB.put('meta', CX.q, 'conexQ');
  for (const [k, v] of Object.entries(changes)) CX.data.rows[i][CX.ci.get(k)] = v;
  CX.hay[i] = CX.data.rows[i].join(' ').toLowerCase(); CX.draft = {}; cxBuildPend();
  cxRepaint(); toast('Cambios guardados' + (cloud.on() && !navigator.onLine ? ' en este dispositivo. Sin cobertura: se subirán solos' : ''));
  cxSync(true);
}
const cxHas = tag => !!CX.data && CX.idx.has(norm(tag));

/* ---------- Buscar ---------- */
function cxSides(r) {
  const f = cxCol('STATUS_FROM'), t = cxCol('STATUS_TO');
  return [f !== undefined ? r[f] : '', t !== undefined ? r[t] : ''];
}
const cxAv = r => { const [a, b] = cxSides(r); return ((String(a).toUpperCase() === 'IMPUTADO') + (String(b).toUpperCase() === 'IMPUTADO')) * 50; };
CX.cf = new ColFilter({ id: 'cxcf', esc, norm: x => String(x).toLowerCase(), columns: () => CX.data.cols, rows: () => CX.data.rows, defCol: () => cxCol('STATUS_FROM') ?? 0, onChange: () => { CX.lim = 120; renderCxSearch(); } });
function cxHits() {
  const q = CX.qText.trim().toLowerCase(), out = [];
  CX.data.rows.forEach((r, i) => {
    if (CX.st) { const [a, b] = cxSides(r); if (CX.st === '(sin status)' ? (a || b) : (a !== CX.st && b !== CX.st)) return; }
    if (CX.av !== '' && String(cxAv(r)) !== CX.av) return;
    if (CX.src === 'pend' && !CX.pmap.has(norm(r[CX.ti]))) return;
    if (!CX.cf.test(r)) return;
    if (q && !(CX.cf.sc ? CX.cf.matches(r, q, x => String(x).toLowerCase()) : q.split(/\s+/).every(w => CX.hay[i].includes(w)))) return;
    if (CX.src === 'pend' && CX.who) { const o = CX.pmap.get(norm(r[CX.ti])); if (![...o.values()].some(e => e.who === CX.who)) return; }
    out.push(i);
  });
  return out;
}
/* cables del CC_SCHEDULE (de tu disciplina) que todavía no tienen fila en CONEXIONADO */
function cxNewBase() {
  if (typeof CCD === 'undefined' || !CCD.src) return null;
  const key = [CCD.data && CCD.data.hash, typeof SC !== 'undefined' && SC.hash, CX.data && CX.data.hash, CX.data && CX.data.rows.length].join('|');
  if (CX.newKey !== key) {
    const ti = CCD.src.tagi, ci = n => CCD.src.columns.findIndex(c => nname(c.name) === n), cols = ['CABLENUMBER', 'FROMTAG', 'TOTAG', 'FROMAREA', 'TOAREA', 'SYSTEM', 'FROMDESCRIPTION', 'TODESCRIPTION'].map(ci).filter(k => k >= 0);
    CX.newIdx = []; CX.newHay = [];
    CCD.src.rows.forEach((r, i) => {
      const k = norm(r[ti]); if (!k || CX.idx.has(k)) return;
      if (typeof SC !== 'undefined' && SC.tags && !SC.tags.has(k)) return;
      CX.newIdx.push(i); CX.newHay.push(cols.map(c => r[c]).join(' ').toLowerCase());
    });
    CX.newKey = key;
  }
  return CX.newIdx;
}
function cxNewHits() {
  const q = CX.qText.trim().toLowerCase(), out = [], base = cxNewBase(); if (!base) return null;
  base.forEach((ri, n) => { if (!q || q.split(/\s+/).every(w => CX.newHay[n].includes(w))) out.push(ri); });
  return out;
}
const cxInList = tag => CX.list.some(x => norm(x.tag) === norm(tag));
function cxAddBtn() { const b = $('#vAddList'); if (b && $('#app').dataset.mod === 'con') b.textContent = CX.sel && cxInList(CX.sel) ? 'En la lista' : 'Añadir a la lista'; }
function renderCxSearch() {
  const root = $('#cxSearch'); if (!root) return;
  if (!CX.data) {
    $('#cxInfo').textContent = '';
    root.innerHTML = `<div class="d-empty"><h2>${CX.none ? 'No hay datos de conexionado' : 'Conexionado sin descargar'}</h2><p>${CX.none ? 'Falta la pestaña CONEXIONADO en tu Google Sheet.' : cloud.on() ? 'Pulsa Actualizar cuando tengas cobertura. Después funciona sin conexión.' : 'Conecta tu Google para descargar el conexionado.'}</p>${cloud.on() ? '<button class="btn primary" id="cxPull">Descargar ahora</button>' : ''}</div>`;
    return;
  }
  const d = CX.data, isNew = CX.src === 'new', pend = cxPending();
  const nb = cxNewBase(), nNew = nb ? nb.length : 0;
  if (!$('#cxQ')) {
    root.innerHTML = `<div class="filters cx-srcs" id="cxSrcs"></div>
      <label class="field"><span id="cxQLbl">Buscar cable, tag, área u observación</span><input id="cxQ" type="search" placeholder="Parte del tag, por ejemplo CKA32-BR03" autocomplete="off" value="${esc(CX.qText)}"></label>
      <div id="cxCF"></div>
      <div class="filters" id="cxChips"></div><div class="cx-pendbar" id="cxPendBar" hidden></div><div class="sfbar"><button class="filter add" id="cxAddAll" type="button" hidden></button></div><p class="help" id="cxCount"></p><div id="cxRes" class="rows"></div>`;
  }
  const nPend = CX.pmap.size, isPend = CX.src === 'pend';
  if (!$('#cxCF').firstChild) CX.cf.mount($('#cxCF'));
  $('#cxCF').hidden = isNew; if (!isNew) { CX.cf.label(); CX.cf.chips(); }
  $('#cxSrcs').innerHTML = `<button class="filter ${isNew || isPend ? '' : 'on'}" data-cxsrc="sheet">Hoja CONEXIONADO</button><button class="filter ${isPend ? 'on' : ''}" data-cxsrc="pend" title="Avances de campo que faltan por pasar al sistema externo">Por imputar ${nPend}</button><button class="filter ${isNew ? 'on' : ''}" data-cxsrc="new">Nuevos del CC_SCHEDULE${nb ? ' ' + nNew.toLocaleString('es-ES') : ''}</button>`;
  $('#cxQLbl').textContent = isNew ? 'Buscar cable nuevo por tag, área o sistema' : 'Buscar cable, tag, área u observación';
  const addAll = $('#cxAddAll');
  if (isNew) {
    $('#cxInfo').textContent = nb ? `${nNew.toLocaleString('es-ES')} cables nuevos` : '';
    $('#cxChips').innerHTML = ''; $('#cxPendBar').hidden = true;
    const hits = cxNewHits();
    if (!hits) { $('#cxCount').textContent = ''; addAll.hidden = true; $('#cxRes').innerHTML = `<div class="d-empty"><h2>Falta la tabla del CC_SCHEDULE</h2><p>${cloud.on() ? 'Descárgala una vez con cobertura y después funciona sin conexión.' : 'Conecta tu Google para descargarla.'}</p>${cloud.on() ? '<button class="btn primary" id="cxPullCC">Descargar CC_SCHEDULE</button>' : ''}</div>`; return; }
    const shown = hits.slice(0, CX.lim), S = CCD.src, ci = n => S.columns.findIndex(c => nname(c.name) === n), ft = ci('FROMTAG'), tt = ci('TOTAG'), st = ci('CURRENTSTATUS');
    $('#cxCount').textContent = `${hits.length.toLocaleString('es-ES')} de ${nNew.toLocaleString('es-ES')}. Son cables de tu disciplina sin fila en CONEXIONADO: al añadirlos a la lista se les ponen los datos que tienen en el CC_SCHEDULE.`;
    addAll.hidden = !hits.length || !CX.qText.trim(); addAll.textContent = `Añadir los ${hits.length.toLocaleString('es-ES')} a la lista`;
    $('#cxRes').innerHTML = shown.map(ri => {
      const row = S.rows[ri], tag = row[S.tagi], on = cxInList(tag);
      const sub = ft >= 0 && tt >= 0 ? `${String(row[ft] || '?').replace(/^#HKF\./, '')} → ${String(row[tt] || '?').replace(/^#HKF\./, '')}` : '';
      return `<button class="row st-warn ${on ? 'sel' : ''}" data-cx-addnew="${esc(tag)}"><span class="t">${esc(tag)}</span><span class="m"><span class="cx-pill st-na">Nuevo</span>${st >= 0 && row[st] ? `<span class="cx-pill st-na">${esc(row[st])}</span>` : ''}<span class="cx-pill ${on ? 'st-ok' : 'st-warn'}">${on ? 'En la lista' : 'Añadir'}</span></span>${sub ? `<span class="m"><span>${esc(sub)}</span></span>` : ''}</button>`;
    }).join('') || '<p class="empty">Ningún cable nuevo coincide.</p>';
    if (hits.length > shown.length) $('#cxRes').insertAdjacentHTML('beforeend', `<button class="btn more" id="cxMore">Mostrar más (${(hits.length - shown.length).toLocaleString('es-ES')} restantes)</button>`);
    return;
  }
  const hits = cxHits(), shown = hits.slice(0, CX.lim);
  cxPendBar(hits, isPend);
  const counts = new Map(); d.rows.forEach(r => { const [a, b] = cxSides(r); new Set([a || '(sin status)', b || '(sin status)']).forEach(s => counts.set(s, (counts.get(s) || 0) + 1)); });
  const ests = [...new Set([...(d.estados || []), ...counts.keys()])].filter(s => counts.has(s));
  const av = { 0: 0, 50: 0, 100: 0 }; d.rows.forEach(r => { av[cxAv(r)]++; });
  $('#cxInfo').textContent = `${d.rows.length.toLocaleString('es-ES')} cables`;
  $('#cxChips').innerHTML = `<button class="filter ${CX.st === '' && CX.av === '' ? 'on' : ''}" data-st="" data-av="">Todos ${d.rows.length}</button>`
    + [['0', '0 %', 'ninguna punta'], ['50', '50 %', 'una punta'], ['100', '100 %', 'las dos puntas']].map(([k, n, t]) => `<button class="filter ${CX.av === k ? 'on' : ''}" data-av="${k}" title="${t} imputada">${n} ${av[k]}</button>`).join('')
    + ests.map(s => `<button class="filter ${CX.st === s ? 'on' : ''}" data-st="${esc(s)}">${esc(s === '(sin status)' ? 'Sin status' : sentence(s))} ${counts.get(s)}</button>`).join('');
  $('#cxCount').textContent = `${hits.length.toLocaleString('es-ES')} de ${d.rows.length.toLocaleString('es-ES')}${pend ? ` · ${pend} cambio${pend > 1 ? 's' : ''} por subir` : ''}`;
  addAll.hidden = !hits.length || !(CX.st || CX.av !== '' || CX.qText.trim() || CX.cf.active() || CX.src === 'pend'); addAll.textContent = `Añadir los ${hits.length.toLocaleString('es-ES')} a la lista`;
  $('#cxRes').innerHTML = shown.map(i => {
    const r = d.rows[i], [a, b] = cxSides(r), tag = r[CX.ti];
    const cls = (a === 'IMPUTADO' && b === 'IMPUTADO') ? 'st-ok' : [a, b].some(x => cxStCls(x) === 'st-bad') ? 'st-bad' : 'st-warn';
    const ft = cxCol('From_Tag'), tt = cxCol('To_Tag');
    const sub = ft !== undefined && tt !== undefined ? `${String(r[ft] || '?').replace(/^#HKF\./, '')} → ${String(r[tt] || '?').replace(/^#HKF\./, '')}` : '';
    return `<button class="row ${cls} ${norm(tag) === norm(CX.sel) ? 'sel' : ''}" data-cx-open="${esc(tag)}"><span class="t">${esc(tag)}</span>
      <span class="m">${CX.pmap.has(norm(tag)) ? '<span class="cx-pill st-warn">Por imputar</span>' : ''}<span class="cx-pill ${cxStCls(a)}">De: ${esc(a ? sentence(a) : 'sin status')}</span><span class="cx-pill ${cxStCls(b)}">A: ${esc(b ? sentence(b) : 'sin status')}</span>${cxInList(tag) ? '<span class="cx-pill st-ok">En la lista</span>' : ''}</span>${sub ? `<span class="m"><span>${esc(sub)}</span></span>` : ''}</button>`;
  }).join('') || '<p class="empty">Ningún cable coincide. Prueba con otra parte del texto o quita el filtro.</p>';
  if (hits.length > shown.length) $('#cxRes').insertAdjacentHTML('beforeend', `<button class="btn more" id="cxMore">Mostrar más (${(hits.length - shown.length).toLocaleString('es-ES')} restantes)</button>`);
}

/* ---------- Ficha ---------- */
function openCx(tag) {
  if (!CX.data || !cxHas(tag)) return;
  CX.sel = tag; CX.draft = {}; CX.unlock.clear(); current = -1; curSched = -1;
  $('#view').classList.add('open'); $('#vAddList').hidden = false; cxAddBtn();
  if (typeof cam !== 'undefined') cam.paused = !isWide();
  if (!isWide() && !(history.state && history.state.detail)) history.pushState({ detail: 1 }, '');
  renderCx();
  renderCxSearch();
}
function cxEmpty() { CX.sel = ''; $('#vBody').innerHTML = '<div class="d-empty"><h2>Ningún cable abierto</h2><p>Busca un cable y aquí verás sus datos de conexionado y podrás editar los campos verdes.</p></div>'; $('#vAddList').hidden = true; }
function cxHistory(tag) {
  const k = norm(tag), out = [];
  (CX.data.log || []).forEach(e => { if (norm(e[1]) === k) out.push({ date: e[0], col: e[2], from: e[3], to: e[4], who: e[5], est: e[6] || '', id: e[7] || '' }); });
  CX.q.filter(x => !x.synced && norm(x.cable) === k).forEach(x => Object.entries(x.changes).forEach(([c, v]) => out.push({ date: x.date.slice(0, 16).replace('T', ' '), col: c, from: (x.before || {})[c] || '', to: v, who: x.author, pend: true, qid: x.id })));
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
/* STATUS_FROM y STATUS_TO usan la lista del Sheet; otros STATUS (por ejemplo STATUS_CONEX) usan los valores que ya tiene su columna */
function cxOptions(name) {
  if (/^STATUS_(FROM|TO)$/i.test(name)) return CX.data.estados || [];
  const ci = cxCol(name); return [...new Set(CX.data.rows.map(r => r[ci]).filter(Boolean))].sort();
}
function cxInput(c, v, can, keep) {
  const val = CX.draft[c.name] !== undefined ? CX.draft[c.name] : v;
  if (!c.edit || !can) return `<span class="v ${v ? '' : 'none'}">${v ? esc(fmtVal(v)) : 'Sin dato'}</span>`;
  const id = 'cxf_' + c.name;
  if (/^STATUS/i.test(c.name)) return `<div class="chips cx-opts" data-f="${esc(c.name)}">${[...(keep && !cxAdm() ? [] : ['']), ...cxOptions(c.name)].map(s => `<button type="button" class="filter ${val === s ? 'on' : ''}" data-cx-set="${esc(s)}">${s ? esc(sentence(s)) : 'Vacío'}</button>`).join('')}</div>`;
  if (/^FECHA/i.test(c.name)) return `<input id="${id}" data-f="${esc(c.name)}" type="date" value="${esc(val)}">`;
  if (/OBSERV/i.test(c.name)) return `<textarea id="${id}" data-f="${esc(c.name)}" rows="3">${esc(val)}</textarea>`;
  return `<input id="${id}" data-f="${esc(c.name)}" type="text" inputmode="text" value="${esc(val)}" autocomplete="off">`;
}
function renderCx(keepFocus) {
  if (!CX.data || !CX.sel) return;
  const d = CX.data, i = CX.idx.get(norm(CX.sel)); if (i === undefined) return cxEmpty();
  const r = d.rows[i], tag = r[CX.ti], can = cxCan(), dirty = Object.keys(CX.draft).length;
  const groups = []; const gmap = new Map();
  d.cols.forEach((c, ci) => {
    if (ci === CX.ti) return;
    if (Array.isArray(cxFields) && !cxFields.includes(c.name)) return;
    const g = /^OBSERV/i.test(c.name) ? '' : (c.group || '');
    if (!gmap.has(g)) { const o = { g, cols: [] }; gmap.set(g, o); groups.push(o); }
    gmap.get(g).cols.push([c, ci]);
  });
  const cxEd = (c, r) => c.edit && can && !cxIsWeek(c.name) && !cxLockOn(tag, cxGrp(c), r);
  groups.forEach(o => o.cols.sort((p, q) => cxEd(q[0], r) - cxEd(p[0], r)));   // primero lo editable
  groups.sort((a, b) => (a.g === '') - (b.g === ''));
  const gname = g => g === 'FROM' ? 'Origen (From)' : g === 'TO' ? 'Destino (To)' : g ? g : 'General';
  const card = o => `<section class="cx-card ${o.g === 'FROM' ? 'from' : o.g === 'TO' ? 'to' : ''}"><h3>${esc(gname(o.g))}${cxLocked(String(o.g).toUpperCase(), r) ? (cxUnl(tag, String(o.g).toUpperCase()) ? ' <small class="muted">imputado, desbloqueado por administrador</small>' : ' <small class="muted">imputado, bloqueado</small>' + (cxAdm() ? ` <button type="button" class="btn small quiet" data-cx-unlock="${esc(String(o.g).toUpperCase())}">Desbloquear</button>` : '')) : ''}</h3>${o.cols.map(([c, ci]) => {
    const label = `<span class="n">${esc(c.name.replace(/_/g, ' '))}</span>`;
    const g = cxGrp(c), lock = cxLockOn(tag, g, r);
    if (cxIsWeek(c.name)) {   // la semana se calcula sola desde la fecha del mismo lado
      const fc = d.cols.findIndex(z => /^FECHA_/i.test(z.name) && cxGrp(z) === g), dv = fc >= 0 ? (CX.draft[d.cols[fc].name] !== undefined ? CX.draft[d.cols[fc].name] : r[fc]) : '', wv = cxWeekNum(dv) || r[ci];
      return `<div class="kv"><span class="l">${esc(c.letter)}</span>${label}<span class="v ${wv ? '' : 'none'}">${wv ? esc(wv) + ' <small class="muted">automática</small>' : 'Sin dato'}</span></div>`;
    }
    const filled = String(CX.draft[c.name] !== undefined ? CX.draft[c.name] : (r[ci] == null ? '' : r[ci])).trim() !== '';
    return c.edit && can && !lock ? `<div class="cx-f ed ${filled ? 'done' : 'todo'}"><label>${label}<i class="cx-dot" title="${filled ? 'Campo editable, ya llenado' : 'Campo editable por llenar'}"></i></label>${cxInput(c, r[ci], can, !!r[ci])}</div>`
      : `<div class="kv"><span class="l">${esc(c.letter)}</span>${label}${cxInput(c, r[ci], false)}</div>`;
  }).join('')}</section>`;
  const hist = cxHistory(tag);
  const inCab = typeof IDX !== 'undefined' && DATA && IDX.has(norm(tag));
  $('#vBody').innerHTML = `
    <div class="d-top"><div class="marker"><span class="sleeve"></span><span class="mk-body"><b>${esc(tag)}</b></span><button class="btn small quiet copy" id="cxCopy">Copiar</button></div></div>
    ${cxPendFicha(tag)}
    ${cxPickHtml(d)}
    ${can ? '' : '<p class="help">Tu código solo permite leer el conexionado.</p>'}
    ${can ? '<p class="cx-key"><i class="cx-dot"></i> por llenar en campo <i class="cx-dot on"></i> ya llenado</p>' : ''}
    <div class="cx-sides">${groups.map(card).join('')}</div>
    ${can ? `<div class="cx-save"><button class="btn primary" id="cxSaveBtn" ${dirty ? '' : 'disabled'}>Guardar cambios${dirty ? ` (${dirty})` : ''}</button><button class="btn" id="cxDiscard" ${dirty ? '' : 'disabled'}>Descartar</button><span class="muted">Se guarda con tu nombre y la fecha.</span></div>` : ''}
    ${inCab ? '<div class="btn-row"><button class="btn" id="cxToCab">Abrir en Cableado</button></div>' : ''}
    <section class="cx-hist"><h3>Historial de cambios <small class="muted">${hist.length}</small></h3>
      <p class="help">Los cambios se guardan en la hoja CONEXIONADO_LOG de tu Google Sheet, con fecha y nombre. ${cxAdm() ? 'Como administrador puedes deshacer cada cambio.' : 'Solo el administrador puede deshacer cambios.'}</p>
      ${hist.map(h => `<div class="fs-row"><div><div><b>${esc(h.col.replace(/_/g, ' '))}</b>: ${h.from ? esc(fmtVal(h.from)) : '<i>vacío</i>'} → ${h.to ? esc(fmtVal(h.to)) : '<i>vacío</i>'}</div><small>${esc(h.date)}${h.who ? ', ' + esc(h.who) : ''}${h.pend ? ' <span class="sync wait">Pendiente de subir</span>' : h.est === 'Pendiente' ? ' <span class="sync wait">Por imputar</span>' : h.est === 'Imputado' ? ' <span class="sync ok">Imputado</span>' : h.est === 'Descartado' ? ' <span class="sync">Descartado</span>' : ''}</small></div>${cxUndoBtn(h, can)}</div>`).join('') || '<p class="empty">Todavía no hay cambios hechos desde la app.</p>'}
    </section>`;
}

/* barra de avances por imputar: PDF para el sistema externo y marcado como imputado (solo administrador) */
function cxPendBar(hits, on) {
  const b = $('#cxPendBar'); if (!b) return;
  if (!on) { b.hidden = true; return; }
  const ids = cxPendIds(hits);
  b.hidden = false;
  b.innerHTML = `<p class="help">Avances reportados en campo que aún faltan por pasar al sistema externo. No modifican la hoja CONEXIONADO.</p>
    ${cxWhoSel()}
    <div class="btn-row"><button class="btn primary" id="cxPendPdf" ${hits.length ? '' : 'disabled'}>PDF de avances (${hits.length})</button>${cxAdm() ? `<button class="btn" id="cxPendDone" ${ids.length ? '' : 'disabled'}>Marcar los ${hits.length} como imputados</button>` : ''}</div>`;
}
function cxWhoSel() {
  const who = new Set(); CX.pmap.forEach(o => o.forEach(e => { if (e.who) who.add(e.who); }));
  return who.size > 1 || CX.who ? `<label class="field"><span>Quién lo reportó</span><select id="cxWho"><option value="">Todo el personal</option>${[...who].sort().map(w => `<option ${CX.who === w ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></label>` : '';
}
function cxPendIds(hits) { const out = []; hits.forEach(i => { const o = CX.pmap.get(norm(CX.data.rows[i][CX.ti])); if (o) o.forEach(e => out.push(...e.ids)); }); return out; }
async function cxMarcar(ids, estado) {
  if (!ids.length) return toast('Nada que marcar: espera a que los cambios suban');
  try { await apiPost('marcarAvances', { ids, estado, author: cloud.author() }); await pullCx(true); toast(estado === 'Descartado' ? 'Avances descartados' : 'Marcados como imputados'); }
  catch (e) { toast('No se pudo marcar: ' + e.message, 5000); }
}

/* ---------- elegir qué campos se ven en la ficha ---------- */
const cxMine = who => !!who && who === cloud.author();
function cxUndoBtn(h, can) {
  if (!can) return '';
  if (h.pend) return cxMine(h.who) || cxAdm() ? `<button class="btn small quiet" data-cx-qundo="${esc(h.qid)}" data-col="${esc(h.col)}">Deshacer</button>` : '';
  if (h.est === 'Pendiente' && h.id) return cxAdm() || cxMine(h.who) ? `<button class="btn small quiet" data-cx-undoid="${esc(h.id)}">Deshacer</button>` : '';
  return cxAdm() && cxCol(h.col) !== undefined && h.est !== 'Deshecho' && h.est !== 'Descartado' ? `<button class="btn small quiet" data-cx-undo="${esc(h.col)}" data-v="${esc(h.from)}">Deshacer</button>` : '';
}
async function cxUndoId(id) {
  try { await apiPost('undoAvance', { ids: [id], author: cloud.author() }); await pullCx(true); toast('Cambio deshecho'); }
  catch (e) { toast('No se pudo deshacer: ' + e.message, 5000); }
}
async function cxUndoQueued(qid, col) {   // todavía no subió: se quita del teléfono
  const it = CX.q.find(x => x.id === qid); if (!it) return;
  const i = CX.idx.get(norm(it.cable)), ci = CX.ci.get(col);
  if (i !== undefined && ci !== undefined) CX.data.rows[i][ci] = (it.before || {})[col] || '';
  delete it.changes[col]; if (!Object.keys(it.changes).length) CX.q = CX.q.filter(x => x !== it);
  await DB.put('meta', CX.q, 'conexQ'); cxBuildPend(); if (i !== undefined) CX.hay[i] = CX.data.rows[i].join(' ').toLowerCase(); cxRepaint(); toast('Cambio deshecho');
}
function cxPendFicha(tag) {
  const o = CX.pmap.get(norm(tag)); if (!o) return '';
  const ids = []; o.forEach(e => ids.push(...e.ids));
  return `<section class="cx-pendbox"><h3>Por imputar en el sistema externo</h3>
    ${[...o].map(([c, e]) => `<div class="fs-row"><div><b>${esc(c.replace(/_/g, ' '))}</b>: ${e.from ? esc(fmtVal(e.from)) : '<i>vacío</i>'} → <b>${e.to ? esc(fmtVal(e.to)) : '<i>vacío</i>'}</b><br><small>${esc(e.date)}${e.who ? ', ' + esc(e.who) : ''}</small></div></div>`).join('')}
    ${cxAdm() && ids.length ? `<div class="btn-row"><button class="btn primary" data-cx-mark="${esc(tag)}">Marcar como imputado</button><button class="btn quiet" data-cx-drop="${esc(tag)}">Descartar</button></div>` : ''}</section>`;
}
function cxPickHtml(d) {
  const sel = Array.isArray(cxFields) ? new Set(cxFields) : null, groups = new Map();
  d.cols.forEach((c, ci) => { if (ci === CX.ti) return; const g = /^OBSERV/i.test(c.name) ? 'General' : (c.group === 'FROM' ? 'Origen (From)' : c.group === 'TO' ? 'Destino (To)' : (c.group || 'General')); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); });
  const nShown = sel ? sel.size : d.cols.length - 1;
  return `<details class="cx-pick" id="cxPick" ${cxPickOpen ? 'open' : ''}><summary>Elegir campos <small class="muted">${nShown} de ${d.cols.length - 1}</small></summary>
    <div class="cx-pick-act"><button type="button" class="btn small quiet" data-cx-pk="all">Todos</button><button type="button" class="btn small quiet" data-cx-pk="ed">Solo los de campo</button><button type="button" class="btn small quiet" data-cx-pk="none">Ninguno</button></div>
    ${[...groups].map(([g, cs]) => `<fieldset><legend>${esc(g)}</legend>${cs.map(c => `<label class="cx-pk"><input type="checkbox" data-cx-fld="${esc(c.name)}" ${!sel || sel.has(c.name) ? 'checked' : ''}><span>${esc(c.name.replace(/_/g, ' '))}</span>${c.edit ? '<i class="cx-dot" title="Campo editable"></i>' : ''}</label>`).join('')}</fieldset>`).join('')}
  </details>`;
}
function cxSetFields(v) { cxFields = v; LS.set('cxFields', v); renderCx(); }

/* ---------- Resumen ---------- */
const CX_META = (typeof CFG !== 'undefined' && CFG.metaConexion) || 50;   // meta: puntas conectadas (FROM + TO) por semana
/* STATUS_CONEX = el cable está conectado en ambas puntas o no (cuenta cables, no extremos) */
function cxConexBlock(d, n, nRows, missing) {
  const ci = cxCol('STATUS_CONEX'); if (ci === undefined || !n) return '';
  const m = new Map(); d.rows.forEach(r => { const s = r[ci] || '(sin status)'; m.set(s, (m.get(s) || 0) + 1); });
  const list = [...m].sort((a, b) => b[1] - a[1]);
  if (missing) list.push(['(sin iniciar)', missing]);
  return `<p class="chart-t">Conexión del cable (ambas puntas)</p>
    <div class="cx-tab">
    ${list.map(([k, v]) => `<div class="cx-line"><span class="cx-lbl"><i class="cx-dotc ${cxStCls(k === '(sin status)' || k === '(sin iniciar)' ? '' : k)}"></i>${esc(k === '(sin status)' ? 'Sin status' : k === '(sin iniciar)' ? 'Sin iniciar (no está en CONEXIONADO)' : sentence(k))}</span><span class="cx-two"><span class="cx-side">${bar2(v, n, k === '(sin iniciar)' ? '(sin status)' : k)}<b>${v}</b> <small>${(v / n * 100).toFixed(0)}%</small></span></span></div>`).join('')}</div>`;
}
function bar2(v, n, k) { return `<div class="cx-bar"><span class="cx-seg ${k ? cxStCls(k === '(sin status)' ? '' : k) : ''}" style="--w:${n ? v / n * 100 : 0}%"></span></div>`; }

function renderCxStats() {
  const root = $('#cxStats'); if (!root) return;
  if (!CX.data) { $('#cxInfo2').textContent = ''; root.innerHTML = '<div class="d-empty"><h2>Sin datos de conexionado</h2><p>Descarga el conexionado desde la pestaña Buscar.</p></div>'; return; }
  const d = CX.data, nRows = d.rows.length, sf = cxCol('STATUS_FROM'), st = cxCol('STATUS_TO'), df = cxCol('FECHA_STATUS_FROM'), dt = cxCol('FECHA_STATUS_TO');
  const hasS = typeof SC !== 'undefined' && !!SC.tags && SC.total > 0;
  const inS = hasS ? d.rows.filter(r => SC.tags.has(norm(r[CX.ti]))).length : nRows;
  const n = hasS ? SC.total : nRows, missing = hasS ? Math.max(0, SC.total - inS) : 0;
  $('#cxInfo2').textContent = d.generado ? 'Datos del ' + d.generado : '';
  const cnt = (ci) => { const m = new Map(); d.rows.forEach(r => { const s = r[ci] || '(sin status)'; m.set(s, (m.get(s) || 0) + 1); }); return m; };
  const A = sf !== undefined ? cnt(sf) : new Map(), B = st !== undefined ? cnt(st) : new Map();
  const imp = (A.get('IMPUTADO') || 0) + (B.get('IMPUTADO') || 0), ext = n * 2, pct = ext ? imp / ext * 100 : 0;
  const both = d.rows.filter(r => r[sf] === 'IMPUTADO' && r[st] === 'IMPUTADO').length;
  const falta = (A.get('FALTA') || 0) + (B.get('FALTA') || 0), pen = [...A, ...B].filter(([k]) => /PENDING|POR IMPUTAR/.test(k)).reduce((s, [, v]) => s + v, 0);
  const all = [...new Set([...(d.estados || []), ...A.keys(), ...B.keys()])].filter(s => A.has(s) || B.has(s));
  const bar = (m, s) => `<div class="cx-bar"><span class="cx-seg ${cxStCls(s === '(sin status)' ? '' : s)}" style="--w:${n ? (m.get(s) || 0) / n * 100 : 0}%"></span></div>`;
  // puntas conectadas por semana (fecha de status): FROM + TO
  const ymd = t => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const isoWeek = s => { const t = new Date(s + 'T00:00:00'); if (isNaN(t)) return null; const y = new Date(t); y.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); const w1 = new Date(y.getFullYear(), 0, 4); return { y: y.getFullYear(), w: 1 + Math.round(((y - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7) }; };
  const wk = new Map(), dates = [];
  d.rows.forEach(r => { [[sf, df], [st, dt]].forEach(([a, b]) => { if (a !== undefined && b !== undefined && String(r[a]).toUpperCase() === 'IMPUTADO' && r[b]) { const k = isoWeek(r[b]); if (k) { const kk = k.y * 100 + k.w; wk.set(kk, (wk.get(kk) || 0) + 1); dates.push(r[b]); } } }); });
  let wlist = [];
  if (dates.length) {   // semanas seguidas, también las que no tuvieron ninguna
    dates.sort(); const t = new Date(dates[0] + 'T00:00:00'), end = dates[dates.length - 1];
    while (ymd(t) <= end && wlist.length < 200) { const k = isoWeek(ymd(t)); const kk = k.y * 100 + k.w; if (wlist[wlist.length - 1] !== kk) wlist.push(kk); t.setDate(t.getDate() + 7); }
    const ke = isoWeek(end), kk2 = ke.y * 100 + ke.w; if (wlist[wlist.length - 1] !== kk2) wlist.push(kk2);
  }
  wlist = wlist.slice(-16);
  const wvals = wlist.map(k => wk.get(k) || 0), META = CX_META, nOk = wvals.filter(v => v >= META).length, avg = wvals.length ? wvals.reduce((a, b) => a + b, 0) / wvals.length : 0, lastV = wvals[wvals.length - 1] || 0;
  root.innerHTML = `
    <section class="cx-hero"><div class="cx-ring" style="--p:${pct.toFixed(1)}"><b>${pct.toFixed(0)}<small>%</small></b></div>
      <div><h3>Extremos imputados</h3><p><b>${imp.toLocaleString('es-ES')}</b> de ${ext.toLocaleString('es-ES')} extremos</p><p class="muted">${both.toLocaleString('es-ES')} cables con los dos extremos imputados</p></div></section>
    <div class="kpis"><div class="kpi"><span>${hasS ? 'Cables de instrumentación' : 'Cables'}</span><b>${n.toLocaleString('es-ES')}</b>${hasS ? `<small>${inS.toLocaleString('es-ES')} ya están en CONEXIONADO</small>` : ''}</div><div class="kpi"><span>Falta</span><b>${falta}</b><small>extremos</small></div><div class="kpi"><span>Pendientes</span><b>${pen}</b><small>extremos</small></div>${missing ? `<div class="kpi"><span>Sin iniciar</span><b>${missing.toLocaleString('es-ES')}</b><small>cables sin fila en CONEXIONADO</small></div>` : ''}</div>
    ${cxConexBlock(d, n, nRows, missing)}
    ${wlist.length ? `<p class="chart-t">Puntas conectadas por semana (From + To)</p>
      <div class="kpis"><div class="kpi"><span>Última semana (S${wlist[wlist.length - 1] % 100})</span><b>${lastV}</b><small>${(lastV / META * 100).toFixed(0)} % de la meta</small></div><div class="kpi"><span>Promedio semanal</span><b>${avg.toFixed(0)}</b><small>${(avg / META * 100).toFixed(0)} % de la meta</small></div><div class="kpi"><span>Semanas con la meta cumplida</span><b>${nOk} de ${wvals.length}</b><small>meta ${META} puntas por semana</small></div></div>
      <div class="chart" id="cxChWk"></div>
      <div class="klg"><span><i class="sw" style="background:var(--v-good)"></i>Cumple la meta</span><span><i class="sw" style="background:var(--v-warn)"></i>Por debajo de la meta</span><span><i class="sw goalkey"></i>Meta ${META} puntas</span></div>
      <p class="note-s">Cuenta cada punta (FROM o TO) con status IMPUTADO en la semana de su fecha de status.</p><div class="vtip" id="cxtip" hidden></div>` : '<p class="empty">Todavía no hay puntas imputadas con fecha, así que no hay avance por semana.</p>'}`;
  if (wlist.length && typeof columnsChart === 'function') {
    sTip = $('#cxtip');
    columnsChart($('#cxChWk'), wlist.map(k => k % 100), [{ k: 'p', name: 'Puntas conectadas', css: '--v-good', values: wvals }], { label: 'Puntas conectadas por semana', goal: META, goalLabel: `Meta ${META}`, unit: '', colorFn: i => wvals[i] >= META ? '--v-good' : '--v-warn', extra: i => `${(wvals[i] / META * 100).toFixed(0)} % de la meta` });
  }
}

function cxRepaint() {
  const m = $('#app').dataset.tab;
  if (m === 'cbuscar') renderCxSearch(); else if (m === 'cresumen') renderCxStats(); else if (m === 'ccambios' && typeof renderCxCambios === 'function') renderCxCambios();
  if (CX.sel && $('#view').classList.contains('open') && !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && $('#vBody').contains(document.activeElement))) renderCx();
}

/* ---------- eventos ---------- */
document.addEventListener('change', e => { if (e.target.id === 'cxWho') { CX.who = e.target.value; CX.lim = 120; renderCxSearch(); } });
document.addEventListener('input', e => {
  if (e.target.id === 'cxQ') { CX.qText = e.target.value; CX.lim = 120; renderCxSearch(); const q = $('#cxQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
});
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'cxPull') { t.disabled = true; await pullCx(false); t.disabled = false; renderCxSearch(); }
  else if (t.dataset.cxOpen !== undefined) openCx(t.dataset.cxOpen);
  else if (t.id === 'cxMore') { CX.lim += 200; renderCxSearch(); }
  else if (t.closest('#cxChips')) { if (t.dataset.av !== undefined && t.dataset.st === undefined) CX.av = CX.av === t.dataset.av ? '' : t.dataset.av; else { CX.st = t.dataset.st || ''; if (t.dataset.av !== undefined) CX.av = t.dataset.av; } CX.lim = 120; renderCxSearch(); }
  else if (t.dataset.cxsrc) { CX.src = t.dataset.cxsrc; CX.lim = 120; renderCxSearch(); }
  else if (t.dataset.cxAddnew !== undefined) { cxListToggle(t.dataset.cxAddnew, true); renderCxSearch(); }
  else if (t.id === 'cxAddAll') cxAddAllHits();
  else if (t.id === 'cxPendPdf') cxAvancesPdf(cxHits());
  else if (t.id === 'cxPendDone') { const h = cxHits(); if (confirm(`¿Marcar los ${h.length} cables como imputados en el sistema externo?`)) cxMarcar(cxPendIds(h), 'Imputado'); }
  else if (t.id === 'cxPullCC') { t.disabled = true; if (typeof pullCC === 'function') await pullCC(false); renderCxSearch(); }
  else if (t.dataset.cxFilter !== undefined) { CX.st = t.dataset.cxFilter; CX.av = ''; CX.src = 'sheet'; setTab('cbuscar'); }
});
$('#vBody').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t || !CX.sel) return;
  const tag = CX.sel;
  if (t.dataset.cxUndoid !== undefined) { if (confirm('¿Deshacer este cambio? Se quita de los avances por imputar.')) cxUndoId(t.dataset.cxUndoid); }
  else if (t.dataset.cxQundo !== undefined) { if (confirm('¿Deshacer este cambio?')) cxUndoQueued(t.dataset.cxQundo, t.dataset.col); }
  else if (t.dataset.cxMark !== undefined || t.dataset.cxDrop !== undefined) { const tg = t.dataset.cxMark ?? t.dataset.cxDrop, o = CX.pmap.get(norm(tg)), ids = []; if (o) o.forEach(e => ids.push(...e.ids)); if (confirm(t.dataset.cxMark !== undefined ? '¿Ya está imputado en el sistema externo?' : '¿Descartar estos avances?')) cxMarcar(ids, t.dataset.cxMark !== undefined ? 'Imputado' : 'Descartado'); }
  else if (t.dataset.cxPk !== undefined) { const all = CX.data.cols.filter((c, ci) => ci !== CX.ti); cxPickOpen = true; cxSetFields(t.dataset.cxPk === 'all' ? null : t.dataset.cxPk === 'ed' ? all.filter(c => c.edit).map(c => c.name) : []); }
  else if (t.id === 'cxCopy') { navigator.clipboard.writeText(tag).then(() => toast('Tag copiado'), () => toast('No se pudo copiar el tag')); }
  else if (t.id === 'cxToCab') { setTab('search'); openCable(IDX.get(norm(tag)), true); }
  else if (t.dataset.cxUndo !== undefined) { if (confirm('¿Deshacer este cambio y devolver el valor anterior?')) cxSave(tag, { [t.dataset.cxUndo]: t.dataset.v }); }
  else if (t.dataset.cxUnlock !== undefined) { if (confirm('¿Desbloquear esta punta imputada para editarla? Los cambios quedan en el historial con tu nombre.')) { CX.unlock.add(norm(tag) + '|' + t.dataset.cxUnlock); renderCx(); } }
  else if (t.id === 'cxDiscard') { CX.draft = {}; renderCx(); }
  else if (t.id === 'cxSaveBtn') {
    const i = CX.idx.get(norm(tag)), ch = {};
    for (const [k, v] of Object.entries(CX.draft)) if ((CX.data.rows[i][CX.ci.get(k)] || '') !== v) ch[k] = v;
    if (!cxAdm()) for (const k of Object.keys(ch)) if (!ch[k] && (CX.data.rows[i][CX.ci.get(k)] || '')) { delete ch[k]; toast('Solo el administrador puede borrar datos'); }
    if (!Object.keys(ch).length) { CX.draft = {}; return renderCx(); }
    cxSave(tag, ch);
  } else if (t.dataset.cxSet !== undefined) {
    const f = t.parentElement.dataset.f; CX.draft[f] = t.dataset.cxSet;
    const dn = 'FECHA_' + f, dc = CX.data.cols[cxCol(dn)];
    if (dc && dc.edit && CX.draft[dn] === undefined) CX.draft[dn] = t.dataset.cxSet ? cxToday() : '';
    renderCx();
  }
});
$('#vBody').addEventListener('change', e => {
  const f = e.target.dataset && e.target.dataset.cxFld; if (f === undefined || !CX.data) return;
  const all = CX.data.cols.filter((c, ci) => ci !== CX.ti).map(c => c.name), cur = new Set(Array.isArray(cxFields) ? cxFields : all);
  e.target.checked ? cur.add(f) : cur.delete(f); cxPickOpen = true; cxSetFields(all.filter(n => cur.has(n)));
});
$('#vBody').addEventListener('toggle', e => { if (e.target.id === 'cxPick') cxPickOpen = e.target.open; }, true);
$('#vBody').addEventListener('input', e => {
  const f = e.target.dataset && e.target.dataset.f; if (!f || !CX.sel) return;
  CX.draft[f] = e.target.value;
  const box = e.target.closest('.cx-f'); if (box) { const on = e.target.value.trim() !== ''; box.classList.toggle('done', on); box.classList.toggle('todo', !on); }
  const b = $('#cxSaveBtn'), n = Object.keys(CX.draft).length; if (b) { b.disabled = !n; b.textContent = `Guardar cambios (${n})`; } const dsc = $('#cxDiscard'); if (dsc) dsc.disabled = !n;
});
loadCx();
