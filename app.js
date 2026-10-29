/* Cable Scan BW04 — app estática (sin servidor propio).
   Tabla y PDF: solo lectura desde tu Google. Notas y fotos: las añade el equipo por tag.
   Todo se guarda también en el dispositivo (IndexedDB) para trabajar sin cobertura. */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
const isWide = () => window.matchMedia('(min-width:760px)').matches;
const CFG = self.CABLE_CONFIG || {};
const APP_VERSION = CFG.version || '';
const scriptUrl = () => LS.get('scriptUrl', '') || CFG.scriptUrl || '';   // la de config.js salvo que se cambie en Ajustes

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

/* ---------- Pie de página: versión y estado ---------- */
function setInfo(t, title = '') { $$('.js-info').forEach(e => { e.textContent = t; e.title = title; }); }
function setConn(state, text) {
  const c = $('#connState'); if (!c) return;
  c.dataset.state = state; c.querySelector('span').textContent = text;
}
function paintVersion() {
  const t = APP_VERSION ? `Cable Scan v${APP_VERSION}` : 'Cable Scan';
  $$('.js-version').forEach(e => { e.textContent = t; });
}
function connStatus() {
  if (!cloud.on()) return setConn(scriptUrl() ? 'warn' : 'off', scriptUrl() ? 'Falta la clave' : 'Sin conectar');
  setConn(navigator.onLine ? 'ok' : 'warn', navigator.onLine ? 'Conectado a Google' : 'Sin conexión');
}

/* ---------- Estado ---------- */
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
};
let DATA = null;            // {columns:[{letter,name}], rows:[[...]], generado, origen, fuente, hash}
let IDX = new Map();        // tag normalizado -> fila
let COL = new Map();        // nombre de columna -> índice
let TAGI = 0, STATI = -1, DATEI = -1;
let scanList = LS.get('scanList', []);      // [{tag, code, found, time}]
let flags = new Map();      // tag -> {notes, photos}
let PDFS = [];              // PDF de Drive: [{id, name, date, key}]
let PDFHASH = '';
let current = -1;           // fila abierta
let pickerTarget = 'ficha';
let searchLimit = 60;

const DEF_FICHA_END = 20;   // columna U
const DEF_LISTA = ['CABLE_NUMBER', 'Status Actual', 'Fecha de Status', 'Tipo de Incidencia', 'Descripcion adicional'];

function colsSel(kind) {
  const saved = LS.get('cols_' + kind, null);
  if (saved) return saved.filter(n => COL.has(n));
  const names = DATA.columns.map(c => c.name);
  return kind === 'ficha' ? names.slice(0, DEF_FICHA_END + 1) : DEF_LISTA.filter(n => COL.has(n));
}

/* ---------- Datos ---------- */
function setData(d, fuente) {
  d.fuente = fuente || d.fuente || 'repo';
  DATA = d;
  COL = new Map(d.columns.map((c, i) => [c.name, i]));
  TAGI = COL.get(d.tagCol || 'CABLE_NUMBER') ?? 3;
  STATI = COL.has('Status Actual') ? COL.get('Status Actual') : -1;
  DATEI = COL.has('Fecha de Status') ? COL.get('Fecha de Status') : -1;
  IDX = new Map();
  d.rows.forEach((r, i) => IDX.set(norm(r[TAGI]), i));

  const src = d.fuente === 'cloud' ? 'Google Sheet' : d.fuente === 'local' ? 'importada' : 'repositorio';
  setInfo(`${d.rows.length.toLocaleString('es-ES')} cables, ${d.columns.length} columnas, ${src}`, d.generado ? `Actualizada ${d.generado}` : '');

  // Columnas: se fija la selección inicial y se avisa de las que aparezcan después
  const names = d.columns.map(c => c.name);
  const known = LS.get('knownCols', null);
  if (!known) {
    LS.set('knownCols', names);
    if (!LS.get('cols_ficha', null)) LS.set('cols_ficha', names.slice(0, DEF_FICHA_END + 1));
    if (!LS.get('cols_lista', null)) LS.set('cols_lista', DEF_LISTA.filter(n => COL.has(n)));
  } else {
    const fresh = names.filter(n => !known.includes(n));
    if (fresh.length) {
      LS.set('knownCols', [...known, ...fresh]);
      LS.set('newCols', [...new Set([...LS.get('newCols', []), ...fresh])]);
      toast(`Hay ${fresh.length} ${fresh.length === 1 ? 'columna nueva' : 'columnas nuevas'}. Actívalas en Columnas.`, 5000);
    }
  }
  buildChips(); renderSearch(); renderList();
  if (current >= d.rows.length) current = -1;
  if (current >= 0) renderCable(); else renderEmpty();
}

async function loadData() {
  const stored = await DB.get('meta', 'data').catch(() => null);
  let repo = null;
  try {
    const r = await fetch('data.json?' + Date.now(), { cache: 'no-store' });
    if (r.ok) repo = await r.json();
  } catch { }
  if (stored && (stored.fuente === 'local' || stored.fuente === 'cloud')) { setData(stored); return; }
  if (repo) { repo.fuente = 'repo'; await DB.put('meta', repo, 'data'); setData(repo); return; }
  if (stored) { setData(stored); return; }
  setInfo('Sin tabla todavía');
  renderEmpty();
  toast('Todavía no hay tabla. Conecta tu Google en Ajustes.', 5000);
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
    toast('Leyendo ' + file.name);
    const isCsv = /\.csv$/i.test(file.name);
    const wb = isCsv
      ? XLSX.read(await file.text(), { type: 'string' })
      : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const d = workbookToData(wb, file.name);
    d.fuente = 'local';
    await DB.put('meta', d, 'data');
    setData(d, 'local');
    toast(`Importados ${d.rows.length} cables de la hoja ${d.hoja}`);
  } catch (e) { toast('No se pudo importar el archivo: ' + e.message, 5000); }
}

async function importCsvUrl() {
  const url = $('#sCsvUrl').value.trim();
  if (!url) return toast('Pega primero la URL del CSV');
  LS.set('csvUrl', url);
  try {
    toast('Descargando');
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const wb = XLSX.read(await r.text(), { type: 'string' });
    const d = workbookToData(wb, 'Google Sheet (CSV)');
    d.fuente = 'local';
    await DB.put('meta', d, 'data');
    setData(d, 'local');
    toast(`Importados ${d.rows.length} cables`);
  } catch (e) { toast('No se pudo importar desde esa URL: ' + e.message, 5000); }
}

async function reloadRepo() {
  try {
    const r = await fetch('data.json?' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    d.fuente = 'repo';
    await DB.put('meta', d, 'data');
    setData(d, 'repo');
    toast(`Cargados ${d.rows.length} cables del repositorio`);
  } catch (e) { toast('No se pudo leer data.json: ' + e.message, 5000); }
}

/* ---------- Buscar el tag leído ---------- */
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
  if (s.startsWith('TENDIDO')) return 'st-ok';
  if (s.startsWith('INCIDENCIA')) return 'st-bad';
  if (['COIL', 'CORTE', 'WORKING', 'MEDICIÓN', 'PENDING', 'CORREO'].some(x => s.startsWith(x))) return 'st-warn';
  return 'st-na';
};
const fmtVal = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : v;
const sentence = s => { s = String(s || '').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };

