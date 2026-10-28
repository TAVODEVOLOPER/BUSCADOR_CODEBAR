/* Cable Scan BW04 — app estática (sin servidor). Datos y archivos se guardan en el dispositivo (IndexedDB). */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');

/* ---------- IndexedDB ---------- */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('cablescan', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('meta');
      db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true }).createIndex('tag', 'tag');
      db.createObjectStore('files', { keyPath: 'id', autoIncrement: true }).createIndex('tag', 'tag');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (s, k) => tx(s, 'readonly', st => st.get(k)),
    put: (s, v, k) => tx(s, 'readwrite', st => st.put(v, k)),
    del: (s, k) => tx(s, 'readwrite', st => st.delete(k)),
    all: s => tx(s, 'readonly', st => st.getAll()),
    byTag: (s, tag) => tx(s, 'readonly', st => st.index('tag').getAll(tag)),
  };
})();

/* ---------- Estado ---------- */
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
};
let DATA = null;            // {columns:[{letter,name}], rows:[[...]], generado, origen, fuente}
let IDX = new Map();        // tag normalizado -> fila
let COL = new Map();        // nombre columna -> índice
let TAGI = 0, STATI = -1;
let scanList = LS.get('scanList', []);      // [{tag, code, found, time}]
let flags = new Map();      // tag -> {notes,files}
let current = -1;           // fila abierta
let pickerTarget = 'ficha';

const DEF_FICHA_END = 20;   // columna U (índice 20)
const DEF_LISTA = ['CABLE_NUMBER', 'Status Actual', 'Fecha de Status', 'Tipo de Incidencia', 'Descripcion adicional'];

function colsSel(kind) {
  const saved = LS.get('cols_' + kind, null);
  const names = DATA.columns.map(c => c.name);
  if (saved) {
    const ok = saved.filter(n => COL.has(n));
    if (ok.length || saved.length === 0) return ok;
  }
  if (kind === 'ficha') return names.slice(0, DEF_FICHA_END + 1);
  return DEF_LISTA.filter(n => COL.has(n));
}

/* ---------- Datos ---------- */
function setData(d, fuente) {
  d.fuente = fuente || d.fuente || 'repo';
  DATA = d;
  COL = new Map(d.columns.map((c, i) => [c.name, i]));
  TAGI = COL.get(d.tagCol || 'CABLE_NUMBER') ?? 3;
  STATI = COL.has('Status Actual') ? COL.get('Status Actual') : -1;
  IDX = new Map();
  d.rows.forEach((r, i) => IDX.set(norm(r[TAGI]), i));
  $('#dataInfo').textContent = `${d.rows.length} cables · ${d.columns.length} col. · ${d.generado || ''} · ${d.fuente === 'local' ? 'importado' : 'repositorio'}`;
  buildChips();
  renderSearch();
  renderList();
}

async function loadData() {
  const stored = await DB.get('meta', 'data').catch(() => null);
  let repo = null;
  try {
    const r = await fetch('data.json?' + Date.now(), { cache: 'no-store' });
    if (r.ok) repo = await r.json();
  } catch { }
  if (stored && stored.fuente === 'local') { setData(stored); return; }
  if (repo) { repo.fuente = 'repo'; await DB.put('meta', repo, 'data'); setData(repo); return; }
  if (stored) { setData(stored); return; }
  $('#dataInfo').textContent = 'sin datos: importa tu Excel (⚙)';
  toast('No hay datos. Abre ⚙ e importa tu Excel.');
}

/* Convierte una hoja (array de arrays) en la tabla principal */
function aoaToData(aoa, origen, hoja) {
  let h = -1;
  for (let i = 0; i < Math.min(6, aoa.length); i++) {
    if (aoa[i].some(v => String(v).trim() === 'CABLE_NUMBER')) { h = i; break; }
  }
  if (h < 0) throw new Error('No encuentro la columna CABLE_NUMBER en las primeras filas.');
  let header = aoa[h].map(v => String(v ?? '').trim());
  let last = header.length; while (last > 0 && !header[last - 1]) last--;
  header = header.slice(0, last);
  const ti = header.indexOf('CABLE_NUMBER');
  const rows = [];
  for (let i = h + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || !String(r[ti] ?? '').trim()) continue;
    const out = [];
    for (let c = 0; c < last; c++) out.push(String(r[c] ?? '').trim());
    rows.push(out);
  }
  return {
    generado: new Date().toISOString().slice(0, 16).replace('T', ' '),
    origen, hoja, tagCol: 'CABLE_NUMBER',
    columns: header.map((n, i) => ({ letter: XLSX.utils.encode_col(i), name: n })),
    rows,
  };
}

