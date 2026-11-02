/**
 * CABLE SCAN — servidor en tu Google (Sheets + Drive), sin coste y sin credenciales de Google Cloud.
 *
 * Quién puede hacer qué
 *  - TÚ (propietario): editas la tabla (pestaña CABLEADO) y pones los PDF en la carpeta de Drive,
 *    o los subes desde la app escribiendo tu ADMIN_TOKEN en Ajustes.
 *  - EL EQUIPO (app): solo LEE la tabla y los PDF; puede AÑADIR notas y fotos a cada tag.
 *    Sin ADMIN_TOKEN la app no puede subir ni quitar PDF, y nadie puede modificar la tabla. El equipo ni siquiera
 *    necesita acceso a tu Sheet ni a tu Drive, solo la URL de la app y la clave.
 *
 * Instalación (5 minutos, una sola vez)
 *  1) Sube tu Excel a Google Drive y ábrelo con Google Sheets. La pestaña con la tabla debe llamarse
 *     CABLEADO y tener los encabezados en la fila 1 (incluida CABLE_NUMBER).
 *  2) En esa hoja: Extensiones -> Apps Script. Borra lo que haya y pega TODO este archivo.
 *  3) Cambia la clave TOKEN de abajo por una frase larga y secreta (la misma que pondrás en la app).
 *  4) Arriba elige la función "autorizar" y pulsa Ejecutar. Acepta los permisos
 *     (si aparece "Google no ha verificado esta app": Configuración avanzada -> Ir a ... (no seguro);
 *     es tu propio script). Se crean las pestañas NOTAS, ARCHIVOS y PDF_INDEX y las carpetas en tu Drive.
 *  5) Implementar -> Nueva implementación -> tipo "Aplicación web".
 *       Ejecutar como: Yo        Quién tiene acceso: Cualquier usuario
 *     Copia la URL que termina en /exec y pégala, con la clave, en la app (ajustes).
 *
 * PDF de pulling
 *  - Copia los PDF en la carpeta de Drive "CableScan_PDF" (se admiten subcarpetas).
 *  - El nombre del archivo debe contener el tag completo del cable, por ejemplo:
 *      #HKF.BW41=731.CKA32-BR03.WG20.pdf    o    Pulling #HKF.BW41=731.CKA32-BR03.WG20 rev2.pdf
 *    (da igual mayúsculas/minúsculas y espacios). Un PDF puede servir a varios cables si su nombre
 *    incluye varios tags.
 *  - La app los ve al actualizarse el índice: pasa solo cada 30 minutos si activas el índice automático
 *    (menú "Cable Scan" de la hoja -> "Activar índice automático de PDF"), o al momento con
 *    "Actualizar índice de PDF".
 *  - Si ya tienes los PDF en otra carpeta, pon su ID en PDF_FOLDER_ID (el texto final de la URL de la carpeta).
 *
 * Tabla creciente: añade filas y columnas en CABLEADO cuando quieras. La app las recoge sola; las columnas
 * nuevas se pueden activar en su selector de columnas.
 *
 * Si cambias este código más adelante: Implementar -> Administrar implementaciones -> editar -> Nueva versión.
 *
 * Seguridad: la URL /exec es pública, pero todas las acciones exigen la clave TOKEN. No la subas a GitHub
 * ni la compartas con quien no deba ver los datos.
 */

var TOKEN = 'CAMBIA-ESTA-CLAVE-POR-UNA-FRASE-LARGA';
var HOJA_DATOS = 'CABLEADO';
var HOJA_NOTAS = 'NOTAS';
var HOJA_ARCHIVOS = 'ARCHIVOS';
var HOJA_PDF = 'PDF_INDEX';
var HOJA_SCHEDULE = 'CC_SCHEDULE';   // lista total de cables del proyecto
var ESTADOS_EXCLUIDOS = ['DAMAGED', 'SPARE'];   // del CC_SCHEDULE (columna CURRENT_STATUS) no se cuentan
var CC_COLUMNAS = ['Installer', 'CABLE_NUMBER', 'REVISION', 'Hold', 'Priority', 'From_Tag', 'From_Description', 'From_Room_Number', 'From_Area',
  'To_Tag', 'To_Description', 'To_Room_Number', 'To_Area', 'Level', 'Cable_Routing', 'Cable_Routing_Produc', 'Real Length', 'Cable_Type', 'System',
  'Comments', 'Design', 'Discipline', 'CURRENT_SUBCONTRACTOR', 'CURRENT_STATUS', 'Pulledby_date', 'Released_CT', 'Tag_From_To', 'Area_From-To',
  'Room_From-To', 'Pasante', 'Locked'];   // columnas del CC_SCHEDULE que se llevan a la app para buscar cables de todo el proyecto
var DISCIPLINA_FILTRO = 'INS';       // solo cuentan los cables con esta Discipline (INS = instrumentación). Vacío = todos
var CARPETA_FOTOS = 'CableScan_Fotos';
var CARPETA_PDF = 'CableScan_PDF';
var CARPETA_ISO = 'CableScan_PDF_Isometrico_Bandeja';
var CARPETA_TRANSIT = 'CableScan_PDF_Transit';
var CARPETA_SEP = 'CableScan_PDF_Separadores';
var ADMIN_TOKEN = '';           // clave SOLO TUYA para subir y quitar PDF desde la app. Vacía = esa función está desactivada.
var PDF_FOLDER_ID = '';          // opcional: ID de una carpeta de Drive que ya tengas con los PDF
var MAX_PDF_BYTES = 30 * 1024 * 1024;

/* ---- seguridad ----
   ABIERTO_SIN_PERSONAL: false = si la pestaña PERSONAL está vacía NO se sirve nada (solo el administrador con ADMIN_TOKEN).
   MAX_FALLOS: códigos incorrectos permitidos en 10 minutos; al pasarlos se bloquean las entradas nuevas durante BLOQUEO_S segundos
   (quien ya estaba dentro sigue trabajando). Todo queda en la pestaña SEGURIDAD_LOG. */
var ABIERTO_SIN_PERSONAL = false;
var MAX_FALLOS = 30;
var BLOQUEO_S = 600;
var MAX_FOTO_BYTES = 8 * 1024 * 1024;
var HOJA_SEG = 'SEGURIDAD_LOG';
var H_SEG = ['fecha', 'evento', 'detalle'];

var H_NOTAS = ['id', 'tag', 'nota', 'fecha', 'autor', 'estado', 'revision', 'revisado_por', 'fecha_revision'];
var HOJA_ALM_IN = 'ENTRADA_ALM_BW';   // ingreso de materiales, equipos e insumos al almacén
var HOJA_ALM_OUT = 'SALIDA_ALM_BW';   // salida de materiales, equipos e insumos del almacén
var HOJA_PERSONAL = 'PERSONAL';
var H_PERSONAL = ['codigo', 'nombre', 'cargo', 'activo', 'editar_notas', 'editar_conexionado', 'admin'];
var HOJA_CONEX = 'CONEXIONADO';          // pestaña del sistema de conexionado; las columnas con cabecera verde (#00B050) son las editables
var HOJA_CONEX_LOG = 'CONEXIONADO_LOG';
var H_CONEX_LOG = ['id', 'fecha', 'cable', 'columna', 'antes', 'despues', 'autor', 'estado', 'revisado_por', 'fecha_revision'];
var CONEX_EDITABLES = ['MarcaCampo_From', 'STATUS_FROM', 'FECHA_STATUS_FROM', 'MarcaCampo_To', 'STATUS_TO', 'FECHA_STATUS_TO', 'OBSERVACION'];   // por si no se detecta el color
var CONEX_ESTADOS = ['COIL', 'FALTA', 'IMPUTADO', 'NO ENCONTRADO', 'PENDING', 'POR IMPUTAR', 'REASIGNADO'];   // por si no existe el rango STATUS_FROM_TO
var H_ARCH = ['uid', 'archivo_id', 'tag', 'tipo', 'nombre', 'mime', 'fecha', 'autor'];
var H_PDF = ['id', 'nombre', 'modificado', 'tipo', 'carpeta'];
var ERRORES = { '#REF!': 1, '#N/A': 1, '#VALUE!': 1, '#DIV/0!': 1, '#NAME?': 1, '#NUM!': 1, '#NULL!': 1 };