/* ---------- Un código leído ---------- */
let lastHandled = { code: '', t: 0 };
function handleCode(code) {
  code = String(code || '').trim();
  if (!code) return;
  const now = Date.now();
  if (code === lastHandled.code && now - lastHandled.t < 2500) return;   // anti-rebote
  lastHandled = { code, t: now };
  if (!DATA) return toast('Todavía no hay tabla cargada');

  const rows = findRows(code);
  if ($('#listMode').checked) {
    const tag = rows.length === 1 ? DATA.rows[rows[0]][TAGI] : code;
    const found = rows.length === 1;
    if (scanList.some(x => norm(x.tag) === norm(tag))) { beep(false); showLast('dup', tag, 'Ya estaba en la lista'); return; }
    scanList.push({ tag, code, found, time: new Date().toISOString() });
    LS.set('scanList', scanList);
    renderList(); beep(found);
    showLast(found ? 'ok' : 'missing', tag, found ? `Añadido a la lista (${scanList.length})` : (rows.length > 1 ? `${rows.length} coincidencias; añadido tal cual` : 'No está en la tabla; añadido tal cual'));
    return;
  }
  if (rows.length === 1 && rows[0] === current && $('#view').classList.contains('open')) return;   // la cámara sigue viendo el mismo cable
  if (rows.length === 1) { beep(true); camFlash('ok'); openCable(rows[0], true); }
  else if (rows.length > 1) { beep(true); setTab('search'); $('#q').value = code; searchLimit = 60; renderSearch(); }
  else { beep(false); showLast('missing', code, 'No está en la tabla. Revisa el código o busca una parte del tag.'); }
}

function showLast(kind, tag, text) {
  const html = `<div class="marker pop ${kind}"><span class="sleeve"></span><span class="mk-body"><b>${esc(tag)}</b><small>${esc(text)}</small></span></div>`;
  $('#lastScan').innerHTML = html; $('#camLast').innerHTML = html;
  camFlash(kind === 'ok' ? 'ok' : 'bad');
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
  if (!navigator.mediaDevices?.getUserMedia) return toast('Este navegador no permite usar la cámara. Abre la app desde HTTPS.', 4500);
  try {
    const video = { width: { ideal: 1920 }, height: { ideal: 1080 } };   // las etiquetas largas necesitan resolución
    if (cam.devIdx >= 0 && cam.devices[cam.devIdx]) video.deviceId = { exact: cam.devices[cam.devIdx].deviceId };
    else video.facingMode = { ideal: 'environment' };
    cam.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (e) { return toast(e.name === 'NotAllowedError' ? 'Permite el acceso a la cámara en el navegador y vuelve a intentarlo.' : 'No se pudo abrir la cámara: ' + e.name, 5000); }

  const v = $('#video');
  v.srcObject = cam.stream;
  await v.play().catch(() => { });
  $('#videoWrap').hidden = false;
  layoutReticle();   // con el contenedor ya visible, para medirlo bien
  $('#btnCam').textContent = 'Detener cámara';
  cam.on = true;
  LS.set('camAuto', true); keepAwake(true);
  document.body.classList.toggle('scanning', !isWide());

  try { cam.devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch { }
  $('#btnSwitchCam').hidden = cam.devices.length < 2;
  const track = cam.stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  $('#btnTorch').hidden = !caps.torch;
  cam.zoom = caps.zoom ? { min: caps.zoom.min, max: caps.zoom.max, cur: caps.zoom.min } : null;
  $('#btnZoom').hidden = !cam.zoom;
  $('#btnZoom').textContent = '1×';
  if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => { });

  if ('BarcodeDetector' in window) {
    let formats = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'codabar', 'qr_code', 'data_matrix', 'pdf417', 'upc_a', 'upc_e'];
    try { const sup = await BarcodeDetector.getSupportedFormats(); formats = formats.filter(f => sup.includes(f)); } catch { }
    cam.detector = new BarcodeDetector({ formats });
    const loop = async () => {
      if (!cam.on) return;
      if (!cam.paused && v.readyState >= 2) {
        try { const r = await cam.detector.detect(v); if (r.length) handleCode(r[0].rawValue); } catch { }
      }
      cam.timer = setTimeout(loop, 130);
    };
    loop();
  } else if (window.ZXing) {
    // Lector de reserva (iPhone/Safari): se decodifica solo la zona del recuadro, a resolución completa.
    // Recortar quita el ruido del papel y permite leer etiquetas largas a menos píxeles por barra.
    const cv = document.createElement('canvas');
    const cx = cv.getContext('2d', { willReadFrequently: true });
    let n = 0;
    const loop = () => {
      if (!cam.on) return;
      if (!cam.paused && v.readyState >= 2 && v.videoWidth) {
        try {
          const full = { x: 0, y: 0, w: v.videoWidth, h: v.videoHeight };
          const vis = isWide() ? visibleRect(v.videoWidth, v.videoHeight, v.clientWidth, v.clientHeight) : full;   // en el móvil el vídeo se ve entero (contain)
          // cinco pasadas rotativas: recuadro, recuadro ampliado 1,5× y 2× (alarga la distancia a la que se leen las barras finas), lo visible y el fotograma entero
          const k = n++ % 5, sc = k === 1 ? 1.5 : k === 2 ? 2 : 1;
          const r = k === 3 ? vis : k === 4 ? full : reticleRect(vis);
          const cw = Math.round(r.w * sc), ch = Math.round(r.h * sc);
          cv.width = cw; cv.height = ch;
          cx.imageSmoothingEnabled = true;
          cx.drawImage(v, r.x, r.y, r.w, r.h, 0, 0, cw, ch);
          const px = cx.getImageData(0, 0, cw, ch).data;
          const lum = new Uint8ClampedArray(cw * ch);
          for (let i = 0, j = 0; i < px.length; i += 4, j++) lum[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
          const text = zxDecode(lum, cw, ch);
          if (text) handleCode(text);
        } catch { }
      }
      cam.timer = setTimeout(loop, 110);
    };
    loop();
  }
}

/* En el móvil el vídeo se muestra entero (contain) y el recuadro se coloca sobre la imagen real, no sobre la pantalla */
function layoutReticle() {
  const v = $('#video'), c = $('.corners'), box = $('#videoWrap');
  if (isWide() || !v.videoWidth || !box.clientWidth) { c.style.cssText = ''; return; }
  const W = box.clientWidth, H = box.clientHeight, va = v.videoWidth / v.videoHeight;
  const w = Math.min(W, H * va), h = Math.min(H, W / va), ox = (W - w) / 2, oy = (H - h) / 2;
  c.style.cssText = `inset:auto;left:${ox + w * 0.06}px;width:${w * 0.88}px;top:${oy + h * 0.30}px;height:${h * 0.40}px`;
}
window.addEventListener('resize', () => { if (cam.on) layoutReticle(); });
$('#video').addEventListener('loadedmetadata', layoutReticle);

/* Geometría del lector de reserva: qué parte del vídeo ve la persona y cuál es el recuadro */
function visibleRect(W, H, boxW, boxH) {
  const ba = (boxW && boxH) ? boxW / boxH : 4 / 3, va = W / H;
  let w = W, h = H, x = 0, y = 0;
  if (va > ba) { w = Math.round(H * ba); x = Math.round((W - w) / 2); }
  else { h = Math.round(W / ba); y = Math.round((H - h) / 2); }
  return { x, y, w, h };
}
const reticleRect = v => ({ x: v.x + Math.round(v.w * 0.06), y: v.y + Math.round(v.h * 0.30), w: Math.round(v.w * 0.88), h: Math.round(v.h * 0.40) });   // el mismo recuadro ancho que se dibuja

let zxReader = null;
function zxDecode(lum, w, h) {
  if (!window.ZXing) return null;
  const Z = ZXing;
  if (!zxReader) {
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.CODE_93,
    Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.ITF, Z.BarcodeFormat.CODABAR,
    Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.PDF_417]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    zxReader = new Z.MultiFormatReader(); zxReader.setHints(hints);
  }
  try { return zxReader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, w, h)))).getText(); }
  catch { return null; }
}