function cellToText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const ms = Math.round(v.getTime() / 60000) * 60000;
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function workbookToData(wb, origen) {
  let best = null;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }).map(r => r.map(cellToText));
    const head = aoa.slice(0, 6).find(r => r.includes('CABLE_NUMBER'));
    if (!head) continue;
    const score = (head.includes('Status Actual') ? 1000 : 0) + head.length;
    if (!best || score > best.score) best = { score, aoa, name };
  }
  if (!best) throw new Error('Ninguna hoja tiene la columna CABLE_NUMBER.');
  return aoaToData(best.aoa, origen, best.name);
}

async function importFile(file) {
  try {
    toast('Leyendo ' + file.name + '…');
    const isCsv = /\.csv$/i.test(file.name);
    const wb = isCsv
      ? XLSX.read(await file.text(), { type: 'string' })
      : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const d = workbookToData(wb, file.name);
    d.fuente = 'local';
    await DB.put('meta', d, 'data');
    setData(d, 'local');
    toast(`Importado: ${d.rows.length} cables, hoja ${d.hoja}`);
  } catch (e) { toast('Error: ' + e.message, 5000); }
}

async function importCsvUrl() {
  const url = $('#sCsvUrl').value.trim();
  if (!url) return toast('Pega primero la URL CSV');
  LS.set('csvUrl', url);
  try {
    toast('Descargando…');
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const wb = XLSX.read(await r.text(), { type: 'string' });
    const d = workbookToData(wb, 'Google Sheet');
    d.fuente = 'local';
    await DB.put('meta', d, 'data');
    setData(d, 'local');
    toast(`Importado: ${d.rows.length} cables`);
  } catch (e) { toast('No se pudo importar: ' + e.message, 5000); }
}

async function reloadRepo() {
  try {
    const r = await fetch('data.json?' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    d.fuente = 'repo';
    await DB.put('meta', d, 'data');
    setData(d, 'repo');
    toast('Datos del repositorio cargados (' + d.rows.length + ')');
  } catch (e) { toast('No se pudo leer data.json: ' + e.message, 5000); }
}

/* ---------- Búsqueda de tag ---------- */
function findRows(code) {
  const c = norm(code).replace(/\.+$/, '');
  if (!c) return [];
  const hit = IDX.get(c);
  if (hit !== undefined) return [hit];
  const out = [];
  for (const [k, i] of IDX) {
    if (k.includes(c) || (k.length >= 8 && c.includes(k))) { out.push(i); if (out.length >= 200) break; }
  }
  return out;
}

const statusClass = s => {
  s = String(s || '').toUpperCase();
  if (s.startsWith('TENDIDO')) return 'ok';
  if (s.startsWith('INCIDENCIA')) return 'bad';
  if (['COIL', 'CORTE', 'WORKING', 'MEDICIÓN', 'PENDING', 'CORREO'].some(x => s.startsWith(x))) return 'warn';
  return '';
};
const fmtVal = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : v;

/* ---------- Manejo de un código leído ---------- */
let lastHandled = { code: '', t: 0 };
function handleCode(code, source) {
  code = String(code || '').trim();
  if (!code) return;
  const now = Date.now();
  if (code === lastHandled.code && now - lastHandled.t < 2500) return;   // anti-rebote
  lastHandled = { code, t: now };
  if (!DATA) return toast('Aún no hay datos cargados');

  const rows = findRows(code);
  const listMode = $('#listMode').checked;

  if (listMode) {
    const tag = rows.length === 1 ? DATA.rows[rows[0]][TAGI] : code;
    const found = rows.length === 1;
    const dup = scanList.some(x => norm(x.tag) === norm(tag));
    if (dup) { beep(false); showLast('dup', `Ya estaba en la lista: ${tag}`); return; }
    scanList.push({ tag, code, found, multi: rows.length > 1, time: new Date().toISOString() });
    LS.set('scanList', scanList);
    renderList();
    beep(found);
    showLast(found ? 'ok' : 'bad', found ? `✔ ${tag}` : (rows.length > 1 ? `⚠ ${rows.length} coincidencias para "${code}" (añadido tal cual)` : `✖ No encontrado: ${code}`));
    return;
  }

  if (rows.length === 1) { beep(true); openCable(rows[0]); }
  else if (rows.length > 1) { beep(true); showMatches(code, rows); }
  else { beep(false); showLast('bad', `✖ No encontrado: ${code}`); }
}

function showLast(cls, text) {
  const el = $('#lastScan');
  el.hidden = false; el.className = 'last ' + cls; el.textContent = text;
}

function showMatches(code, rows) {
  $$('.tab').find(t => t.dataset.tab === 'search').click();
  $('#q').value = code;
  renderSearch();
}

/* ---------- Sonido ---------- */
let actx;
function beep(ok) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = ok ? 1000 : 300; g.gain.value = 0.08;
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + (ok ? 0.1 : 0.25));
  } catch { }
  if (navigator.vibrate) navigator.vibrate(ok ? 40 : [80, 60, 80]);
}