function doGet(e) { return handle_((e && e.parameter) || {}); }

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return out_({ ok: false, error: 'JSON inválido' }); }
  return handle_(body);
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(p) {
  try {
    if (TOKEN.indexOf('CAMBIA-ESTA') === 0) return out_({ ok: false, error: 'Falta cambiar la clave TOKEN en el script' });
    if (!p.token || p.token !== TOKEN) return out_({ ok: false, error: 'Clave incorrecta' });
    var list = personal_(), me = null;
    if (p.action !== 'ping' && list.length) {
      var au = auth_(list, p.user);
      if (au.fail) return out_({ ok: false, login: true, error: au.fail });
      me = au.me;
    }
    var adm = isAdmin_(p) || !!(me && me.admin);
    if (p.action !== 'ping' && !list.length && !ABIERTO_SIN_PERSONAL && !adm)
      return out_({ ok: false, error: 'Falta rellenar la pestaña PERSONAL con al menos un código. Mientras esté vacía, la app no sirve datos' });
    if (p.action === 'login' && me) logSeg_('entrada', me.nombre + (adm ? ' (admin)' : ''));
    var canEdit = !list.length || adm || !!(me && me.notas);
    var canConex = !list.length || adm || !!(me && me.conex);
    if (p.action === 'setConex' || p.action === 'undoAvance') {
      if (!canConex) throw new Error('Tu código no tiene permiso para editar el conexionado');
      if (me) p.author = me.nombre;
      p.adm = adm; p.ident = !!me;   // lo decide el servidor, nunca el teléfono
    }
    if (/^(addNote|delNote|upload|delFile|clearScans)$/.test(p.action)) {
      if (!canEdit) throw new Error('Tu código no tiene permiso para editar notas, fotos ni status');
      if (me) p.author = me.nombre;
      p.adm = adm; p.ident = !!me;   // el borrado por autor solo se exige si hay personal identificado
    }
    switch (p.action) {
      case 'login': return out_({ ok: true, open: !list.length, nombre: me ? me.nombre : '', cargo: me ? me.cargo : '', notas: canEdit, conex: canConex, admin: adm });
      case 'ping': return out_({ ok: true, admin: isAdmin_(p) });
      case 'data': return out_(getData_(p.hash));
      case 'sync': return out_(getSync_(p.pdfHash, { nombre: me ? me.nombre : '', notas: canEdit, conex: canConex, admin: adm }));
      case 'schedule': return out_(getSchedule_(p.hash));
      case 'routes': return out_(getRoutes_(p.hash));
      case 'ccdata': return out_(getCC_(p.hash));
      case 'conex': return out_(getConex_(p.hash));
      case 'almacen': return out_(getAlmacen_(p.hash));
      case 'file': return out_(getFile_(p.uid));
      case 'pdf': return out_(getPdf_(p.id));
      case 'revNotas': case 'marcarAvances':
        if (!adm) throw new Error('Solo el administrador puede marcar avances');
      case 'uploadPdf': case 'delPdf':
        if (p.action !== 'marcarAvances' && p.action !== 'revNotas')
        if (!adm) throw new Error(ADMIN_TOKEN ? 'Clave de administrador incorrecta' : 'Subir PDF desde la app está desactivado: pon un ADMIN_TOKEN en el script');
      case 'addNote': case 'delNote': case 'upload': case 'delFile': case 'scans': case 'clearScans': case 'setConex': case 'undoAvance':
        var lock = LockService.getScriptLock();
        lock.waitLock(25000);
        try { return out_(write_(p)); } finally { lock.releaseLock(); }
      default: return out_({ ok: false, error: 'Acción desconocida' });
    }
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ---------- personal (pestaña PERSONAL: codigo, nombre, cargo, activo SI/NO, editar_notas SI/NO) ---------- */
function yes_(v) { var x = String(v).trim().toUpperCase(); return x === 'SI' || x === 'SÍ' || x === 'S' || x === 'TRUE' || x === '1' || x === 'X'; }
function personal_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_PERSONAL);
  if (!sh || sh.getLastRow() < 2) return [];
  return rows_(sh).filter(function (r) { return String(r[0]).trim(); }).map(function (r) {
    return { codigo: String(r[0]).trim().toUpperCase(), nombre: String(r[1]).trim(), cargo: String(r[2] || '').trim(), activo: yes_(r[3]), notas: yes_(r[4]), conex: yes_(r[5]), admin: yes_(r[6]) };
  });
}
function findPerson_(list, code) {
  var c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  for (var i = 0; i < list.length; i++) if (list[i].codigo === c) return list[i];
  return null;
}

/* ---------- utilidades ---------- */
function isAdmin_(p) { return !!ADMIN_TOKEN && ADMIN_TOKEN.indexOf('CAMBIA-ESTA') !== 0 && p.admin === ADMIN_TOKEN; }

function colLetter_(i) {
  var s = ''; i++;
  while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/* texto escrito por usuarios: que Sheets nunca lo interprete como fórmula (=, +, -, @) */
function safe_(v, max) {
  var t = String(v == null ? '' : v);
  if (max && t.length > max) t = t.slice(0, max);
  return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
}
function logSeg_(evento, detalle) {
  try {
    var sh = sheet_(HOJA_SEG, H_SEG);
    sh.appendRow([Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'), evento, safe_(detalle, 300)]);
  } catch (e) { }
}
/* valida el código de personal con freno a los intentos de adivinarlo */
function auth_(list, code) {
  var cache = CacheService.getScriptCache(), me = findPerson_(list, code);
  var key = 'ok:' + md5_(String(code || '').trim().toUpperCase());
  var locked = !!cache.get('lock');
  if (me && me.activo && (!locked || cache.get(key))) { if (!cache.get(key)) cache.put(key, '1', 21600); return { me: me }; }
  var n = Number(cache.get('fails') || 0) + 1;
  cache.put('fails', String(n), 600);
  if (n <= 40) logSeg_(locked ? 'intento durante bloqueo' : 'código incorrecto', 'intento ' + n);
  if (n >= MAX_FALLOS && !locked) { cache.put('lock', '1', BLOQUEO_S); logSeg_('BLOQUEO', 'demasiados códigos incorrectos: entradas nuevas bloqueadas ' + Math.round(BLOQUEO_S / 60) + ' min'); }
  Utilities.sleep(700);
  return { fail: locked ? 'Demasiados intentos. Espera unos minutos y vuelve a probar' : 'Código de personal no válido o desactivado' };
}

function md5_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
}

function sheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), header.length).setNumberFormat('@'); // todo como texto
    sh.appendRow(header);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
  return sh;
}

function rows_(sh) {
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues();
}

function findRow_(sh, id) {
  if (!id) return null;
  return sh.getRange('A:A').createTextFinder(String(id)).matchEntireCell(true).findNext();
}