function stopCam(manual = true) {
  cam.on = false;
  if (manual) LS.set('camAuto', false);
  keepAwake(false); document.body.classList.remove('scanning');
  clearTimeout(cam.timer);
  try { cam.reader && cam.reader.reset(); } catch { }
  cam.reader = null;
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  cam.stream = null; cam.torch = false; cam.zoom = null;
  $('#videoWrap').hidden = true;
  $('#btnCam').textContent = 'Activar cámara';
}

async function toggleTorch() {
  const t = cam.stream?.getVideoTracks()[0]; if (!t) return;
  cam.torch = !cam.torch;
  try { await t.applyConstraints({ advanced: [{ torch: cam.torch }] }); } catch { toast('Este dispositivo no permite encender la linterna'); }
}

async function cycleZoom() {
  const t = cam.stream?.getVideoTracks()[0]; if (!t || !cam.zoom) return;
  const steps = [1, 2, 3].map(s => Math.min(cam.zoom.max, Math.max(cam.zoom.min, s))).filter((s, i, a) => a.indexOf(s) === i);
  const next = steps[(steps.indexOf(cam.zoom.cur) + 1) % steps.length];
  try { await t.applyConstraints({ advanced: [{ zoom: next }] }); cam.zoom.cur = next; $('#btnZoom').textContent = next + '×'; }
  catch { toast('Este dispositivo no permite hacer zoom'); }
}

async function switchCam() {
  if (cam.devices.length < 2) return;
  cam.devIdx = (cam.devIdx + 1) % cam.devices.length;
  stopCam(); await startCam();
}

/* ---------- Lector USB o Bluetooth (modo teclado) ---------- */
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
      if (buf.length >= 4) { e.preventDefault(); handleCode(buf); }
      buf = ''; return;
    }
    if (e.key.length === 1) buf += e.key;
  });
})();

/* ---------- Pestañas ---------- */
function setTab(name) {
  $('#app').dataset.tab = name;
  $$('.tab,.snav[data-tab]').forEach(x => { const on = x.dataset.tab === name; x.classList.toggle('active', on); x.setAttribute('aria-selected', on); });
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (DATA) { if (name === 'search') renderSearch(); if (name === 'list') renderList(); }
}
$$('.tab,.snav[data-tab]').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
$$('.snav[data-proxy]').forEach(b => b.addEventListener('click', () => $('#' + b.dataset.proxy).click()));
setTab($('#app').dataset.tab);

/* ---------- Buscar ---------- */
let statusFilter = '';
function buildChips() {
  const el = $('#statusChips');
  if (STATI < 0) { el.innerHTML = ''; return; }
  const cnt = {};
  DATA.rows.forEach(r => { const s = r[STATI] || '(sin status)'; cnt[s] = (cnt[s] || 0) + 1; });
  const items = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  el.innerHTML = `<button class="filter ${statusFilter === '' ? 'on' : ''}" data-s="">Todos ${DATA.rows.length}</button>` +
    items.map(([s, n]) => `<button class="filter ${statusFilter === s ? 'on' : ''}" data-s="${esc(s)}">${esc(sentence(s))} ${n}</button>`).join('');
}
$('#statusChips').addEventListener('click', e => {
  const b = e.target.closest('.filter'); if (!b) return;
  statusFilter = b.dataset.s; searchLimit = 60; buildChips(); renderSearch();
});
$('#q').addEventListener('input', () => { searchLimit = 60; renderSearch(); });

function renderSearch() {
  if (!DATA) return;
  const q = norm($('#q').value);
  const hits = [];
  for (let i = 0; i < DATA.rows.length; i++) {
    const r = DATA.rows[i];
    if (statusFilter && (r[STATI] || '(sin status)') !== statusFilter) continue;
    if (q && !norm(r[TAGI]).includes(q)) continue;
    hits.push(i);
  }
  const shown = hits.slice(0, searchLimit);
  $('#resCount').textContent = hits.length === DATA.rows.length ? `${hits.length.toLocaleString('es-ES')} cables` : `${hits.length.toLocaleString('es-ES')} de ${DATA.rows.length.toLocaleString('es-ES')}`;
  $('#results').innerHTML = shown.map(i => {
    const r = DATA.rows[i], st = STATI >= 0 ? r[STATI] : '', f = flags.get(r[TAGI]);
    const bits = [];
    if (f?.notes) bits.push(`${f.notes} ${f.notes === 1 ? 'nota' : 'notas'}`);
    if (f?.photos) bits.push(`${f.photos} ${f.photos === 1 ? 'foto' : 'fotos'}`);
    if (pdfsFor(r[TAGI]).length) bits.push('PDF');
    return `<button class="row ${statusClass(st)} ${i === current ? 'sel' : ''}" data-i="${i}"><span class="t">${esc(r[TAGI])}</span>
      <span class="m"><span class="s">${esc(st ? sentence(st) : 'Sin status')}</span>${bits.map(b => `<span>${b}</span>`).join('')}</span></button>`;
  }).join('') || '<p class="empty">Ningún cable coincide. Prueba con otra parte del tag o quita el filtro de status.</p>';
  if (hits.length > shown.length) {
    $('#results').insertAdjacentHTML('beforeend', `<button class="btn more" id="btnMore">Mostrar más (${hits.length - shown.length} restantes)</button>`);
  }
}
$('#results').addEventListener('click', e => {
  if (e.target.id === 'btnMore') { searchLimit += 100; renderSearch(); return; }
  const it = e.target.closest('.row'); if (it) openCable(+it.dataset.i, true);
});