/* ---------- Cámara ---------- */
const cam = { stream: null, on: false, paused: false, detector: null, reader: null, devices: [], devIdx: -1, torch: false, timer: null };

async function startCam() {
  if (!navigator.mediaDevices?.getUserMedia) return toast('Este navegador no permite cámara (se necesita HTTPS)', 4000);
  try {
    const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (cam.devIdx >= 0 && cam.devices[cam.devIdx]) video.deviceId = { exact: cam.devices[cam.devIdx].deviceId };
    else video.facingMode = { ideal: 'environment' };
    cam.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (e) { return toast('No pude abrir la cámara: ' + e.name, 4000); }

  const v = $('#video');
  v.srcObject = cam.stream;
  await v.play().catch(() => { });
  $('#videoWrap').hidden = false;
  $('#btnCam').textContent = '⏹ Detener cámara';
  cam.on = true;

  try { cam.devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch { }
  $('#btnSwitchCam').hidden = cam.devices.length < 2;
  const track = cam.stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  $('#btnTorch').hidden = !caps.torch;

  if ('BarcodeDetector' in window) {
    let formats = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'codabar', 'qr_code', 'data_matrix', 'pdf417', 'upc_a', 'upc_e'];
    try { const sup = await BarcodeDetector.getSupportedFormats(); formats = formats.filter(f => sup.includes(f)); } catch { }
    cam.detector = new BarcodeDetector({ formats });
    const loop = async () => {
      if (!cam.on) return;
      if (!cam.paused && v.readyState >= 2) {
        try {
          const r = await cam.detector.detect(v);
          if (r.length) handleCode(r[0].rawValue, 'cam');
        } catch { }
      }
      cam.timer = setTimeout(loop, 130);
    };
    loop();
  } else if (window.ZXing) {
    const Z = ZXing;
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.CODE_93,
    Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.ITF, Z.BarcodeFormat.CODABAR,
    Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.PDF_417]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    cam.reader = new Z.BrowserMultiFormatReader(hints, 150);
    cam.reader.decodeFromStream(cam.stream, v, (res) => { if (res && !cam.paused) handleCode(res.getText(), 'cam'); });
  }
}

function stopCam() {
  cam.on = false;
  clearTimeout(cam.timer);
  try { cam.reader && cam.reader.reset(); } catch { }
  cam.reader = null;
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  cam.stream = null; cam.torch = false;
  $('#videoWrap').hidden = true;
  $('#btnCam').textContent = '📷 Activar cámara';
}

async function toggleTorch() {
  const t = cam.stream?.getVideoTracks()[0]; if (!t) return;
  cam.torch = !cam.torch;
  try { await t.applyConstraints({ advanced: [{ torch: cam.torch }] }); } catch { toast('Linterna no disponible'); }
}

async function switchCam() {
  if (cam.devices.length < 2) return;
  cam.devIdx = (cam.devIdx + 1) % cam.devices.length;
  stopCam(); await startCam();
}