function namedFolder_(propKey, name) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(propKey);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
  var it = DriveApp.getFoldersByName(name);
  var f = it.hasNext() ? it.next() : DriveApp.createFolder(name);
  props.setProperty(propKey, f.getId());
  return f;
}
function fotosFolder_() { return namedFolder_('FOLDER_FOTOS', CARPETA_FOTOS); }
var CARPETAS_SIS = { fds:['FOLDER_FDS','CableScan_PDF_FDS'], hvac:['FOLDER_HVAC','CableScan_PDF_HVAC'], tierra:['FOLDER_TIERRA','CableScan_PDF_Tierra'], proc:['FOLDER_PROC','CableScan_PDF_Procesos'] };
function sisFolder_(t) { return namedFolder_(CARPETAS_SIS[t][0], CARPETAS_SIS[t][1]); }
function isoFolder_() { return namedFolder_('FOLDER_ISO', CARPETA_ISO); }
function transitFolder_() { return namedFolder_('FOLDER_TRANSIT', CARPETA_TRANSIT); }
function sepFolder_() { return namedFolder_('FOLDER_SEP', CARPETA_SEP); }
function pdfFolder_() { return PDF_FOLDER_ID ? DriveApp.getFolderById(PDF_FOLDER_ID) : namedFolder_('FOLDER_PDF', CARPETA_PDF); }

/** Ejecútala una vez desde el editor: concede permisos, crea pestañas y carpetas e indexa los PDF. */
function autorizar() {
  sheet_(HOJA_NOTAS, H_NOTAS);
  sheet_(HOJA_ARCHIVOS, H_ARCH);
  sheet_(HOJA_PDF, H_PDF);
  var shp = sheet_(HOJA_PERSONAL, H_PERSONAL);
  shp.getRange(1, 1, 1, H_PERSONAL.length).setValues([H_PERSONAL]);
  var shl = sheet_(HOJA_CONEX_LOG, H_CONEX_LOG);
  shl.getRange(1, 1, 1, H_CONEX_LOG.length).setValues([H_CONEX_LOG]);
  var shn = sheet_(HOJA_NOTAS, H_NOTAS);
  shn.getRange(1, 1, 1, H_NOTAS.length).setValues([H_NOTAS]);
  fotosFolder_();
  pdfFolder_();
  isoFolder_();
  transitFolder_();
  sepFolder_();
  for (var kt in CARPETAS_SIS) sisFolder_(kt);
  indexarPdf();
  Logger.log('Listo. Ya puedes implementar como aplicación web.');
}

/* ---------- índice de PDF (lo mantienes tú desde Drive) ---------- */
function indexarPdf() {
  var out = [];
  function walk(folder, tipo, path) {
    var files = folder.getFilesByType(MimeType.PDF);
    while (files.hasNext()) {
      var f = files.next();
      out.push([f.getId(), f.getName(), Utilities.formatDate(f.getLastUpdated(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'), tipo, path]);
    }
    var subs = folder.getFolders();
    while (subs.hasNext()) { var sf = subs.next(); walk(sf, tipo, path ? path + ' / ' + sf.getName() : sf.getName()); }
  }
  walk(pdfFolder_(), 'pulling', '');
  walk(isoFolder_(), 'iso', '');
  walk(transitFolder_(), 'transit', '');
  walk(sepFolder_(), 'sep', '');
  for (var kt in CARPETAS_SIS) walk(sisFolder_(kt), kt, '');
  var sh = sheet_(HOJA_PDF, H_PDF);
  sh.getRange(1, 1, 1, H_PDF.length).setValues([H_PDF]);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, H_PDF.length).clearContent();
  if (out.length) sh.getRange(2, 1, out.length, H_PDF.length).setValues(out);
  return out.length;
}

function activarIndiceAutomatico() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'indexarPdf') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('indexarPdf').timeBased().everyMinutes(30).create();
  SpreadsheetApp.getActiveSpreadsheet().toast('Índice de PDF automático cada 30 minutos', 'Cable Scan', 6);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Cable Scan')
    .addItem('Actualizar índice de PDF', 'actualizarIndiceAhora_')
    .addItem('Activar índice automático de PDF', 'activarIndiceAutomatico')
    .addToUi();
}
function actualizarIndiceAhora_() {
  var n = indexarPdf();
  SpreadsheetApp.getActiveSpreadsheet().toast(n + ' PDF indexados', 'Cable Scan', 6);
}

/* ---------- conexionado ---------- */
function conexSheet_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_CONEX);
  if (!sh || sh.getLastRow() < 2) throw new Error('No existe la pestaña ' + HOJA_CONEX);
  return sh;
}
/* localiza la fila de cabeceras (la que tiene CABLE_NUMBER) y devuelve columnas, grupos FROM/TO y cuáles son editables */
function conexLayout_(sh) {
  var v = sh.getRange(1, 1, Math.min(6, sh.getLastRow()), sh.getLastColumn()).getValues();
  var hr = -1;
  for (var i = 0; i < v.length; i++) { if (v[i].map(function (x) { return String(x).trim(); }).indexOf('CABLE_NUMBER') >= 0) { hr = i; break; } }
  if (hr < 0) throw new Error('No encuentro la columna CABLE_NUMBER en ' + HOJA_CONEX);
  var head = v[hr].map(function (x) { return String(x).trim(); });
  var last = head.length; while (last > 0 && !head[last - 1]) last--;
  var grp = [], g = '', merged = false;
  for (var c = 0; c < last; c++) grp.push('');
  if (hr > 0) {
    try {   // grupos FROM / TO: celdas combinadas de la fila de arriba
      sh.getRange(hr, 1, 1, last).getMergedRanges().forEach(function (mr) {
        var t = String(mr.getValue()).trim();
        for (var k = 0; k < mr.getNumColumns(); k++) grp[mr.getColumn() - 1 + k] = t;
        merged = true;
      });
    } catch (e) { merged = false; }
    for (var c2 = 0; c2 < last; c2++) { var gv = String(v[hr - 1][c2]).trim(); if (gv && !grp[c2]) grp[c2] = gv; }
    if (!merged) { var gg = ''; for (var c3 = 0; c3 < last; c3++) { if (grp[c3]) gg = grp[c3]; else if (gg && !/^OBSERV/i.test(head[c3])) grp[c3] = gg; } }
  }
  // sin fila de grupos (o columnas fuera de ella): se deduce del nombre (From / To)
  for (var c4 = 0; c4 < last; c4++) {
    if (grp[c4] || /^OBSERV/i.test(head[c4])) continue;
    var nm = head[c4].toLowerCase();
    if (/from/.test(nm)) grp[c4] = 'FROM'; else if (/(^|[_ ])to($|[_ ])|terminatedto/.test(nm)) grp[c4] = 'TO';
  }
  var edit = [], any = false;
  try {
    var bg = sh.getRange(hr + 1, 1, 1, last).getBackgrounds()[0];
    for (var k = 0; k < last; k++) { var e = String(bg[k]).toLowerCase() === '#00b050' && !!head[k]; edit.push(e); if (e) any = true; }
  } catch (err) { any = false; }
  if (!any) edit = head.slice(0, last).map(function (n) { return CONEX_EDITABLES.indexOf(n) >= 0; });
  return { hr: hr, head: head.slice(0, last), grp: grp, edit: edit, ti: head.indexOf('CABLE_NUMBER') };
}
function conexEstados_() {
  try {
    var rg = SpreadsheetApp.getActiveSpreadsheet().getRangeByName('STATUS_FROM_TO');
    if (rg) { var l = rg.getValues().map(function (r) { return String(r[0]).trim(); }).filter(function (x) { return x; }); if (l.length) return l; }
  } catch (e) { }
  return CONEX_ESTADOS;
}
function getConex_(clientHash) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_CONEX);
  if (!sh || sh.getLastRow() < 2) return { ok: true, none: true };
  var L = conexLayout_(sh), n = L.head.length, tz = Session.getScriptTimeZone();
  var first = L.hr + 2, cnt = sh.getLastRow() - L.hr - 1;
  if (cnt < 1) return { ok: true, none: true };
  var rg = sh.getRange(first, 1, cnt, n), raw = rg.getValues(), disp = rg.getDisplayValues(), rows = [];
  for (var r = 0; r < raw.length; r++) {
    if (!String(disp[r][L.ti]).trim()) continue;
    var o = [];
    for (var c = 0; c < n; c++) {
      var x = raw[r][c], d = String(disp[r][c]).trim();
      o.push(x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : (ERRORES[d] ? '' : d));
    }
    rows.push(o);
  }
  var lsh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_CONEX_LOG), log = [];
  if (lsh && lsh.getLastRow() > 1) {
    var lv = rows_(lsh), from = Math.max(0, lv.length - 3000);
    for (var i = from; i < lv.length; i++) log.push([String(lv[i][1]), String(lv[i][2]), String(lv[i][3]), String(lv[i][4]), String(lv[i][5]), String(lv[i][6]), String(lv[i][7] || ''), String(lv[i][0])]);
  }
  var cols = L.head.map(function (name, i) { return { name: name, letter: colLetter_(i), group: L.grp[i], edit: L.edit[i] }; });
  var estados = conexEstados_();
  var hash = md5_(JSON.stringify([cols, rows, log, estados]));
  if (clientHash && clientHash === hash) return { ok: true, same: true, hash: hash };
  return { ok: true, hash: hash, cols: cols, rows: rows, log: log, estados: estados, generado: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') };
}
/* las listas de escaneos solo pueden ir a pestañas ESCANEOS* o LISTA_*: nunca a la tabla, personal, notas, etc. */
function guardSheet_(name) {
  if (!/^(ESCANEOS|LISTA)[\w ]*$/i.test(String(name))) throw new Error('La pestaña de la lista debe llamarse ESCANEOS o empezar por LISTA_ (no se permite ' + name + ')');
}
function isoWeekNum_(d) {
  var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), dn = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dn);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