/* ---------- PDF de pulling (los pone el propietario en Drive; aquí solo se leen) ---------- */
function hasTag(key, t) {
  let i = key.indexOf(t);
  while (i >= 0) {
    const prev = key[i - 1], next = key[i + t.length];
    const startOk = !prev || /[A-Z0-9]/.test(t[0]) === false || !/[A-Z0-9]/.test(prev);
    const endOk = !next || !/[A-Z0-9]/.test(next);   // que ...BR03 no coincida con ...BR030
    if (startOk && endOk) return true;
    i = key.indexOf(t, i + 1);
  }
  return false;
}
function pdfsFor(tag) {
  if (!PDFS.length) return [];
  const t = norm(tag), t2 = t.replace(/^#?HKF\./, '');
  return PDFS.filter(p => hasTag(p.key, t) || (t2 !== t && hasTag(p.key, t2)));
}
const setPdfs = (list, hash) => {
  // los espacios se conservan: marcan dónde termina el tag dentro del nombre del archivo
  PDFS = (list || []).map(p => ({ ...p, key: String(p.name).replace(/\.pdf$/i, '').toUpperCase().replace(/\s+/g, ' ') }));
  PDFHASH = hash || '';
};
async function ensurePdf(p) {
  const key = `pdf:${p.id}:${p.date}`;
  const hit = await DB.get('meta', key).catch(() => null);
  if (hit) return hit;
  const j = await apiGet('pdf', { id: p.id });
  const bin = atob(j.data), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const blob = new Blob([u8], { type: 'application/pdf' });
  await DB.put('meta', blob, key).catch(() => { });
  return blob;
}

/* ---------- Ficha del cable ---------- */
async function refreshFlags() {
  const [n, f] = await Promise.all([DB.all('notes'), DB.all('files')]);
  flags = new Map();
  const get = t => flags.get(t) || (flags.set(t, { notes: 0, photos: 0 }), flags.get(t));
  n.forEach(x => get(x.tag).notes++);
  f.filter(x => x.kind === 'photo').forEach(x => get(x.tag).photos++);
}

function renderEmpty() {
  if (current >= 0) return;
  $('#vBody').innerHTML = `<div class="d-empty"><h2>Ningún cable abierto</h2><p>Escanea un código o busca un tag y aquí verás su ficha, el PDF de pulling, las fotos y las notas.</p></div>`;
  $('#vAddList').hidden = true;
}

function openCable(i, animate) {
  current = i;
  $('#view').classList.add('open');
  $('#vAddList').hidden = false;
  cam.paused = !isWide();
  if (!isWide() && !(history.state && history.state.detail)) history.pushState({ detail: 1 }, '');
  renderCable(animate);
  $$('.row.sel').forEach(r => r.classList.remove('sel'));
  $$(`.row[data-i="${i}"]`).forEach(r => r.classList.add('sel'));
}

function closeCable() {
  $('#view').classList.remove('open');
  current = -1; cam.paused = false;
  renderEmpty(); renderSearch(); renderList();
}

async function renderCable(animate) {
  if (current < 0) return;
  const r = DATA.rows[current], tag = r[TAGI];
  const hideEmpty = LS.get('hideEmpty', false);
  const sel = colsSel('ficha');
  const newCols = LS.get('newCols', []);
  const st = STATI >= 0 ? r[STATI] : '';
  const stDate = DATEI >= 0 ? r[DATEI] : '';
  const [notes, files] = await Promise.all([DB.byTag('notes', tag), DB.byTag('files', tag)]);
  if (current < 0 || DATA.rows[current][TAGI] !== tag) return;   // se cerró o cambió mientras cargaba
  notes.sort((a, b) => b.date.localeCompare(a.date));
  const syncMark = x => x.localOnly ? '<span class="sync">Solo en este dispositivo</span>' : x.synced ? '<span class="sync ok">En la nube</span>' : (cloud.on() ? '<span class="sync wait">Pendiente de subir</span>' : '');
  const PIX = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

  const kv = sel.map(n => {
    const c = DATA.columns[COL.get(n)], v = r[COL.get(n)];
    if (hideEmpty && !v) return '';
    return `<div class="kv"><span class="l">${esc(c.letter)}</span><span class="n">${esc(c.name)}</span><span class="v ${v ? '' : 'none'}">${v ? esc(fmtVal(v)) : 'Sin dato'}</span></div>`;
  }).join('');

  const drivePdfs = pdfsFor(tag);
  const legacy = files.filter(f => f.kind === 'pdf');
  const photos = files.filter(f => f.kind === 'photo');
  const adm = cloud.admin();
  const pdfRows = drivePdfs.map(p => `<div class="item"><span class="nm">${esc(p.name)}<small>Actualizado ${esc(p.date)}</small></span><span class="go"><button class="btn small" data-pdf="${esc(p.id)}">Abrir</button>${adm ? `<button class="btn small danger" data-delpdf="${esc(p.id)}">Quitar</button>` : ''}</span></div>`).join('')
    + legacy.map(f => `<div class="item"><span class="nm">${esc(f.name)}${syncMark(f)}</span><span class="go"><button class="btn small" data-open="${f.id}">Abrir</button></span></div>`).join('');
  const pdfEmpty = !cloud.on() && !PDFS.length ? 'Conecta tu Google en Ajustes para ver los PDF de pulling.' : 'Todavía no hay PDF de pulling para este cable.';

  $('#vAddList').textContent = scanList.some(x => norm(x.tag) === norm(tag)) ? 'En la lista' : 'Añadir a la lista';
  $('#vBody').innerHTML = `
    <div class="d-top">
      <div class="marker ${animate ? 'pop' : ''}"><span class="sleeve"></span><span class="mk-body"><b>${esc(tag)}</b></span><button class="btn small quiet copy" id="btnCopyTag">Copiar</button></div>
      <div class="d-status ${statusClass(st)}"><i></i><div><b>${esc(st ? sentence(st) : 'Sin status')}</b>${stDate ? `<small>Desde ${esc(fmtVal(stDate))}</small>` : ''}</div></div>
    </div>

    <label class="opt"><input type="checkbox" id="hideEmpty" ${hideEmpty ? 'checked' : ''}> Ocultar las columnas sin dato</label>
    <div class="kvs">${kv || '<p class="empty">No hay columnas elegidas. Pulsa Columnas para elegirlas.</p>'}</div>

    <div class="sections">
      <div>
        <div class="sec"><h3>PDF de pulling</h3>
          ${pdfRows || `<p class="empty">${adm ? 'Todavía no hay PDF de pulling para este cable. Súbelo con el botón.' : pdfEmpty}</p>`}
          ${adm ? '<div class="btn-row"><button class="btn primary" id="addPdf">Subir PDF de pulling</button></div>' : ''}
        </div>
        <div class="sec" style="margin-top:28px"><h3>Fotos</h3>
          ${photos.length ? `<div class="photos">${photos.map(f => `<img data-photo="${f.id}" alt="${esc(f.name)}" ${f.blob ? `src="${URL.createObjectURL(f.blob)}"` : `src="${PIX}" data-lazy="1"`}>`).join('')}</div>` : '<p class="empty">Todavía no hay fotos de este cable.</p>'}
          <div class="btn-row"><button class="btn primary" id="addPhoto">Hacer foto</button><button class="btn" id="addPhotoGal">Elegir de la galería</button></div>
        </div>
      </div>
      <div class="sec"><h3>Notas</h3>
        <label class="field" style="margin-top:6px"><span>Nueva nota</span><textarea id="noteText" placeholder="Qué has visto o qué falta"></textarea></label>
        <div class="btn-row"><button class="btn primary" id="saveNote">Guardar nota</button></div>
        ${notes.map(n => `<div class="note"><div class="by"><span>${esc(new Date(n.date).toLocaleString('es-ES'))}${n.author ? ', ' + esc(n.author) : ''} ${syncMark(n)}</span><button class="btn small danger" data-deln="${n.id}">Borrar</button></div><p>${esc(n.text)}</p></div>`).join('')}
      </div>
    </div>`;

  // fotos que solo están en la nube: se descargan al abrir la ficha
  $$('#vBody img[data-lazy]').forEach(img => {
    const f = photos.find(p => p.id === +img.dataset.photo);
    ensureBlob(f).then(b => { img.src = URL.createObjectURL(b); img.removeAttribute('data-lazy'); })
      .catch(() => { img.alt = 'No disponible sin conexión'; });
  });
}

$('#vBody').addEventListener('click', async e => {
  const t = e.target.closest('button,img'); if (!t || current < 0) return;
  const tag = DATA.rows[current][TAGI];
  if (t.id === 'addPhoto') $('#filePhoto').click();
  else if (t.id === 'addPhotoGal') $('#filePhotoGal').click();
  else if (t.id === 'addPdf') $('#filePdf').click();
  else if (t.dataset.delpdf) {
    if (!confirm('¿Quitar este PDF? Se mueve a la papelera de tu Drive y desaparece para todos.')) return;
    try { await apiPost('delPdf', { id: t.dataset.delpdf }); await syncCloud(true); await renderCable(); toast('PDF quitado'); }
    catch (err) { toast('No se pudo quitar el PDF: ' + err.message, 5000); }
  }
  else if (t.id === 'btnCopyTag') { try { await navigator.clipboard.writeText(tag); toast('Tag copiado'); } catch { toast('No se pudo copiar el tag'); } }
  else if (t.id === 'saveNote') {
    const text = $('#noteText').value.trim();
    if (!text) return toast('Escribe algo en la nota antes de guardarla');
    await DB.put('notes', { uid: newUid(), tag, text, date: new Date().toISOString(), author: cloud.author(), synced: false });
    await refreshFlags(); await renderCable(); toast('Nota guardada');
    syncCloud(true);
  } else if (t.dataset.deln) {
    if (!confirm('¿Borrar esta nota? Se borrará también para el resto del equipo.')) return;
    const n = await DB.get('notes', +t.dataset.deln);
    if (n.synced && !(await cloudDelete('delNote', { id: n.uid }))) return;
    await DB.del('notes', n.id); await refreshFlags(); await renderCable();
  } else if (t.dataset.pdf) {
    const p = PDFS.find(x => x.id === t.dataset.pdf);
    const w = window.open('', '_blank');   // se abre ya, antes de descargar, para que el navegador no lo bloquee
    try {
      toast('Abriendo el PDF');
      const b = await ensurePdf(p);
      const url = URL.createObjectURL(b);
      if (w) w.location = url; else location.href = url;
    } catch (err) { if (w) w.close(); toast('No se pudo abrir el PDF: ' + err.message, 5000); }
  } else if (t.dataset.open) {
    const w = window.open('', '_blank');
    try {
      const f = await DB.get('files', +t.dataset.open);
      const b = await ensureBlob(f);
      const url = URL.createObjectURL(new Blob([b], { type: 'application/pdf' }));
      if (w) w.location = url; else location.href = url;
    } catch (err) { if (w) w.close(); toast('No se pudo abrir el PDF: ' + err.message, 4500); }
  } else if (t.dataset.photo) openLightbox(+t.dataset.photo);
});
$('#vBody').addEventListener('change', e => { if (e.target.id === 'hideEmpty') { LS.set('hideEmpty', e.target.checked); renderCable(); } });

$('#vBack').addEventListener('click', () => { if (history.state && history.state.detail) history.back(); else closeCable(); });
window.addEventListener('popstate', () => { if (!isWide() && current >= 0) closeCable(); });
$('#vAddList').addEventListener('click', () => {
  if (current < 0) return;
  const tag = DATA.rows[current][TAGI];
  if (scanList.some(x => norm(x.tag) === norm(tag))) return toast('Ese cable ya está en la lista');
  scanList.push({ tag, code: tag, found: true, time: new Date().toISOString() });
  LS.set('scanList', scanList); renderList(); $('#vAddList').textContent = 'En la lista'; toast('Añadido a la lista');
});

/* fotos */
async function addPhotos(fileList) {
  const tag = DATA.rows[current][TAGI];
  for (const f of fileList) {
    const blob = await shrinkImage(f);
    await DB.put('files', { uid: newUid(), tag, kind: 'photo', name: f.name || 'foto.jpg', type: blob.type, blob, date: new Date().toISOString(), author: cloud.author(), synced: false });
  }
  await refreshFlags(); await renderCable();
  toast(fileList.length > 1 ? 'Fotos guardadas' : 'Foto guardada');
  syncCloud(true);
}
$('#filePdf').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || current < 0) return;
  const tag = DATA.rows[current][TAGI];
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return toast('Elige un archivo PDF');
  if (f.size > 25 * 1024 * 1024) return toast('El PDF pesa más de 25 MB y no se puede subir desde la app', 5000);
  try {
    toast(`Subiendo ${f.name}`, 60000);
    const r = await apiPost('uploadPdf', { tag, name: f.name, data: await fileToB64(f) });
    await syncCloud(true);
    if (current >= 0 && DATA.rows[current][TAGI] === tag) await renderCable();
    toast(`PDF subido a Drive como "${r.name}"`, 4000);
  } catch (err) { toast('No se pudo subir el PDF: ' + err.message, 6000); }
});
$('#filePhoto').addEventListener('change', e => { if (e.target.files.length) addPhotos(e.target.files); e.target.value = ''; });
$('#filePhotoGal').addEventListener('change', e => { if (e.target.files.length) addPhotos(e.target.files); e.target.value = ''; });

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
  try {
    const b = await ensureBlob(f);
    lbId = id; $('#lbImg').src = URL.createObjectURL(b); $('#lightbox').hidden = false;
  } catch { toast('Esta foto no está disponible sin conexión'); }
}
$('#lbClose').addEventListener('click', () => { $('#lightbox').hidden = true; });
$('#lbDel').addEventListener('click', async () => {
  if (!confirm('¿Borrar esta foto? Se borrará también para el resto del equipo.')) return;
  const f = await DB.get('files', lbId);
  if (f.synced && !(await cloudDelete('delFile', { uid: f.uid }))) return;
  await DB.del('files', lbId); $('#lightbox').hidden = true; await refreshFlags(); renderCable();
});