/* ---------- Lector USB / Bluetooth (modo teclado) ---------- */
(() => {
  let buf = '', last = 0;
  document.addEventListener('keydown', e => {
    const tgt = e.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const now = Date.now();
    if (now - last > 120) buf = '';
    last = now;
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (buf.length >= 4) { e.preventDefault(); handleCode(buf, 'kbd'); }
      buf = ''; return;
    }
    if (e.key.length === 1) buf += e.key;
  });
})();

/* ---------- Pestañas ---------- */
$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === t));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
  if (t.dataset.tab === 'search') renderSearch();
  if (t.dataset.tab === 'list') renderList();
}));

/* ---------- Buscar ---------- */
let statusFilter = '';
function buildChips() {
  const el = $('#statusChips');
  if (STATI < 0) { el.innerHTML = ''; return; }
  const cnt = {};
  DATA.rows.forEach(r => { const s = r[STATI] || '(vacío)'; cnt[s] = (cnt[s] || 0) + 1; });
  const items = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  el.innerHTML = `<button class="chip ${statusFilter === '' ? 'on' : ''}" data-s="">Todos</button>` +
    items.map(([s, n]) => `<button class="chip ${statusFilter === s ? 'on' : ''}" data-s="${esc(s)}">${esc(s)} (${n})</button>`).join('');
}
$('#statusChips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  statusFilter = b.dataset.s; buildChips(); renderSearch();
});
$('#q').addEventListener('input', renderSearch);

function renderSearch() {
  if (!DATA) return;
  const q = norm($('#q').value);
  const out = [];
  for (let i = 0; i < DATA.rows.length; i++) {
    const r = DATA.rows[i];
    if (statusFilter && (r[STATI] || '(vacío)') !== statusFilter) continue;
    if (q && !norm(r[TAGI]).includes(q)) continue;
    out.push(i);
    if (out.length >= 60) break;
  }
  $('#results').innerHTML = out.map(i => {
    const r = DATA.rows[i], st = STATI >= 0 ? r[STATI] : '';
    const f = flags.get(r[TAGI]);
    return `<div class="item" data-i="${i}"><div><div class="tag">${esc(r[TAGI])}</div>
      <small>${f ? (f.notes ? '📝' + f.notes + ' ' : '') + (f.files ? '📎' + f.files : '') : ''}</small></div>
      <span class="pill ${statusClass(st)}">${esc(st || '—')}</span></div>`;
  }).join('') || '<p class="muted">Sin resultados.</p>';
}
$('#results').addEventListener('click', e => {
  const it = e.target.closest('.item'); if (it) openCable(+it.dataset.i);
});

/* ---------- Ficha del cable ---------- */
async function refreshFlags() {
  const [n, f] = await Promise.all([DB.all('notes'), DB.all('files')]);
  flags = new Map();
  n.forEach(x => { const o = flags.get(x.tag) || { notes: 0, files: 0 }; o.notes++; flags.set(x.tag, o); });
  f.forEach(x => { const o = flags.get(x.tag) || { notes: 0, files: 0 }; o.files++; flags.set(x.tag, o); });
}

async function openCable(i) {
  current = i; cam.paused = true;
  $('#view').hidden = false;
  await renderCable();
}