/* Avances de campo: NO modifican la hoja CONEXIONADO. Se guardan en CONEXIONADO_LOG con estado Pendiente
   y la app los muestra encima de la tabla hasta que el administrador los marca como Imputado (en el sistema externo). */
function conexPendientes_(lsh) {   // último valor pendiente por cable y columna
  var map = {};
  if (!lsh || lsh.getLastRow() < 2) return map;
  var lv = rows_(lsh);
  for (var i = 0; i < lv.length; i++) {
    if (String(lv[i][7]) !== 'Pendiente') continue;
    map[String(lv[i][2]).toUpperCase().replace(/\s+/g, '') + '|' + lv[i][3]] = String(lv[i][5]);
  }
  return map;
}
function setConex_(p) {
  if (!p.cable || !p.changes) throw new Error('Faltan datos del conexionado');
  var sh = conexSheet_(), L = conexLayout_(sh), tz = Session.getScriptTimeZone();
  var key = String(p.cable).toUpperCase().replace(/\s+/g, '');
  var col = sh.getRange(L.hr + 2, L.ti + 1, Math.max(1, sh.getLastRow() - L.hr - 1), 1).getValues(), row = -1;
  for (var i = 0; i < col.length; i++) { if (String(col[i][0]).toUpperCase().replace(/\s+/g, '') === key) { row = L.hr + 2 + i; break; } }
  if (row < 0) throw new Error('El cable ' + p.cable + ' no está en ' + HOJA_CONEX);
  var lsh = sheet_(HOJA_CONEX_LOG, H_CONEX_LOG);
  if (lsh.getLastColumn() < H_CONEX_LOG.length) lsh.getRange(1, 1, 1, H_CONEX_LOG.length).setValues([H_CONEX_LOG]);
  var pend = conexPendientes_(lsh), cur = sh.getRange(row, 1, 1, L.head.length).getValues()[0];
  var eff = function (ci) { var k = key + '|' + L.head[ci]; return pend[k] !== undefined ? pend[k] : cur[ci]; };
  // reglas: una sección (FROM / TO) con STATUS IMPUTADO queda bloqueada, y solo el administrador puede borrar datos
  Object.keys(p.changes).forEach(function (name) {
    var ci0 = L.head.indexOf(name); if (ci0 < 0) return;
    var g0 = String(L.grp[ci0] || '').toUpperCase().trim(), si = L.head.findIndex(function (h) { return String(h).toUpperCase().replace(/[\s_]+/g, '') === 'STATUS' + g0; });
    if (!p.adm && si >= 0 && (g0 === 'FROM' || g0 === 'TO') && String(eff(si)).trim().toUpperCase() === 'IMPUTADO')
      throw new Error('La sección ' + g0 + ' ya está IMPUTADA: solo el administrador puede editarla');
    var nv = String(p.changes[name] == null ? '' : p.changes[name]).trim(), old = eff(ci0);
    if (!p.adm && !nv && String(old).trim() !== '') throw new Error('Solo el administrador puede borrar datos (' + name + ')');
  });
  var estados = conexEstados_(), now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'), done = 0;
  Object.keys(p.changes).forEach(function (name) {
    var ci = L.head.indexOf(name);
    if (ci < 0 || !L.edit[ci]) throw new Error('La columna ' + name + ' no se puede editar');
    var val = String(p.changes[name] == null ? '' : p.changes[name]).trim().slice(0, 1000);
    if (/^STATUS_(FROM|TO)$/.test(name) && val && estados.indexOf(val) < 0) throw new Error('Status no válido: ' + val);
    if (/^FECHA_/.test(name) && val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) throw new Error('Fecha no válida: ' + val);
    var lid = String(p.id || '') + ':' + name;
    if (p.id && findRow_(lsh, lid)) return;   // ya aplicado (reintento tras un corte)
    var before = eff(ci);
    lsh.appendRow([lid, now, safe_(p.cable, 200), name, safe_(before instanceof Date ? Utilities.formatDate(before, tz, 'yyyy-MM-dd') : String(before), 1000), safe_(val, 1000), safe_(p.author, 80), 'Pendiente', '', '']);
    done++;
  });
  return { ok: true, applied: done };
}
/* el administrador marca avances como Imputado (ya pasados al sistema externo) o Descartado */
function marcarAvances_(p) {
  var ids = {}, n = 0, estado = p.estado === 'Descartado' ? 'Descartado' : 'Imputado';
  (p.ids || []).forEach(function (x) { ids[String(x)] = 1; });
  var lsh = sheet_(HOJA_CONEX_LOG, H_CONEX_LOG), tz = Session.getScriptTimeZone(), now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  if (lsh.getLastRow() < 2) return { ok: true, marcados: 0 };
  var rg = lsh.getRange(2, 1, lsh.getLastRow() - 1, 10), v = rg.getValues();
  for (var i = 0; i < v.length; i++) {
    if (ids[String(v[i][0])] && String(v[i][7]) === 'Pendiente') { v[i][7] = estado; v[i][8] = safe_(p.author, 80); v[i][9] = now; n++; }
  }
  if (n) rg.setValues(v);
  return { ok: true, marcados: n };
}