/* ---------- Lista de escaneos ---------- */
const listColumns = () => colsSel('lista');

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
  $$('.count').forEach(c => { c.textContent = scanList.length; c.dataset.n = scanList.length; });
  const cols = listColumns();
  const nf = scanList.filter(x => !x.found).length;
  $('#listHint').textContent = scanList.length
    ? `${scanList.length} ${scanList.length === 1 ? 'código' : 'códigos'}${nf ? `, ${nf} sin encontrar` : ''}. Las columnas se eligen en Columnas, pestaña "En la lista y el Excel".`
    : 'La lista está vacía. Activa el modo lista en Escanear y lee varios códigos; aparecerán aquí.';
  const t = $('#listTable');
  t.innerHTML = '<thead><tr><th>#</th><th>Tag</th>' + cols.filter(n => n !== DATA.tagCol).map(n => `<th>${esc(n)}</th>`).join('') + '<th></th></tr></thead><tbody>' +
    scanList.map((x, n) => {
      const ri = IDX.get(norm(x.tag));
      return `<tr class="${x.found ? '' : 'nf'}" data-n="${n}"><td>${n + 1}</td><td class="tagc">${esc(x.tag)}</td>` +
        cols.filter(k => k !== DATA.tagCol).map(k => `<td>${ri === undefined ? '' : esc(fmtVal(DATA.rows[ri][COL.get(k)]))}</td>`).join('') +
        `<td><button class="x" data-del="${n}" aria-label="Quitar de la lista">✕</button></td></tr>`;
    }).join('') + '</tbody>';
}
$('#listTable').addEventListener('click', e => {
  const d = e.target.closest('[data-del]');
  if (d) { scanList.splice(+d.dataset.del, 1); LS.set('scanList', scanList); renderList(); return; }
  const tr = e.target.closest('tr[data-n]');
  if (tr) { const x = scanList[+tr.dataset.n]; const ri = IDX.get(norm(x.tag)); if (ri !== undefined) openCable(ri, true); }
});