async function renderCable() {
  const r = DATA.rows[current], tag = r[TAGI];
  const hideEmpty = LS.get('hideEmpty', false);
  const sel = colsSel('ficha');
  const st = STATI >= 0 ? r[STATI] : '';
  const [notes, files] = await Promise.all([DB.byTag('notes', tag), DB.byTag('files', tag)]);
  notes.sort((a, b) => b.date.localeCompare(a.date));

  const kv = sel.map(n => {
    const c = DATA.columns[COL.get(n)], v = r[COL.get(n)];
    if (hideEmpty && !v) return '';
    return `<div class="kv"><div class="k"><b>${esc(c.letter)}</b>${esc(c.name)}</div><div class="v ${v ? '' : 'empty'}">${v ? esc(fmtVal(v)) : '—'}</div></div>`;
  }).join('');

  const pdfs = files.filter(f => f.kind === 'pdf'), photos = files.filter(f => f.kind === 'photo');
  $('#vAddList').textContent = scanList.some(x => norm(x.tag) === norm(tag)) ? '✔ En lista' : '+ Lista';

  $('#vBody').innerHTML = `
    <div class="vhead"><div class="vtag">${esc(tag)}</div><div><span class="pill ${statusClass(st)}">${esc(st || 'Sin status')}</span></div></div>
    <label class="toggle"><input type="checkbox" id="hideEmpty" ${hideEmpty ? 'checked' : ''}> Ocultar columnas vacías</label>
    <div class="grid">${kv || '<div class="kv"><div class="v empty">Sin columnas seleccionadas (▦ Columnas)</div></div>'}</div>

    <div class="sec"><h3>📄 Pulling (PDF)</h3>
      <div class="files">${pdfs.map(f => `<div class="file"><span>${esc(f.name)}</span>
        <span class="btn-row"><button class="btn small" data-open="${f.id}">Abrir</button><button class="btn small danger" data-delf="${f.id}">✕</button></span></div>`).join('') || '<small class="muted">Sin PDF cargado.</small>'}</div>
      <div class="btn-row" style="margin-top:8px"><button class="btn" id="addPdf">+ Cargar PDF</button></div></div>

    <div class="sec"><h3>📷 Fotos</h3>
      <div class="photos">${photos.map(f => `<img data-photo="${f.id}" alt="${esc(f.name)}" src="${URL.createObjectURL(f.blob)}">`).join('')}</div>
      <div class="btn-row" style="margin-top:8px"><button class="btn" id="addPhoto">📸 Tomar foto</button><button class="btn" id="addPhotoGal">🖼 Desde galería</button></div></div>

    <div class="sec"><h3>📝 Anotaciones</h3>
      <textarea id="noteText" placeholder="Escribe una anotación…"></textarea>
      <div class="btn-row" style="margin-top:8px"><button class="btn primary" id="saveNote">Guardar nota</button></div>
      ${notes.map(n => `<div class="note"><small><span>${esc(new Date(n.date).toLocaleString('es-ES'))}</span><button class="btn small danger" data-deln="${n.id}">✕</button></small><p>${esc(n.text)}</p></div>`).join('')}
    </div>`;
}

$('#vBody').addEventListener('click', async e => {
  const t = e.target;
  const tag = DATA.rows[current][TAGI];
  if (t.id === 'addPdf') $('#filePdf').click();
  else if (t.id === 'addPhoto') $('#filePhoto').click();
  else if (t.id === 'addPhotoGal') $('#filePhotoGal').click();
  else if (t.id === 'saveNote') {
    const text = $('#noteText').value.trim(); if (!text) return;
    await DB.put('notes', { tag, text, date: new Date().toISOString() });
    await refreshFlags(); await renderCable(); toast('Nota guardada');
  } else if (t.dataset.deln) {
    if (!confirm('¿Borrar la nota?')) return;
    await DB.del('notes', +t.dataset.deln); await refreshFlags(); await renderCable();
  } else if (t.dataset.delf) {
    if (!confirm('¿Borrar el archivo?')) return;
    await DB.del('files', +t.dataset.delf); await refreshFlags(); await renderCable();
  } else if (t.dataset.open) {
    const f = await DB.get('files', +t.dataset.open);
    window.open(URL.createObjectURL(new Blob([f.blob], { type: 'application/pdf' })), '_blank');
  } else if (t.dataset.photo) openLightbox(+t.dataset.photo);
  else if (t.id === 'hideEmpty') { LS.set('hideEmpty', t.checked); renderCable(); }
});

$('#vBack').addEventListener('click', () => { $('#view').hidden = true; current = -1; cam.paused = false; renderSearch(); renderList(); });
$('#vAddList').addEventListener('click', () => {
  const tag = DATA.rows[current][TAGI];
  if (scanList.some(x => norm(x.tag) === norm(tag))) return toast('Ya está en la lista');
  scanList.push({ tag, code: tag, found: true, time: new Date().toISOString() });
  LS.set('scanList', scanList); renderList(); $('#vAddList').textContent = '✔ En lista'; toast('Añadido a la lista');
});