/* deshacer un avance pendiente: lo puede hacer quien lo reportó o el administrador */
function undoAvance_(p) {
  var ids = {}, n = 0;
  (p.ids || []).forEach(function (x) { ids[String(x)] = 1; });
  var lsh = sheet_(HOJA_CONEX_LOG, H_CONEX_LOG), tz = Session.getScriptTimeZone(), now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  if (lsh.getLastRow() < 2) return { ok: true, deshechos: 0 };
  var rg = lsh.getRange(2, 1, lsh.getLastRow() - 1, 10), v = rg.getValues();
  for (var i = 0; i < v.length; i++) {
    if (!ids[String(v[i][0])]) continue;
    if (String(v[i][7]) !== 'Pendiente') throw new Error('Ese cambio ya fue ' + (String(v[i][7]).toLowerCase() || 'aplicado') + ' y no se puede deshacer desde aquí');
    if (!p.adm && p.ident && String(v[i][6]) !== String(p.author || '')) throw new Error('Solo quien hizo el cambio o un administrador puede deshacerlo');
    v[i][7] = 'Deshecho'; v[i][8] = safe_(p.author, 80); v[i][9] = now; n++;
  }
  if (n) rg.setValues(v);
  return { ok: true, deshechos: n };
}
/* el administrador marca notas / status de campo como imputados (revisión) */
function revNotas_(p) {
  var ids = {}, n = 0, val = p.estado === 'Imputado' ? 'Imputado' : '';
  (p.ids || []).forEach(function (x) { ids[String(x)] = 1; });
  var sh = sheet_(HOJA_NOTAS, H_NOTAS), tz = Session.getScriptTimeZone(), now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  if (sh.getLastRow() < 2) return { ok: true, marcados: 0 };
  if (sh.getLastColumn() < H_NOTAS.length) sh.getRange(1, 1, 1, H_NOTAS.length).setValues([H_NOTAS]);
  var rg = sh.getRange(2, 1, sh.getLastRow() - 1, 9), v = rg.getValues();
  for (var i = 0; i < v.length; i++) {
    if (!ids[String(v[i][0])]) continue;
    v[i][6] = val; v[i][7] = val ? safe_(p.author, 80) : ''; v[i][8] = val ? now : ''; n++;
  }
  if (n) rg.setValues(v);
  return { ok: true, marcados: n };
}
/* ---------- almacén: ENTRADA_ALM_BW y SALIDA_ALM_BW (se leen tal cual; la cabecera se detecta sola) ---------- */
function leerAlm_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return { falta: !sh, cols: [], rows: [] };
  var v = sh.getDataRange().getDisplayValues(), raw = sh.getDataRange().getValues(), tz = Session.getScriptTimeZone(), h = 0;
  for (var i = 0; i < Math.min(8, v.length); i++) {
    var filled = v[i].filter(function (x) { return String(x).trim() !== ''; }).length;
    if (filled >= 3) { h = i; break; }
  }
  var head = v[h].map(function (x) { return String(x).trim(); }), last = head.length;
  while (last > 0 && !head[last - 1]) last--;
  head = head.slice(0, last);
  var cols = head.map(function (n, i) { return { name: n || ('Columna ' + (i + 1)) }; }), rows = [];
  for (var r = h + 1; r < v.length; r++) {
    var o = [], any = false;
    for (var c = 0; c < last; c++) {
      var x = raw[r][c], d = String(v[r][c]).trim();
      var t = x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : (ERRORES[d] ? '' : d);
      if (t !== '') any = true; o.push(t);
    }
    if (any) rows.push(o);
  }
  return { cols: cols, rows: rows };
}
function getAlmacen_(clientHash) {
  var e = leerAlm_(HOJA_ALM_IN), s = leerAlm_(HOJA_ALM_OUT);
  var hash = md5_(JSON.stringify([e, s]));
  if (clientHash && clientHash === hash) return { ok: true, same: true, hash: hash };
  return { ok: true, hash: hash, entrada: e, salida: s, generado: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') };
}


/* ---------- avisos por correo al administrador ----------
   1) Rellena AVISO_EMAIL (uno o varios correos separados por coma) y APP_URL (la dirección de la app).
   2) En el editor de Apps Script ejecuta UNA vez la función  instalarAvisos  (crea un reloj que revisa cada 15 minutos).
   Solo manda correo cuando hay algo nuevo. Para quitarlos: ejecuta  quitarAvisos. */
var AVISO_EMAIL = '';   // por ejemplo 'gustavo@empresa.com'; vacío = el dueño del script
var APP_URL = '';       // por ejemplo 'https://tuusuario.github.io/cable-scan/'
var AVISOS = { cambios: true, almacen: true, seguridad: true };   // qué avisar
function instalarAvisos() {
  quitarAvisos();
  ScriptApp.newTrigger('avisarCambios').timeBased().everyMinutes(15).create();
  PropertiesService.getScriptProperties().deleteProperty('AV_INIT');
  avisarCambios();   // la primera vez solo anota el punto de partida
  Logger.log('Avisos activados: revisa cada 15 minutos.');
}
function quitarAvisos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'avisarCambios') ScriptApp.deleteTrigger(t); });
}
function avisarCambios() {
  var P = PropertiesService.getScriptProperties(), ss = SpreadsheetApp.getActiveSpreadsheet(), tz = Session.getScriptTimeZone();
  var primera = !P.getProperty('AV_INIT'), bloques = [], resumen = [];
  var link = function (h, txt) { return APP_URL ? ' <a href="' + APP_URL + '#' + h + '">' + txt + '</a>' : ''; };
  var esc = function (x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  // 1) cambios del personal: avances de conexionado y status de campo / notas de cableado
  if (AVISOS.cambios) {
    var lsh = ss.getSheetByName(HOJA_CONEX_LOG), lastL = lsh ? lsh.getLastRow() : 1, prevL = +(P.getProperty('AV_LOG') || lastL), nuevos = [];
    if (lsh && lastL > prevL && !primera) {
      lsh.getRange(prevL + 1, 1, lastL - prevL, 8).getValues().forEach(function (r) { if (String(r[7]) === 'Pendiente') nuevos.push(r); });
    }
    P.setProperty('AV_LOG', String(lastL));
    var nsh = ss.getSheetByName(HOJA_NOTAS), vistas = {}, conocidas = {};
    try { conocidas = JSON.parse(P.getProperty('AV_NOTAS') || '{}'); } catch (e) { conocidas = {}; }
    var notasNuevas = [], todas = {};
    if (nsh && nsh.getLastRow() > 1) {
      nsh.getRange(2, 1, nsh.getLastRow() - 1, 7).getValues().forEach(function (r) {
        if (!r[0]) return; todas[String(r[0])] = 1;
        if (!conocidas[String(r[0])] && !primera) notasNuevas.push(r);
      });
    }
    P.setProperty('AV_NOTAS', JSON.stringify(todas).length < 8500 ? JSON.stringify(todas) : JSON.stringify(Object.keys(todas).slice(-250).reduce(function (o, k) { o[k] = 1; return o; }, {})));
    if (nuevos.length) {
      var porCable = {};
      nuevos.forEach(function (r) { var k = r[2]; (porCable[k] = porCable[k] || []).push(r[3] + ': ' + (r[5] || '(vacío)') + ' (' + r[6] + ')'); });
      var ks = Object.keys(porCable);
      resumen.push(ks.length + ' cable' + (ks.length > 1 ? 's' : '') + ' con avances de conexionado');
      bloques.push('<h3>Conexionado: ' + ks.length + ' cable(s) con avances por imputar' + link('conex', 'Abrir en la app') + '</h3><ul>' + ks.slice(0, 30).map(function (k) { return '<li><b>' + esc(k) + '</b><br>' + esc(porCable[k].join(' · ')) + '</li>'; }).join('') + (ks.length > 30 ? '<li>… y ' + (ks.length - 30) + ' más</li>' : '') + '</ul>');
    }
    if (notasNuevas.length) {
      resumen.push(notasNuevas.length + ' status/notas de cableado');
      bloques.push('<h3>Cableado: ' + notasNuevas.length + ' status de campo / notas' + link('cambios', 'Abrir en la app') + '</h3><ul>' + notasNuevas.slice(0, 30).map(function (r) {
        var e = {}; try { e = r[5] ? JSON.parse(r[5]) : {}; } catch (x) { }
        return '<li><b>' + esc(r[1]) + '</b>: ' + esc(e.tipo || 'Nota') + (e.metros ? ' ' + e.metros + ' m' : '') + (r[2] ? ' ' + esc(String(r[2]).slice(0, 120)) : '') + ' <i>(' + esc(r[4]) + ')</i></li>';
      }).join('') + (notasNuevas.length > 30 ? '<li>… y ' + (notasNuevas.length - 30) + ' más</li>' : '') + '</ul>');
    }
  }
  // 2) almacén: movimientos nuevos
  if (AVISOS.almacen) {
    [[HOJA_ALM_IN, 'AV_ALM_IN', 'entradas'], [HOJA_ALM_OUT, 'AV_ALM_OUT', 'salidas']].forEach(function (a) {
      var sh = ss.getSheetByName(a[0]); if (!sh) return;
      var n = sh.getLastRow(), prev = +(P.getProperty(a[1]) || n);
      P.setProperty(a[1], String(n));
      if (n > prev && !primera) { resumen.push((n - prev) + ' ' + a[2] + ' de almacén'); bloques.push('<h3>Almacén: ' + (n - prev) + ' ' + a[2] + ' nuevas' + link('almacen', 'Ver el almacén') + '</h3>'); }
    });
  }
  // 3) seguridad: bloqueos por códigos incorrectos
  if (AVISOS.seguridad) {
    var ssh = ss.getSheetByName(HOJA_SEG), n2 = ssh ? ssh.getLastRow() : 1, prev2 = +(P.getProperty('AV_SEG') || n2);
    P.setProperty('AV_SEG', String(n2));
    if (ssh && n2 > prev2 && !primera) {
      var bl = ssh.getRange(prev2 + 1, 1, n2 - prev2, Math.max(3, ssh.getLastColumn())).getValues().filter(function (r) { return String(r[1]) === 'BLOQUEO'; });
      if (bl.length) { resumen.push('bloqueo de seguridad'); bloques.push('<h3>Seguridad: ' + bl.length + ' bloqueo(s) por intentos de código</h3>'); }
    }
  }
  P.setProperty('AV_INIT', '1');
  if (!bloques.length) return;
  var to = AVISO_EMAIL || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({ to: to, subject: 'Cable Scan BW04: ' + resumen.join(', '), htmlBody: '<div style="font-family:Arial,sans-serif">' + bloques.join('') + '<p style="color:#666">Aviso automático de Cable Scan, ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm') + '</p></div>' });
}

