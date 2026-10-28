/**
 * Recibe la lista de escaneos de la app y la añade a una pestaña de TU Google Sheet.
 *
 * Instalación (2 minutos):
 *  1) Abre tu Google Sheet  ->  Extensiones  ->  Apps Script.
 *  2) Borra el contenido y pega este archivo. Guarda.
 *  3) Implementar -> Nueva implementación -> tipo "Aplicación web".
 *       Ejecutar como: Yo      |      Quién tiene acceso: Cualquier usuario
 *  4) Copia la URL que termina en /exec y pégala en la app (⚙ -> URL de Apps Script).
 *
 * Cada vez que pulses "Google Sheet" en la lista, se añadirán las filas al final
 * de la pestaña indicada (se crea si no existe y se escribe el encabezado la primera vez).
 */
function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = body.sheet || 'ESCANEOS';
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);

  if (sh.getLastRow() === 0 && body.header) {
    sh.appendRow(body.header);
    sh.getRange(1, 1, 1, body.header.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (body.rows && body.rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, body.rows.length, body.rows[0].length).setValues(body.rows);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true, added: (body.rows || []).length }))
    .setMimeType(ContentService.MimeType.JSON);
}