/* archivos */
async function addFiles(fileList, kind) {
  const tag = DATA.rows[current][TAGI];
  for (const f of fileList) {
    let blob = f;
    if (kind === 'photo') blob = await shrinkImage(f);
    await DB.put('files', { tag, kind, name: f.name || (kind === 'photo' ? 'foto.jpg' : 'archivo.pdf'), type: blob.type, blob, date: new Date().toISOString() });
  }
  await refreshFlags(); await renderCable();
  toast(kind === 'pdf' ? 'PDF guardado' : 'Foto guardada');
}
$('#filePdf').addEventListener('change', e => { addFiles(e.target.files, 'pdf'); e.target.value = ''; });
$('#filePhoto').addEventListener('change', e => { addFiles(e.target.files, 'photo'); e.target.value = ''; });
$('#filePhotoGal').addEventListener('change', e => { addFiles(e.target.files, 'photo'); e.target.value = ''; });

async function shrinkImage(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', 0.82));
  } catch { return file; }
}

let lbId = null;
async function openLightbox(id) {
  const f = await DB.get('files', id); if (!f) return;
  lbId = id; $('#lbImg').src = URL.createObjectURL(f.blob); $('#lightbox').hidden = false;
}
$('#lbClose').addEventListener('click', () => { $('#lightbox').hidden = true; });
$('#lbDel').addEventListener('click', async () => {
  if (!confirm('¿Borrar la foto?')) return;
  await DB.del('files', lbId); $('#lightbox').hidden = true; await refreshFlags(); renderCable();
});

/* ---------- Lista de escaneos ---------- */
function listColumns() { return colsSel('lista'); }

function listMatrix(withNotes = true) {
  const cols = listColumns();
  const head = ['#', 'Hora', 'Código leído', 'Encontrado', ...cols, ...(withNotes ? ['Notas'] : [])];
  return { head, rows: scanList.map((x, n) => {
    const ri = IDX.get(norm(x.tag));
    const vals = cols.map(c => ri === undefined ? '' : DATA.rows[ri][COL.get(c)]);
    return [n + 1, new Date(x.time).toLocaleString('es-ES'), x.code, x.found ? 'SI' : 'NO', ...vals, ...(withNotes ? [x.notes || ''] : [])];
  }) };
}

async function attachNotesToList() {
  const notes = await DB.all('notes');
  const by = new Map();
  notes.forEach(n => by.set(n.tag, (by.get(n.tag) ? by.get(n.tag) + ' | ' : '') + n.text.replace(/\s+/g, ' ')));
  scanList.forEach(x => { x.notes = by.get(x.tag) || ''; });
}

function renderList() {
  if (!DATA) return;
  $('#listCount').textContent = scanList.length;
  const cols = listColumns();
  const nf = scanList.filter(x => !x.found).length;
  $('#listHint').textContent = scanList.length
    ? `${scanList.length} códigos${nf ? ` · ${nf} sin encontrar` : ''}. Columnas elegidas en ▦ Columnas → "En lista / exportación".`
    : 'Activa el "Modo lista" en Escanear y lee varios códigos; aquí aparecerán.';
  const t = $('#listTable');
  t.innerHTML = '<thead><tr><th>#</th><th>Tag</th>' + cols.filter(c => c !== DATA.tagCol).map(c => `<th>${esc(c)}</th>`).join('') + '<th></th></tr></thead><tbody>' +
    scanList.map((x, n) => {
      const ri = IDX.get(norm(x.tag));
      return `<tr class="${x.found ? '' : 'nf'}" data-n="${n}"><td>${n + 1}</td><td class="tagc">${esc(x.tag)}</td>` +
        cols.filter(c => c !== DATA.tagCol).map(c => `<td>${ri === undefined ? '' : esc(fmtVal(DATA.rows[ri][COL.get(c)]))}</td>`).join('') +
        `<td><button data-del="${n}" title="Quitar">✕</button></td></tr>`;
    }).join('') + '</tbody>';
}
$('#listTable').addEventListener('click', e => {
  const d = e.target.closest('[data-del]');
  if (d) { scanList.splice(+d.dataset.del, 1); LS.set('scanList', scanList); renderList(); return; }
  const tr = e.target.closest('tr[data-n]');
  if (tr) { const x = scanList[+tr.dataset.n]; const ri = IDX.get(norm(x.tag)); if (ri !== undefined) openCable(ri); }
});