function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const needList = () => scanList.length ? true : (toast('La lista está vacía. Escanea algunos cables primero.'), false);

$('#btnXlsx').addEventListener('click', async () => {
  if (!needList()) return;
  await attachNotesToList();
  const { head, rows } = listMatrix();
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  ws['!cols'] = head.map((h, i) => ({ wch: i === 2 ? 36 : Math.min(40, Math.max(10, String(h).length + 2)) }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'ESCANEOS');
  XLSX.writeFile(wb, `escaneos_${stamp()}.xlsx`);
});
$('#btnCsv').addEventListener('click', async () => {
  if (!needList()) return;
  await attachNotesToList();
  const { head, rows } = listMatrix();
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [head, ...rows].map(r => r.map(q).join(';')).join('\r\n');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `escaneos_${stamp()}.csv`);
});
$('#btnCopy').addEventListener('click', async () => {
  if (!needList()) return;
  await attachNotesToList();
  const { head, rows } = listMatrix();
  const tsv = [head, ...rows].map(r => r.map(v => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
  try { await navigator.clipboard.writeText(tsv); toast('Lista copiada. Pégala en Google Sheets con Ctrl+V.'); }
  catch { toast('No se pudo copiar. Descarga el Excel o el CSV.'); }
});
$('#btnSheet').addEventListener('click', async () => {
  if (!needList()) return;
  if (!cloud.on()) { toast('Conecta tu Google (URL y clave) en Ajustes', 4000); return; }
  await attachNotesToList();
  const { head, rows } = listMatrix();
  try {
    const j = await apiPost('scans', { sheet: LS.get('sheetName', 'ESCANEOS') || 'ESCANEOS', header: head, rows });
    toast(`Enviadas ${j.added} filas a tu Google Sheet`, 3500);
  } catch (e) { toast('No se pudo enviar la lista: ' + e.message, 4500); }
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
  const fresh = new Set(LS.get('newCols', []));
  $$('.segbtn').forEach(b => b.classList.toggle('active', b.dataset.target === pickerTarget));
  $('#cList').innerHTML = DATA.columns.map(c => (!f || norm(c.name).includes(f) || norm(c.letter) === f) ?
    `<label class="citem"><input type="checkbox" data-n="${esc(c.name)}" ${sel.has(c.name) ? 'checked' : ''}><b>${esc(c.letter)}</b><span>${esc(c.name)}</span>${fresh.has(c.name) ? '<em>Nueva</em>' : ''}</label>` : '').join('');
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
$('#cClose').addEventListener('click', () => { $('#colsModal').hidden = true; LS.set('newCols', []); if (current >= 0) renderCable(); });
$('#btnCols').addEventListener('click', () => DATA ? openCols() : toast('Todavía no hay tabla cargada'));

/* ---------- Ajustes ---------- */
function saveSettingsFields(start = true) {
  const u = $('#sScriptUrl').value.trim();
  LS.set('scriptUrl', u === CFG.scriptUrl ? '' : u); LS.set('cloudToken', $('#sToken').value.trim());   // si coincide con la de config.js no se guarda aparte
  connStatus();
  LS.set('author', $('#sAuthor').value.trim()); LS.set('adminToken', $('#sAdmin').value.trim());
  LS.set('sheetName', $('#sSheetName').value.trim() || 'ESCANEOS'); LS.set('csvUrl', $('#sCsvUrl').value.trim());
  if (start) startCloud();
}
$('#btnSettings').addEventListener('click', async () => {
  $('#setModal').hidden = false;
  $('#sCsvUrl').value = LS.get('csvUrl', ''); $('#sScriptUrl').value = scriptUrl(); $('#sToken').value = LS.get('cloudToken', '');
  $('#sAdmin').value = LS.get('adminToken', ''); $('#sAuthor').value = LS.get('author', ''); $('#sSheetName').value = LS.get('sheetName', 'ESCANEOS');
  const [n, f] = await Promise.all([DB.all('notes'), DB.all('files')]);
  const pend = n.filter(x => !x.synced).length + f.filter(x => !x.synced && !x.localOnly && x.kind === 'photo').length;
  $('#sInfo').textContent = (DATA ? `Tabla: ${DATA.rows.length} cables y ${DATA.columns.length} columnas, ${DATA.generado || ''}. ` : 'Sin tabla todavía. ')
    + (cloud.on() ? `Conectado. ${PDFS.length} PDF en Drive. Pendientes de subir: ${pend}.` : 'Falta solo la clave: escribe la que pusiste en TOKEN dentro del script.');
});
$('#sClose').addEventListener('click', () => { saveSettingsFields(); $('#setModal').hidden = true; });
$('#sPull').addEventListener('click', async () => { saveSettingsFields(false); await pullTable(false); });
$('#sSync').addEventListener('click', async () => { saveSettingsFields(false); await syncCloud(false); });
$('#sPing').addEventListener('click', async () => {
  saveSettingsFields(false);
  if (!cloud.on()) return toast('Falta la URL o la clave');
  try {
    const j = await apiGet('ping', LS.get('adminToken', '') ? { admin: LS.get('adminToken', '') } : {});
    toast(LS.get('adminToken', '') ? (j.admin ? 'Conexión correcta. Clave de administrador válida: puedes subir PDF.' : 'Conexión correcta, pero la clave de administrador no coincide con ADMIN_TOKEN.') : 'Conexión correcta con tu Google', 5000);
  }
  catch (e) { toast('No se pudo conectar: ' + e.message, 5000); }
});
$('#sImport').addEventListener('click', () => $('#fileExcel').click());
$('#fileExcel').addEventListener('change', e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });
$('#sRepo').addEventListener('click', reloadRepo);
$('#sCsv').addEventListener('click', importCsvUrl);
$('#sExportJson').addEventListener('click', () => {
  if (!DATA) return toast('No hay tabla que exportar');
  const { fuente, hash, ...out } = DATA;
  download(new Blob([JSON.stringify(out)], { type: 'application/json' }), 'data.json');
  toast('data.json descargado. Súbelo a GitHub con ese mismo nombre.', 4500);
});

/* copia de seguridad (solo notas y fotos) */
const blobToDataUrl = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
$('#sBackup').addEventListener('click', async () => {
  const notes = await DB.all('notes'), files = await DB.all('files');
  const fx = []; for (const f of files) if (f.blob) fx.push({ ...f, id: undefined, blob: undefined, data: await blobToDataUrl(f.blob) });
  const out = { v: 1, date: new Date().toISOString(), notes: notes.map(n => ({ ...n, id: undefined })), files: fx, scanList };
  download(new Blob([JSON.stringify(out)], { type: 'application/json' }), `cablescan_copia_${stamp()}.json`);
});
$('#sRestore').addEventListener('click', () => $('#fileBackup').click());
$('#fileBackup').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const j = JSON.parse(await file.text());
    for (const n of j.notes || []) await DB.put('notes', { ...n, uid: newUid(), synced: false });
    for (const f of j.files || []) { const blob = await (await fetch(f.data)).blob(); const { data, ...rest } = f; await DB.put('files', { ...rest, blob, uid: newUid(), synced: false }); }
    if (j.scanList?.length) { scanList = j.scanList; LS.set('scanList', scanList); }
    syncCloud(true);
    await refreshFlags(); renderList(); renderSearch(); toast('Copia restaurada');
  } catch (err) { toast('Ese archivo no es una copia válida: ' + err.message, 4500); }
});
$('#sNotesXlsx').addEventListener('click', async () => {
  const notes = await DB.all('notes'), files = await DB.all('files');
  if (!notes.length) return toast('Todavía no hay notas');
  const rows = notes.sort((a, b) => a.tag.localeCompare(b.tag) || a.date.localeCompare(b.date))
    .map(n => [n.tag, new Date(n.date).toLocaleString('es-ES'), n.author || '', n.text, files.filter(f => f.tag === n.tag && f.kind === 'photo').length]);
  const ws = XLSX.utils.aoa_to_sheet([['CABLE_NUMBER', 'Fecha', 'Autor', 'Nota', 'Fotos'], ...rows]);
  ws['!cols'] = [{ wch: 36 }, { wch: 18 }, { wch: 14 }, { wch: 60 }, { wch: 7 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'NOTAS');
  XLSX.writeFile(wb, `notas_${stamp()}.xlsx`);
});

/* ---------- Escáner móvil: aviso de lectura, enfoque al tocar, pantalla encendida ---------- */
let flashT;
function camFlash(kind) {
  const f = $('#camFlash'); if (!f) return;
  f.className = 'flash ' + kind; void f.offsetWidth; f.classList.add('go');
  clearTimeout(flashT); flashT = setTimeout(() => f.classList.remove('go'), 450);
}
let wake = null;
async function keepAwake(on) {
  try {
    if (on && navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
    else if (!on && wake) { await wake.release(); wake = null; }
  } catch { }
}
$('#videoWrap').addEventListener('click', async e => {
  if (e.target.closest('button') || !cam.stream) return;
  const t = cam.stream.getVideoTracks()[0], caps = t.getCapabilities ? t.getCapabilities() : {};
  if (!caps.focusMode) return;
  const box = $('#videoWrap').getBoundingClientRect(), ring = $('#focusRing');
  ring.style.left = (e.clientX - box.left) + 'px'; ring.style.top = (e.clientY - box.top) + 'px';
  ring.hidden = false; ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go');
  setTimeout(() => { ring.hidden = true; }, 900);
  try {
    const adv = { focusMode: caps.focusMode.includes('single-shot') ? 'single-shot' : 'continuous' };
    if (caps.pointsOfInterest) adv.pointsOfInterest = [{ x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height }];
    await t.applyConstraints({ advanced: [adv] });
    if (adv.focusMode === 'single-shot' && caps.focusMode.includes('continuous')) setTimeout(() => t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => { }), 1500);
  } catch { }
});
$('#btnCamClose').addEventListener('click', () => stopCam(true));
$('#camType').addEventListener('click', () => { stopCam(true); $('#scanInput').focus(); $('#scanInput').scrollIntoView({ block: 'center' }); });
const syncListChip = () => { const on = $('#listMode').checked; $('#camListChip').setAttribute('aria-pressed', on); $('#camListChip').textContent = on ? 'Modo lista: sí' : 'Modo lista'; };
$('#camListChip').addEventListener('click', () => { const m = $('#listMode'); m.checked = !m.checked; m.dispatchEvent(new Event('change')); });

/* ---------- Entradas de escaneo ---------- */
$('#btnCam').addEventListener('click', () => cam.on ? stopCam(true) : startCam());
$('#btnTorch').addEventListener('click', toggleTorch);
$('#btnZoom').addEventListener('click', cycleZoom);
$('#btnSwitchCam').addEventListener('click', switchCam);
$('#manualForm').addEventListener('submit', e => {
  e.preventDefault();
  const i = $('#scanInput'); const v = i.value; i.value = '';
  lastHandled = { code: '', t: 0 }; handleCode(v);
});
$('#listMode').checked = LS.get('listMode', false);
$('#listMode').addEventListener('change', e => { LS.set('listMode', e.target.checked); syncListChip(); });
syncListChip();
// al salir de la app la cámara se apaga; al volver se reanuda sola si estaba activa
document.addEventListener('visibilitychange', () => {
  if (document.hidden && cam.on) { cam.resume = true; stopCam(false); }
  else if (!document.hidden && cam.resume) { cam.resume = false; startCam(); }
});

/* ---------- Nube: Google Sheets + Drive vía Apps Script ---------- */
const cloud = {
  on: () => !!(scriptUrl() && LS.get('cloudToken', '')),
  admin: () => !!(scriptUrl() && LS.get('cloudToken', '') && LS.get('adminToken', '')),   // solo quien tiene la clave de administrador ve los botones de PDF
  author: () => LS.get('author', ''),
};
const MAX_CLOUD = 15 * 1024 * 1024;   // fotos mayores se quedan solo en el dispositivo
const newUid = () => (crypto.randomUUID ? crypto.randomUUID() : 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

async function apiGet(action, params = {}) {
  const q = new URLSearchParams({ action, token: LS.get('cloudToken', ''), ...params });
  const r = await fetch(scriptUrl() + '?' + q);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'error del servidor');
  return j;
}
async function apiPost(action, payload = {}) {
  const r = await fetch(scriptUrl(), {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: LS.get('cloudToken', ''), ...(/Pdf$/.test(action) ? { admin: LS.get('adminToken', '') } : {}), ...payload }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'error del servidor');
  return j;
}
const fileToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });

