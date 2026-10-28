# Cable Scan BW04

App web (PWA) para escanear el código de barras de un cable, ver su ficha (columnas A–U de `Tabla_MAIN`, ampliable a las 119 columnas), cargar el PDF de pulling, tomar fotos, hacer anotaciones y escanear varios códigos a una lista exportable.

Funciona en el navegador del móvil o del PC. No necesita servidor.

## 1. Subir a GitHub y publicar (una sola vez)

1. En GitHub: **New repository** → nombre `cable-scan` → **Private** si quieres que el código no sea público (ver nota de privacidad abajo) → Create.
2. Sube **todo el contenido de esta carpeta** (incluida `data.json`, `vendor/` y el archivo oculto `.nojekyll`): *Add file → Upload files*, o con git:
   ```
   git init && git add . && git commit -m "Cable Scan"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/cable-scan.git
   git push -u origin main
   ```
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save.**
4. En 1–2 minutos tendrás la URL `https://TU_USUARIO.github.io/cable-scan/`. Ábrela en el móvil y usa *Añadir a pantalla de inicio* para instalarla como app.

> **Privacidad:** GitHub Pages publica la web en una URL accesible por cualquiera que la conozca, aunque el repositorio sea privado (los repos privados con Pages requieren plan de pago de GitHub). `data.json` contiene los datos del cableado. Si son confidenciales, no lo subas al repositorio: deja que cada usuario importe el Excel desde la app (⚙ → Importar Excel); los datos se quedan solo en su dispositivo.

## 2. Cómo se escanea

- **Cámara**: pestaña *Escanear* → *Activar cámara*. Usa el lector nativo del navegador (Chrome/Android) o ZXing como alternativa (iPhone/Safari). Botones de linterna y cambio de cámara cuando el dispositivo los permite. La cámara exige HTTPS (GitHub Pages ya lo es).
- **Lector USB o Bluetooth**: ponlo en modo teclado (HID). Con la app abierta basta con disparar: el código se detecta aunque no hayas tocado ningún campo. También puedes escribir el tag y pulsar Enter.
- **Modo lista (varios códigos)**: activa el interruptor; cada lectura se añade a la lista (sin duplicados, con pitido distinto si ya estaba o no se encontró). Desde la pestaña *Lista* exportas a **Excel, CSV, copiar (pegar en Google Sheets) o enviar directo a tu Google Sheet**.
- El tag leído se busca exacto en `CABLE_NUMBER`; si no hay coincidencia exacta, busca por contenido (por ejemplo `CKA32-BR03`) y te muestra las coincidencias.

## 3. Elegir columnas

Botón **▦ Columnas**: dos selecciones independientes, *En la ficha* (por defecto A–U) y *En lista / exportación*. Con filtro por nombre, y atajos *A–U*, *Todas*, *Ninguna*. La elección se recuerda en el dispositivo.

## 4. Actualizar los datos desde tu Excel

Tienes tres caminos; el más sencillo es el A.

**A. Importar el Excel desde la app (sin tocar GitHub)**
⚙ → *Importar Excel (.xlsx)* → elige `CABLEADO CONEXIONADO Y TIMBRADO BW04.xlsx`. La app localiza la hoja con la tabla principal (`CABLEADO` / `Tabla_MAIN`) y reemplaza los datos en ese dispositivo. Las notas, fotos y PDF **no se pierden** (van por tag).

**B0. Actualizar el repositorio SIN Python (todo desde el navegador)**
1. En la app: ⚙ → *Importar Excel* y elige el Excel actualizado.
2. ⚙ → *Descargar data.json (para subir a GitHub)*.
3. En GitHub: *Add file → Upload files*, arrastra ese `data.json` (mismo nombre) → *Commit changes*.
4. Espera 1–2 minutos; el resto de dispositivos lo recibe al abrir la app.

**B. Actualizar el repositorio con Python (alternativa)**
```
pip install openpyxl
python tools/xlsx_a_json.py "CABLEADO CONEXIONADO Y TIMBRADO BW04.xlsx" data.json
```
Sube el nuevo `data.json` a GitHub (reemplaza el anterior). Los dispositivos que no hayan importado un Excel a mano lo cargan solos al abrir la app; los que sí lo hicieron pueden pulsar ⚙ → *Recargar data.json del repositorio*.

**C. Desde Google Drive / Google Sheets**
1. Sube el Excel a Drive y ábrelo como Google Sheet (o copia la hoja CABLEADO a un Sheet).
2. *Archivo → Compartir → Publicar en la web* → elige la pestaña **CABLEADO** y formato **CSV** → copia la URL.
3. En la app: ⚙ → pega la URL → *Importar desde esa URL*. Repite cuando cambie la hoja.

   Aviso: "Publicar en la web" hace la hoja pública para quien tenga el enlace.

**Enviar la lista escaneada a tu Google Sheet:** abre `apps-script.gs`, sigue las instrucciones del encabezado (2 minutos) y pega la URL `/exec` en ⚙. Después, el botón *☁ Google Sheet* de la lista añade las filas a la pestaña que indiques.

## 5. PDF, fotos y notas

Al abrir un cable: *Cargar PDF* (pulling), *Tomar foto* o *Desde galería*, y un cuadro de anotaciones con fecha. Todo queda guardado en el dispositivo (IndexedDB), no en la nube. Para no perderlo o pasarlo a otro dispositivo usa ⚙ → *Exportar copia (.json)* / *Restaurar copia*, y *Exportar anotaciones (Excel)* para un listado de notas.

## Estructura

```
index.html  style.css  app.js     la app
sw.js manifest.json icon*         instalación y uso sin conexión
data.json                         datos (generado desde el Excel)
vendor/                           SheetJS (leer/escribir Excel) y ZXing (lector de códigos)
tools/xlsx_a_json.py              Excel -> data.json
apps-script.gs                    enviar la lista a Google Sheets
```