function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

$('#btnXlsx').addEventListener('click', async () => {
  if (!scanList.length) return toast('La lista está vacía');
  await attachNotesToList();
  const { head, rows } = listMatrix();
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  ws['!cols'] = head.map((h, i) => ({ wch: i === 2 ? 36 : Math.min(40, Math.max(10, String(h).length + 2)) }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'ESCANEOS');
  XLSX.writeFile(wb, `escaneos_${stamp()}.xlsx`);
});
$('#btnCsv').addEventListener('click', async () => {
  if (!scanList.length) return toast('La lista está vacía');
  await attachNotesToList();
  const { head, rows } = listMatrix();
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [head, ...rows].map(r => r.map(q).join(';')).join('\r\n');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `escaneos_${stamp()}.csv`);
});
$('#btnCopy').addEventListener('click', async () => {
  if (!scanList.length) return toast('La lista está vacía');
  await attachNotesToList();
  const { head, rows } = listMatrix();
  const tsv = [head, ...rows].map(r => r.map(v => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
  try { await navigator.clipboard.writeText(tsv); toast('Copiado: pégalo en Google Sheets (Ctrl+V)'); }
  catch { toast('No pude copiar; usa Excel o CSV'); }
});
$('#btnSheet').addEventListener('click', async () => {
  if (!scanList.length) return toast('La lista está vacía');
  const url = LS.get('scriptUrl', '');
  if (!url) { toast('Configura la URL de Apps Script en ⚙', 4000); return; }
  await attachNotesToList();
  const { head, rows } = listMatrix();
  try {
    await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ sheet: LS.get('sheetName', 'ESCANEOS') || 'ESCANEOS', header: head, rows }) });
    toast('Enviado. Revisa tu Google Sheet.', 3500);
  } catch (e) { toast('No se pudo enviar: ' + e.message, 4000); }
});
$('#btnClear').addEventListener('click', () => {
  if (!scanList.length) return;
  if (!confirm('¿Vaciar la lista de escaneos?')) return;
  scanList = []; LS.set('scanList', scanList); renderList();
});

/* ---------- Selector de columnas ---------- */
function openCols() { $('#colsModal').hidden = false; renderPicker(); }
function renderPicker() {
  const f = norm($('#cFilter').value);
  const sel = new Set(colsSel(pickerTarget));
  $$('.segbtn').forEach(b => b.classList.toggle('active', b.dataset.target === pickerTarget));
  $('#cList').innerHTML = DATA.columns.map(c => (!f || norm(c.name).includes(f) || norm(c.letter) === f) ?
    `<label class="citem"><input type="checkbox" data-n="${esc(c.name)}" ${sel.has(c.name) ? 'checked' : ''}><b>${esc(c.letter)}</b><span>${esc(c.name)}</span></label>` : '').join('');
}
$('#cList').addEventListener('change', e => {
  const cur = new Set(colsSel(pickerTarget));
  e.target.checked ? cur.add(e.target.dataset.n) : cur.delete(e.target.dataset.n);
  LS.set('cols_' + pickerTarget, DATA.columns.map(c => c.name).filter(n => cur.has(n)));
  if (pickerTarget === 'lista') renderList();
});
$('#cFilter').addEventListener('input', renderPicker);
$$('.segbtn').forEach(b => b.addEventListener('click', () => { pickerTarget = b.dataset.target; renderPicker(); }));
$$('[data-preset]').forEach(b => b.addEventListener('click', () => {
  const names = DATA.columns.map(c => c.name);
  const p = b.dataset.preset;
  LS.set('cols_' + pickerTarget, p === 'all' ? names : p === 'none' ? [] : names.slice(0, DEF_FICHA_END + 1));
  renderPicker(); renderList();
}));
$('#cClose').addEventListener('click', () => { $('#colsModal').hidden = true; if (current >= 0) renderCable(); });
$('#btnCols').addEventListener('click', () => DATA ? openCols() : toast('Aún no hay datos'));