/* Tabla desde la hoja de Google (solo lectura); solo se descarga si cambió */
async function pullTable(silent) {
  if (!cloud.on()) { if (!silent) toast('Conecta tu Google (URL y clave) en Ajustes', 4000); return false; }
  try {
    if (!silent) toast('Comprobando la tabla en Google Sheets', 6000);
    const have = DATA && DATA.fuente === 'cloud' && DATA.hash ? DATA.hash : '';
    const j = await apiGet('data', have ? { hash: have } : {});
    if (j.same) { if (!silent) toast('La tabla ya está al día'); return true; }
    const d = { generado: j.generado, origen: 'Google Sheet', hoja: j.hoja, tagCol: 'CABLE_NUMBER', columns: j.columns, rows: j.rows, fuente: 'cloud', hash: j.hash };
    await DB.put('meta', d, 'data');
    setData(d, 'cloud');
    if (!silent) toast(`Tabla actualizada: ${d.rows.length} cables`);
    return true;
  } catch (e) { if (!silent) toast('No se pudo leer la hoja: ' + e.message, 5000); return false; }
}

/* Fotos que solo existen en la nube: se descargan al necesitarlas */
const inflight = new Map();
function ensureBlob(f) {
  if (f.blob) return Promise.resolve(f.blob);
  if (inflight.has(f.uid)) return inflight.get(f.uid);
  const p = (async () => {
    const j = await apiGet('file', { uid: f.uid });
    const bin = atob(j.data), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    f.blob = new Blob([u8], { type: j.mime || f.type || '' });
    await DB.put('files', f);
    return f.blob;
  })().finally(() => inflight.delete(f.uid));
  inflight.set(f.uid, p);
  return p;
}

