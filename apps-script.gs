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
var DISCIPLINA_FILTRO = 'INS';       // solo cuentan los cables con esta Discipline (INS = instrumentación). Vacío = todos
var CARPETA_FOTOS = 'CableScan_Fotos';
var CARPETA_PDF = 'CableScan_PDF';
var ADMIN_TOKEN = '';           // clave SOLO TUYA para subir y quitar PDF desde la app. Vacía = esa función está desactivada.
var PDF_FOLDER_ID = '';          // opcional: ID de una carpeta de Drive que ya tengas con los PDF
var MAX_PDF_BYTES = 30 * 1024 * 1024;

var H_NOTAS = ['id', 'tag', 'nota', 'fecha', 'autor'];
var H_ARCH = ['uid', 'archivo_id', 'tag', 'tipo', 'nombre', 'mime', 'fecha', 'autor'];
var H_PDF = ['id', 'nombre', 'modificado'];
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
    switch (p.action) {
      case 'ping': return out_({ ok: true, admin: isAdmin_(p) });
      case 'data': return out_(getData_(p.hash));
      case 'sync': return out_(getSync_(p.pdfHash));
      case 'schedule': return out_(getSchedule_(p.hash));
      case 'file': return out_(getFile_(p.uid));
      case 'pdf': return out_(getPdf_(p.id));
      case 'uploadPdf': case 'delPdf':
        if (!isAdmin_(p)) throw new Error(ADMIN_TOKEN ? 'Clave de administrador incorrecta' : 'Subir PDF desde la app está desactivado: pon un ADMIN_TOKEN en el script');
      case 'addNote': case 'delNote': case 'upload': case 'delFile': case 'scans':
        var lock = LockService.getScriptLock();
        lock.waitLock(25000);
        try { return out_(write_(p)); } finally { lock.releaseLock(); }
      default: return out_({ ok: false, error: 'Acción desconocida' });
    }
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ---------- utilidades ---------- */
function isAdmin_(p) { return !!ADMIN_TOKEN && ADMIN_TOKEN.indexOf('CAMBIA-ESTA') !== 0 && p.admin === ADMIN_TOKEN; }

function colLetter_(i) {
  var s = ''; i++;
  while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
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
function pdfFolder_() { return PDF_FOLDER_ID ? DriveApp.getFolderById(PDF_FOLDER_ID) : namedFolder_('FOLDER_PDF', CARPETA_PDF); }

/** Ejecútala una vez desde el editor: concede permisos, crea pestañas y carpetas e indexa los PDF. */
function autorizar() {
  sheet_(HOJA_NOTAS, H_NOTAS);
  sheet_(HOJA_ARCHIVOS, H_ARCH);
  sheet_(HOJA_PDF, H_PDF);
  fotosFolder_();
  pdfFolder_();
  indexarPdf();
  Logger.log('Listo. Ya puedes implementar como aplicación web.');
}

/* ---------- índice de PDF (lo mantienes tú desde Drive) ---------- */
function indexarPdf() {
  var out = [];
  (function walk(folder) {
    var files = folder.getFilesByType(MimeType.PDF);
    while (files.hasNext()) {
      var f = files.next();
      out.push([f.getId(), f.getName(), Utilities.formatDate(f.getLastUpdated(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')]);
    }
    var subs = folder.getFolders();
    while (subs.hasNext()) walk(subs.next());
  })(pdfFolder_());
  var sh = sheet_(HOJA_PDF, H_PDF);
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

function getSync_(pdfHash) {
  var notes = rows_(sheet_(HOJA_NOTAS, H_NOTAS)).filter(function (r) { return r[0]; }).map(function (r) {
    return { id: String(r[0]), tag: String(r[1]), text: String(r[2]), date: String(r[3]), author: String(r[4]) };
  });
  var files = rows_(sheet_(HOJA_ARCHIVOS, H_ARCH)).filter(function (r) { return r[0]; }).map(function (r) {
    return { uid: String(r[0]), tag: String(r[2]), kind: String(r[3]), name: String(r[4]), mime: String(r[5]), date: String(r[6]), author: String(r[7]) };
  });
  var pdfs = rows_(sheet_(HOJA_PDF, H_PDF)).filter(function (r) { return r[0]; }).map(function (r) {
    return { id: String(r[0]), name: String(r[1]), date: String(r[2]) };
  });
  var ph = md5_(JSON.stringify(pdfs));
  var res = { ok: true, notes: notes, files: files, pdfHash: ph };
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
        sh.appendRow([String(p.id), String(p.tag), String(p.text || ''), String(p.date || ''), String(p.author || '')]);
      }
      return { ok: true };

    case 'delNote':
      sh = sheet_(HOJA_NOTAS, H_NOTAS);
      cell = findRow_(sh, p.id);
      if (cell) sh.deleteRow(cell.getRow());
      return { ok: true };

    case 'upload':
      if (p.kind && p.kind !== 'photo') throw new Error('Desde la app solo se pueden subir fotos; los PDF los sube solo el administrador (uploadPdf)');
      if (!p.uid || !p.tag || !p.data) throw new Error('Faltan datos de la foto');
      sh = sheet_(HOJA_ARCHIVOS, H_ARCH);
      if (findRow_(sh, p.uid)) return { ok: true, duplicate: true };
      var safeTag = String(p.tag).replace(/[^\w.=\-]+/g, '_');
      var name = safeTag + '__' + String(p.name || 'foto.jpg');
      var blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.mime || 'image/jpeg', name);
      var file = fotosFolder_().createFile(blob);
      sh.appendRow([String(p.uid), file.getId(), String(p.tag), 'photo', String(p.name || ''),
        String(p.mime || ''), String(p.date || ''), String(p.author || '')]);
      return { ok: true, id: file.getId() };

    case 'uploadPdf':
      if (!p.tag || !p.data) throw new Error('Faltan datos del PDF');
      var bytes = Utilities.base64Decode(p.data);
      if (bytes.length > MAX_PDF_BYTES) throw new Error('El PDF pesa más de 30 MB');
      // el nombre debe contener el tag completo para que la app lo asocie al cable
      var base = String(p.name || '').replace(/\.pdf$/i, '').replace(/[\/\\]+/g, '-').trim();
      var pname = (base.toUpperCase().replace(/\s+/g, '').indexOf(String(p.tag).toUpperCase().replace(/\s+/g, '')) >= 0 ? base : (String(p.tag) + (base ? ' ' + base : ''))) + '.pdf';
      var pfile = pdfFolder_().createFile(Utilities.newBlob(bytes, 'application/pdf', pname));
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
        var fid = sh.getRange(cell.getRow(), 2).getValue();
        try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) { }
        sh.deleteRow(cell.getRow());
      }
      return { ok: true };

    case 'scans':
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var name2 = p.sheet || 'ESCANEOS';
      var s2 = ss.getSheetByName(name2) || ss.insertSheet(name2);
      if (s2.getLastRow() === 0 && p.header) {
        s2.appendRow(p.header);
        s2.getRange(1, 1, 1, p.header.length).setFontWeight('bold');
        s2.setFrozenRows(1);
      }
      if (p.rows && p.rows.length) {
        s2.getRange(s2.getLastRow() + 1, 1, p.rows.length, p.rows[0].length).setValues(p.rows);
      }
      return { ok: true, added: (p.rows || []).length };
  }
  throw new Error('Acción desconocida');
}