/* ---------- lecturas ---------- */
function getData_(clientHash) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_DATOS);
  if (!sh) throw new Error('No existe la pestaña ' + HOJA_DATOS);
  var v = sh.getDataRange().getDisplayValues();
  var h = -1;
  for (var i = 0; i < Math.min(6, v.length); i++) {
    if (v[i].indexOf('CABLE_NUMBER') >= 0) { h = i; break; }
  }
  if (h < 0) throw new Error('No encuentro la columna CABLE_NUMBER en las primeras filas de ' + HOJA_DATOS);
  var head = v[h].map(function (x) { return String(x).trim(); });
  var last = head.length;
  while (last > 0 && !head[last - 1]) last--;
  head = head.slice(0, last);
  var ti = head.indexOf('CABLE_NUMBER');
  var rows = [];
  for (var r = h + 1; r < v.length; r++) {
    if (!String(v[r][ti]).trim()) continue;
    var o = [];
    for (var c = 0; c < last; c++) {
      var x = String(v[r][c]).trim();
      o.push(ERRORES[x] ? '' : x);
    }
    rows.push(o);
  }
  var hash = md5_(JSON.stringify([head, rows]));
  if (clientHash && clientHash === hash) return { ok: true, same: true, hash: hash };   // la app ya la tiene
  return {
    ok: true,
    hash: hash,
    hoja: HOJA_DATOS,
    generado: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    columns: head.map(function (n, i) { return { letter: colLetter_(i), name: n }; }),
    rows: rows
  };
}

/* Lista total de cables de TU disciplina (pestaña CC_SCHEDULE). Solo se leen dos columnas: CABLE_NUMBER y Discipline.
   Puedes pegar el export entero; las demás columnas se ignoran. Con DISCIPLINA_FILTRO = 'INS' solo cuentan los cables
   cuya columna Discipline sea INS (instrumentación). Déjalo vacío para contarlos todos. */
function getSchedule_(clientHash) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_SCHEDULE);
  if (!sh || sh.getLastRow() < 2) return { ok: true, none: true };
  var lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, Math.min(30, sh.getLastRow()), lastCol).getDisplayValues();
  var hr = -1, hc = -1, dc = -1, sc = -1, rc = -1;
  for (var r = 0; r < head.length && hr < 0; r++) {
    for (var c = 0; c < lastCol; c++) { if (String(head[r][c]).trim() === 'CABLE_NUMBER') { hr = r; hc = c; break; } }
  }
  if (hr < 0) throw new Error('No encuentro la columna CABLE_NUMBER en las primeras filas de ' + HOJA_SCHEDULE);
  for (var c2 = 0; c2 < lastCol; c2++) {
    var h = String(head[hr][c2]).trim();
    if (h === 'Discipline' && dc < 0) dc = c2;
    if (h === 'CURRENT_STATUS' && sc < 0) sc = c2;
    if (h === 'Released_CT' && rc < 0) rc = c2;
  }
  var filtro = String(DISCIPLINA_FILTRO || '').trim().toUpperCase();
  if (filtro && dc < 0) throw new Error('No encuentro la columna Discipline en ' + HOJA_SCHEDULE + '. Pégala junto a CABLE_NUMBER o deja DISCIPLINA_FILTRO vacío en el script');
  var n = sh.getLastRow() - hr - 1;
  var tags = [], pend = [], pendRows = [], todos = 0, excl = 0;
  if (n > 0) {
    var col = sh.getRange(hr + 2, hc + 1, n, 1).getDisplayValues();
    var dis = dc >= 0 ? sh.getRange(hr + 2, dc + 1, n, 1).getDisplayValues() : null;
    var all = sh.getRange(hr + 2, 1, n, lastCol).getDisplayValues();   // para dar los datos completos de los PENDING
    var cst = sc >= 0 ? sh.getRange(hr + 2, sc + 1, n, 1).getDisplayValues() : null;
    var rel = rc >= 0 ? sh.getRange(hr + 2, rc + 1, n, 1).getDisplayValues() : null;
    var seen = {};
    for (var i = 0; i < col.length; i++) {
      var t = String(col[i][0]).replace(/\u00a0/g, ' ').trim();
      if (!t || seen[t]) continue;
      seen[t] = 1; todos++;
      if (filtro && String(dis[i][0]).trim().toUpperCase() !== filtro) continue;
      var st = cst ? String(cst[i][0]).trim().toUpperCase() : '';
      if (ESTADOS_EXCLUIDOS.indexOf(st) >= 0) { excl++; continue; }          // DAMAGED y SPARE no cuentan
      tags.push(t);
      if (st === 'PENDING' && rel && String(rel[i][0]).trim().toUpperCase() === 'Y') { pend.push(t); pendRows.push(all[i]); }   // PENDING POR TENDER, con todos sus datos
    }
  }
  var pendCols = [];
  for (var k = 0; k < lastCol; k++) pendCols.push(String(head[hr][k]).trim());
  var hash = md5_(filtro + '|' + tags.length + '|' + tags.join('\n') + '|' + JSON.stringify(pendRows));
  if (clientHash && clientHash === hash) return { ok: true, same: true, hash: hash };
  return { ok: true, hash: hash, total: tags.length, todos: todos, excluidos: excl, filtro: filtro, tags: tags, pend: pend, pendCols: pendCols, pendRows: pendRows };
}