/* Borrado en la nube; devuelve true si se puede borrar también en local */
async function cloudDelete(action, payload) {
  if (!cloud.on()) return true;
  try { await apiPost(action, payload); return true; }
  catch (e) { toast('No se pudo borrar en la nube. Comprueba la conexión y vuelve a intentarlo.', 4500); return false; }
}

/* Sincronización: sube lo pendiente y trae lo de los demás */
let syncing = false, resync = false, cloudStarted = false;
function startCloud() {
  if (cloudStarted || !cloud.on()) return;
  cloudStarted = true;
  pullTable(true).then(() => syncCloud(true));
  window.addEventListener('online', () => syncCloud(true));
  setInterval(() => { if (!document.hidden) syncCloud(true); }, 90000);
}
async function syncCloud(silent) {
  if (!cloud.on()) return;
  if (syncing) { resync = true; return; }
  if (!navigator.onLine) { if (!silent) toast('Sin conexión. Se sincronizará al volver.'); return; }
  syncing = true;
  try {
    const [ln, lf] = await Promise.all([DB.all('notes'), DB.all('files')]);
    for (const n of ln) {
      if (n.synced) continue;
      if (!n.uid) n.uid = newUid();
      await apiPost('addNote', { id: n.uid, tag: n.tag, text: n.text, date: n.date, author: n.author || '' });
      n.synced = true; await DB.put('notes', n);
    }
    for (const f of lf) {
      if (f.synced || f.localOnly || !f.blob) continue;
      if (!f.uid) f.uid = newUid();
      if (f.kind !== 'photo' || f.blob.size > MAX_CLOUD) {
        f.localOnly = true; await DB.put('files', f);
        if (!silent && f.kind === 'photo') toast(`"${f.name}" pesa más de 15 MB y se queda solo en este dispositivo`, 5000);
        continue;
      }
      await apiPost('upload', { uid: f.uid, tag: f.tag, kind: 'photo', name: f.name, mime: f.type || f.blob.type || '', date: f.date, author: f.author || '', data: await fileToB64(f.blob) });
      f.synced = true; await DB.put('files', f);
    }

    const s = await apiGet('sync', PDFHASH ? { pdfHash: PDFHASH } : {});
    if (s.pdfs) { setPdfs(s.pdfs, s.pdfHash); await DB.put('meta', { hash: s.pdfHash, list: s.pdfs }, 'pdfs'); }
    const notes = await DB.all('notes'), files = await DB.all('files');
    const nUid = new Set(notes.map(x => x.uid)), fUid = new Set(files.map(x => x.uid));
    const rn = new Set(s.notes.map(x => x.id)), rf = new Set(s.files.map(x => x.uid));
    for (const n of s.notes) if (!nUid.has(n.id)) await DB.put('notes', { uid: n.id, tag: n.tag, text: n.text, date: n.date, author: n.author, synced: true });
    for (const f of s.files) if (!fUid.has(f.uid)) await DB.put('files', { uid: f.uid, tag: f.tag, kind: f.kind, name: f.name, type: f.mime, date: f.date, author: f.author, synced: true });
    for (const n of notes) if (n.synced && !rn.has(n.uid)) await DB.del('notes', n.id);          // borrada por otra persona
    for (const f of files) if (f.synced && !rf.has(f.uid)) await DB.del('files', f.id);
    await refreshFlags(); renderSearch();
    if (current >= 0 && !($('#noteText') && $('#noteText').value)) await renderCable();
    if (!silent) toast('Notas, fotos y PDF sincronizados');
  } catch (e) { if (!silent) toast('No se pudo sincronizar: ' + e.message, 5000); }
  finally { syncing = false; if (resync) { resync = false; syncCloud(true); } }
}

/* ---------- Instalar como app ---------- */
let deferredInstall = null;
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function updateInstallUI() { const h = standalone() || !(deferredInstall || isIos()); $('#btnInstall').hidden = h; $('.snav[data-proxy="btnInstall"]').hidden = h; }
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; updateInstallUI(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; updateInstallUI(); toast('App instalada'); });
$('#btnInstall').addEventListener('click', async () => {
  if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => { }); deferredInstall = null; updateInstallUI(); }
  else toast('En Safari: pulsa Compartir y después Añadir a pantalla de inicio.', 7000);
});

/* ---------- Utilidades ---------- */
let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- Atajos (escritorio) ---------- */
let lastKeyT = 0;
document.addEventListener('keydown', e => {
  const gap = Date.now() - lastKeyT; lastKeyT = Date.now();
  const tgt = e.target, typing = tgt && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tgt.tagName);
  if (e.key === 'Escape') {
    if (!$('#lightbox').hidden) $('#lbClose').click();
    else if (!$('#colsModal').hidden) $('#cClose').click();
    else if (!$('#setModal').hidden) $('#sClose').click();
    else if (typing && tgt.id === 'q') { tgt.value = ''; tgt.blur(); searchLimit = 60; renderSearch(); }
    else if (current >= 0 && $('#view').classList.contains('open')) $('#vBack').click();
    return;
  }
  if (e.key === '/' && gap > 250 && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setTab('search'); $('#q').focus(); $('#q').select(); }
});

/* ---------- Arranque ---------- */
(async function init() {
  try { navigator.storage?.persist?.(); } catch { }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  paintVersion(); connStatus();
  window.addEventListener('online', connStatus); window.addEventListener('offline', connStatus);
  if ('serviceWorker' in navigator) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) toast(`App actualizada${APP_VERSION ? ' a la versión ' + APP_VERSION : ''}. Recarga para ver los cambios.`, 6000); });
  }
  if (!cloud.on() && scriptUrl()) setTimeout(() => toast('Falta la clave de conexión. Escríbela en Ajustes.', 6000), 1200);
  updateInstallUI();
  const tab = new URLSearchParams(location.search).get('tab');
  if (['scan', 'search', 'list'].includes(tab)) setTab(tab);
  renderEmpty();
  await refreshFlags().catch(() => { });
  const pdfs = await DB.get('meta', 'pdfs').catch(() => null);
  if (pdfs) setPdfs(pdfs.list, pdfs.hash);
  await loadData();
  startCloud();
  // en el móvil, si la cámara estaba activa y ya hay permiso, se abre sola
  try {
    const perm = navigator.permissions ? await navigator.permissions.query({ name: 'camera' }) : null;
    if (!isWide() && LS.get('camAuto', false) && $('#app').dataset.tab === 'scan' && perm && perm.state === 'granted') startCam();
  } catch { }
})();