/* ---------- Ajustes ---------- */
$('#btnSettings').addEventListener('click', () => {
  $('#setModal').hidden = false;
  $('#sInfo').textContent = DATA ? `Tabla actual: ${DATA.rows.length} cables, hoja "${DATA.hoja || '?'}", origen ${DATA.origen || '?'}, ${DATA.generado || ''}.` : 'Sin datos todavía.';
  $('#sCsvUrl').value = LS.get('csvUrl', ''); $('#sScriptUrl').value = LS.get('scriptUrl', ''); $('#sSheetName').value = LS.get('sheetName', 'ESCANEOS');
});
$('#sClose').addEventListener('click', () => {
  LS.set('scriptUrl', $('#sScriptUrl').value.trim()); LS.set('sheetName', $('#sSheetName').value.trim() || 'ESCANEOS'); LS.set('csvUrl', $('#sCsvUrl').value.trim());
  $('#setModal').hidden = true;
});
$('#sImport').addEventListener('click', () => $('#fileExcel').click());
$('#fileExcel').addEventListener('change', e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });
$('#sRepo').addEventListener('click', reloadRepo);
$('#sCsv').addEventListener('click', importCsvUrl);

/* copia de seguridad */
const blobToDataUrl = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
$('#sBackup').addEventListener('click', async () => {
  const notes = await DB.all('notes'), files = await DB.all('files');
  const fx = []; for (const f of files) fx.push({ ...f, id: undefined, blob: undefined, data: await blobToDataUrl(f.blob) });
  const out = { v: 1, date: new Date().toISOString(), notes: notes.map(n => ({ ...n, id: undefined })), files: fx, scanList };
  download(new Blob([JSON.stringify(out)], { type: 'application/json' }), `cablescan_backup_${stamp()}.json`);
});
$('#sRestore').addEventListener('click', () => $('#fileBackup').click());
$('#fileBackup').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const j = JSON.parse(await file.text());
    for (const n of j.notes || []) await DB.put('notes', n);
    for (const f of j.files || []) { const blob = await (await fetch(f.data)).blob(); const { data, ...rest } = f; await DB.put('files', { ...rest, blob }); }
    if (j.scanList?.length) { scanList = j.scanList; LS.set('scanList', scanList); }
    await refreshFlags(); renderList(); renderSearch(); toast('Copia restaurada');
  } catch (err) { toast('Copia inválida: ' + err.message, 4000); }
});
$('#sNotesXlsx').addEventListener('click', async () => {
  const notes = await DB.all('notes'), files = await DB.all('files');
  if (!notes.length) return toast('No hay anotaciones');
  const rows = notes.sort((a, b) => a.tag.localeCompare(b.tag) || a.date.localeCompare(b.date))
    .map(n => [n.tag, new Date(n.date).toLocaleString('es-ES'), n.text, files.filter(f => f.tag === n.tag && f.kind === 'pdf').length, files.filter(f => f.tag === n.tag && f.kind === 'photo').length]);
  const ws = XLSX.utils.aoa_to_sheet([['CABLE_NUMBER', 'Fecha', 'Anotación', 'PDF', 'Fotos'], ...rows]);
  ws['!cols'] = [{ wch: 36 }, { wch: 18 }, { wch: 60 }, { wch: 6 }, { wch: 6 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'ANOTACIONES');
  XLSX.writeFile(wb, `anotaciones_${stamp()}.xlsx`);
});

/* ---------- Entradas de escaneo ---------- */
$('#btnCam').addEventListener('click', () => cam.on ? stopCam() : startCam());
$('#btnTorch').addEventListener('click', toggleTorch);
$('#btnSwitchCam').addEventListener('click', switchCam);
$('#scanInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value; e.target.value = ''; lastHandled = { code: '', t: 0 }; handleCode(v, 'input'); }
});
$('#btnGo').addEventListener('click', () => { const i = $('#scanInput'); const v = i.value; i.value = ''; lastHandled = { code: '', t: 0 }; handleCode(v, 'input'); });
$('#listMode').checked = LS.get('listMode', false);
$('#listMode').addEventListener('change', e => LS.set('listMode', e.target.checked));
document.addEventListener('visibilitychange', () => { if (document.hidden && cam.on) stopCam(); });

/* ---------- Utilidades ---------- */
let toastT;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- Arranque ---------- */
(async function init() {
  try { navigator.storage?.persist?.(); } catch { }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  await refreshFlags().catch(() => { });
  await loadData();
})();