/* Rutas y bandejas: qué cables (de todas las disciplinas) pasan por cada código de ROUTE_CODES del CC_SCHEDULE.
   Se envía comprimido: lista de cables [tag, disciplina, estado] y, por cada código, los números de cable que pasan. */
function getRoutes_(clientHash) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_SCHEDULE);
  if (!sh || sh.getLastRow() < 2) return { ok: true, none: true };
  var lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, Math.min(30, sh.getLastRow()), lastCol).getDisplayValues();
  var hr = -1, hc = -1, dc = -1, sc = -1, rc = -1, lc = -1;
  for (var r = 0; r < head.length && hr < 0; r++) {
    for (var c = 0; c < lastCol; c++) { if (String(head[r][c]).trim() === 'CABLE_NUMBER') { hr = r; hc = c; break; } }
  }
  if (hr < 0) throw new Error('No encuentro la columna CABLE_NUMBER en las primeras filas de ' + HOJA_SCHEDULE);
  for (var c2 = 0; c2 < lastCol; c2++) {
    var h = String(head[hr][c2]).trim();
    if (h === 'Discipline' && dc < 0) dc = c2;
    if (h === 'CURRENT_STATUS' && sc < 0) sc = c2;
    if (h === 'ROUTE_CODES' && rc < 0) rc = c2;
    if (h === 'Level' && lc < 0) lc = c2;
  }
  if (rc < 0) throw new Error('No encuentro la columna ROUTE_CODES en ' + HOJA_SCHEDULE);
  var n = sh.getLastRow() - hr - 1;
  if (n < 1) return { ok: true, none: true };
  var col = function (k) { return k >= 0 ? sh.getRange(hr + 2, k + 1, n, 1).getDisplayValues() : null; };
  var tg = col(hc), ds = col(dc), st = col(sc), rt = col(rc), lv = col(lc);
  var discs = [], dmap = {}, stats = [], smap = {}, levels = [], lmap = {}, cables = [], codes = [], idx = [], cmap = {}, seen = {};
  var pos = function (arr, map, v) { if (!Object.prototype.hasOwnProperty.call(map, v)) { map[v] = arr.length; arr.push(v); } return map[v]; };
  for (var i = 0; i < n; i++) {
    var t = String(tg[i][0]).replace(/\u00a0/g, ' ').trim();
    if (!t || seen[t]) continue;
    seen[t] = 1;
    var ci = cables.length;
    cables.push([t, pos(discs, dmap, ds ? String(ds[i][0]).trim().toUpperCase() : ''), pos(stats, smap, st ? String(st[i][0]).trim() : ''), pos(levels, lmap, lv ? String(lv[i][0]).trim() : '')]);
    var parts = String(rt[i][0]).split(',');
    for (var k = 0; k < parts.length; k++) {
      var code = parts[k].replace(/\u00a0/g, ' ').trim().replace(/^\/+/, '').trim();
      if (!code) continue;
      var ix = pos(codes, cmap, code);
      if (!idx[ix]) idx[ix] = [];
      var lst = idx[ix];
      if (lst[lst.length - 1] !== ci) lst.push(ci);
    }
  }
  var hash = md5_(JSON.stringify([discs, stats, levels, cables, codes, idx]));
  if (clientHash && clientHash === hash) return { ok: true, same: true, hash: hash };
  return { ok: true, hash: hash, discs: discs, stats: stats, levels: levels, cables: cables, codes: codes, idx: idx };
}

/* Búsqueda en todo el proyecto: las columnas de CC_COLUMNAS de todos los cables del CC_SCHEDULE, comprimidas por diccionario */
function getCC_(clientHash) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_SCHEDULE);
  if (!sh || sh.getLastRow() < 2) return { ok: true, none: true };
  var lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, Math.min(30, sh.getLastRow()), lastCol).getDisplayValues();
  var hr = -1, hc = -1;
  for (var r = 0; r < head.length && hr < 0; r++) {
    for (var c = 0; c < lastCol; c++) { if (String(head[r][c]).trim() === 'CABLE_NUMBER') { hr = r; hc = c; break; } }
  }
  if (hr < 0) throw new Error('No encuentro la columna CABLE_NUMBER en las primeras filas de ' + HOJA_SCHEDULE);
  var pick = [];
  CC_COLUMNAS.forEach(function (name) {
    for (var k = 0; k < lastCol; k++) { if (String(head[hr][k]).trim() === name) { pick.push({ name: name, i: k }); break; } }
  });
  var n = sh.getLastRow() - hr - 1;
  if (n < 1) return { ok: true, none: true };
  var all = sh.getRange(hr + 2, 1, n, lastCol).getDisplayValues();
  var tagCol = -1; pick.forEach(function (p, j) { if (p.name === 'CABLE_NUMBER') tagCol = j; });
  var dict = pick.map(function () { return []; }), maps = pick.map(function () { return {}; }), data = pick.map(function () { return []; });
  var seen = {}, total = 0;
  for (var i = 0; i < all.length; i++) {
    var tag = String(all[i][hc]).replace(/\u00a0/g, ' ').trim();
    if (!tag || seen[tag]) continue;
    seen[tag] = 1; total++;
    for (var j = 0; j < pick.length; j++) {
      var v = String(all[i][pick[j].i]).replace(/\u00a0/g, ' ').trim();
      var m = maps[j];
      if (!Object.prototype.hasOwnProperty.call(m, v)) { m[v] = dict[j].length; dict[j].push(v); }
      data[j].push(m[v]);
    }
  }
  var cols = pick.map(function (p) { return p.name; });
  var hash = md5_(JSON.stringify([cols, dict, data]));
  if (clientHash && clientHash === hash) return { ok: true, same: true, hash: hash };
  return { ok: true, hash: hash, total: total, cols: cols, dict: dict, data: data };
}

function getSync_(pdfHash, me) {   // me: { nombre, notas, conex, admin }
  var notes = rows_(sheet_(HOJA_NOTAS, H_NOTAS)).filter(function (r) { return r[0]; }).map(function (r) {
    return { id: String(r[0]), tag: String(r[1]), text: String(r[2]), date: String(r[3]), author: String(r[4]), estado: String(r[5] || ''), rev: String(r[6] || '') };
  });
  var files = rows_(sheet_(HOJA_ARCHIVOS, H_ARCH)).filter(function (r) { return r[0]; }).map(function (r) {
    return { uid: String(r[0]), tag: String(r[2]), kind: String(r[3]), name: String(r[4]), mime: String(r[5]), date: String(r[6]), author: String(r[7]) };
  });
  var pdfs = rows_(sheet_(HOJA_PDF, H_PDF)).filter(function (r) { return r[0]; }).map(function (r) {
    return { id: String(r[0]), name: String(r[1]), date: String(r[2]), tipo: String(r[3] || 'pulling'), carpeta: String(r[4] || '') };
  });
  var ph = md5_(JSON.stringify(pdfs));
  var res = { ok: true, notes: notes, files: files, pdfHash: ph, me: me };
  if (pdfHash && pdfHash === ph) res.pdfSame = true; else res.pdfs = pdfs;
  return res;
}

function getFile_(uid) {
  var sh = sheet_(HOJA_ARCHIVOS, H_ARCH);
  var cell = findRow_(sh, uid);
  if (!cell) throw new Error('Archivo no encontrado');
  var fileId = sh.getRange(cell.getRow(), 2).getValue();
  var blob = DriveApp.getFileById(fileId).getBlob();
  return { ok: true, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function getPdf_(id) {
  var sh = sheet_(HOJA_PDF, H_PDF);
  if (!findRow_(sh, id)) throw new Error('PDF no encontrado en el índice (¿se actualizó el índice?)');
  var blob = DriveApp.getFileById(id).getBlob();
  var bytes = blob.getBytes();
  if (bytes.length > MAX_PDF_BYTES) throw new Error('El PDF pesa más de 30 MB y no se puede abrir desde la app');
  return { ok: true, mime: 'application/pdf', data: Utilities.base64Encode(bytes) };
}

/* ---------- escrituras (solo notas, fotos y la lista escaneada) ---------- */
function write_(p) {
  var sh, cell;
  switch (p.action) {
    case 'addNote':
      if (!p.id || !p.tag) throw new Error('Faltan datos de la nota');
      sh = sheet_(HOJA_NOTAS, H_NOTAS);
      if (!findRow_(sh, p.id)) {
        sh.appendRow([String(p.id).slice(0, 80), safe_(p.tag, 200), safe_(p.text, 3000), String(p.date || '').slice(0, 40), safe_(p.author, 80), p.estado ? JSON.stringify(p.estado).slice(0, 2000) : '']);
      }
      return { ok: true };

    case 'delNote':
      sh = sheet_(HOJA_NOTAS, H_NOTAS);
      cell = findRow_(sh, p.id);
      if (cell) {
        var nAut = String(sh.getRange(cell.getRow(), 5).getValue() || '');
        if (!p.adm && p.ident && nAut && nAut !== String(p.author || '')) throw new Error('Solo el autor de la nota o un administrador puede borrarla');
        sh.deleteRow(cell.getRow());
      }
      return { ok: true };

    case 'upload':
      if (p.kind && p.kind !== 'photo') throw new Error('Desde la app solo se pueden subir fotos; los PDF los sube solo el administrador (uploadPdf)');
      if (!p.uid || !p.tag || !p.data) throw new Error('Faltan datos de la foto');
      if (!/^image\/(jpeg|png|webp)$/.test(String(p.mime || 'image/jpeg'))) throw new Error('Solo se admiten fotos JPG, PNG o WEBP');
      if (String(p.data).length > MAX_FOTO_BYTES * 1.4) throw new Error('La foto pesa más de 8 MB');
      sh = sheet_(HOJA_ARCHIVOS, H_ARCH);
      if (findRow_(sh, p.uid)) return { ok: true, duplicate: true };
      var safeTag = String(p.tag).replace(/[^\w.=\-]+/g, '_');
      var name = safeTag + '__' + String(p.name || 'foto.jpg');
      name = name.replace(/[^\w.=\-]+/g, '_').slice(0, 120);
      var blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.mime || 'image/jpeg', name);
      var file = fotosFolder_().createFile(blob);
      sh.appendRow([String(p.uid).slice(0, 80), file.getId(), safe_(p.tag, 200), 'photo', safe_(p.name, 120),
        String(p.mime || ''), String(p.date || '').slice(0, 40), safe_(p.author, 80)]);
      return { ok: true, id: file.getId() };

    case 'uploadPdf':
      if (!p.data) throw new Error('Faltan datos del PDF');
      var bytes = Utilities.base64Decode(p.data);
      if (bytes.length > MAX_PDF_BYTES) throw new Error('El PDF pesa más de 30 MB');
      var base = String(p.name || '').replace(/\.pdf$/i, '').replace(/[\/\\]+/g, '-').trim();
      var ptipo = /^(iso|transit|sep|fds|hvac|tierra|proc)$/.test(p.tipo) ? p.tipo : 'pulling';
      var pname, dest;
      if (ptipo === 'pulling') {
        if (!p.tag) throw new Error('Falta el tag del cable');
        // el nombre debe contener el tag completo para que la app lo asocie al cable
        pname = (base.toUpperCase().replace(/\s+/g, '').indexOf(String(p.tag).toUpperCase().replace(/\s+/g, '')) >= 0 ? base : (String(p.tag) + (base ? ' ' + base : ''))) + '.pdf';
        dest = pdfFolder_();
      } else {
        if (!base) throw new Error('Falta el nombre del PDF');
        pname = base + '.pdf';
        dest = CARPETAS_SIS[ptipo] ? sisFolder_(ptipo) : ptipo === 'iso' ? isoFolder_() : ptipo === 'sep' ? sepFolder_() : transitFolder_();
        var cf = String(p.carpeta || '').replace(/[\/\\]+/g, '-').trim();
        if (cf) { var it = dest.getFoldersByName(cf); dest = it.hasNext() ? it.next() : dest.createFolder(cf); }
      }
      var pfile = dest.createFile(Utilities.newBlob(bytes, 'application/pdf', pname));
      indexarPdf();
      return { ok: true, id: pfile.getId(), name: pname };

    case 'delPdf':
      sh = sheet_(HOJA_PDF, H_PDF);
      if (!findRow_(sh, p.id)) throw new Error('Ese PDF no está en el índice');
      try { DriveApp.getFileById(p.id).setTrashed(true); } catch (e) { }
      indexarPdf();
      return { ok: true };

    case 'delFile':
      sh = sheet_(HOJA_ARCHIVOS, H_ARCH);
      cell = findRow_(sh, p.uid);
      if (cell) {
        var fAut = String(sh.getRange(cell.getRow(), 8).getValue() || '');
        if (!p.adm && p.ident && fAut && fAut !== String(p.author || '')) throw new Error('Solo el autor de la foto o un administrador puede borrarla');
        var fid = sh.getRange(cell.getRow(), 2).getValue();
        try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) { }
        sh.deleteRow(cell.getRow());
      }
      return { ok: true };

    case 'setConex':
      return setConex_(p);

    case 'marcarAvances':
      return marcarAvances_(p);

    case 'undoAvance':
      return undoAvance_(p);

    case 'revNotas':
      return revNotas_(p);

    case 'clearScans':
      guardSheet_(p.sheet || 'ESCANEOS');
      var shc = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(p.sheet || 'ESCANEOS');
      if (shc && shc.getLastRow() > 1) shc.getRange(2, 1, shc.getLastRow() - 1, Math.max(1, shc.getLastColumn())).clearContent();
      return { ok: true };

    case 'scans':
      guardSheet_(p.sheet || 'ESCANEOS');
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var name2 = p.sheet || 'ESCANEOS';
      var s2 = ss.getSheetByName(name2) || ss.insertSheet(name2);
      if (s2.getLastRow() === 0 && p.header) {
        s2.appendRow(p.header);
        s2.getRange(1, 1, 1, p.header.length).setFontWeight('bold');
        s2.setFrozenRows(1);
      }
      if (p.rows && p.rows.length) {
        if (p.rows.length > 5000) throw new Error('Demasiadas filas de una vez (máximo 5000)');
        var wcols = p.rows[0].length;
        var clean = p.rows.map(function (r) { var o = []; for (var q = 0; q < wcols; q++) o.push(safe_(r[q], 500)); return o; });
        s2.getRange(s2.getLastRow() + 1, 1, clean.length, wcols).setValues(clean);
      }
      return { ok: true, added: (p.rows || []).length };
  }
  throw new Error('Acción desconocida');
}
