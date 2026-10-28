# Cable Scan BW04

App para escanear el código de barras de un cable y ver su ficha (columnas A–U de la tabla, ampliable a todas), el PDF de pulling, fotos y notas del equipo. Funciona en móvil, tablet y escritorio, y se instala como app.

## Quién hace qué

| | Tú (propietario) | El equipo (la app) |
|---|---|---|
| Tabla de cables | La editas en tu Google Sheet. Puede crecer en filas y columnas. | Solo la lee. La app no tiene ninguna función para modificarla. |
| PDF de pulling | Los copias a una carpeta de tu Drive. | Solo los abre. No pueden subirlos ni borrarlos. |
| Notas y fotos de cada tag | También puedes. | Las añaden y las ven todos. |

El equipo no necesita acceso a tu Sheet ni a tu Drive: solo la dirección de la app y una clave.

## 1. Publicar la app en GitHub (una vez)

1. En GitHub: **New repository** → `cable-scan` → Create.
2. Sube **el contenido de esta carpeta** (con `.nojekyll`, `fonts/` y `vendor/`). **No subas la carpeta `extras/`**: lleva una copia de la tabla.
3. **Settings → Pages → Deploy from a branch → `main` / `(root)` → Save.**
4. En 1–2 minutos tendrás `https://TU_USUARIO.github.io/cable-scan/`.

## 2. Conectar con tu Google (5 minutos, una vez)

1. Sube tu Excel a Google Drive y ábrelo con **Google Sheets**. La pestaña con la tabla se llama **CABLEADO** y tiene los encabezados en la fila 1 (incluida `CABLE_NUMBER`).
2. En esa hoja: **Extensiones → Apps Script**. Borra lo que haya y pega todo `apps-script.gs`.
3. Cambia `TOKEN` por una frase larga y secreta.
4. Arriba elige la función **`autorizar`** y pulsa **Ejecutar**. Acepta los permisos (si sale "Google no ha verificado esta app": *Configuración avanzada → Ir a … (no seguro)*; es tu propio script). Se crean las pestañas NOTAS, ARCHIVOS y PDF_INDEX y las carpetas **CableScan_PDF** y **CableScan_Fotos** en tu Drive.
5. **Implementar → Nueva implementación → Aplicación web.** *Ejecutar como: Yo. Quién tiene acceso: Cualquier usuario.* Copia la URL que termina en `/exec`.
6. Recarga la hoja y, en el menú nuevo **Cable Scan**, pulsa **Activar índice automático de PDF**.
7. La URL `/exec` ya viene escrita en `config.js` (campo `scriptUrl`): si creas otra implementación, cámbiala ahí y sube el archivo. En la app solo falta la clave: **Ajustes** → escribe la clave (`TOKEN`) y tu nombre → **Probar conexión**. Cada persona del equipo lo hace una vez en su dispositivo. La clave no se guarda en GitHub.

## 3. PDF de pulling

- Copia los PDF a la carpeta **CableScan_PDF** de tu Drive (se admiten subcarpetas).
- **El nombre del archivo debe contener el tag completo del cable**, por ejemplo `#HKF.BW41=731.CKA32-BR03.WG20.pdf` o `Pulling #HKF.BW41=731.CKA32-BR03.WG20 rev2.pdf`. Da igual mayúsculas o minúsculas. Un PDF sirve a varios cables si su nombre incluye varios tags.
- Con el índice automático, los PDF nuevos aparecen en la app en unos 30 minutos. Para verlos ya: menú **Cable Scan → Actualizar índice de PDF** en la hoja.
- Si ya tienes los PDF en otra carpeta, pon su ID (el final de la URL de la carpeta) en `PDF_FOLDER_ID` del script.
- Máximo 30 MB por PDF.

## 4. Cuando la tabla crece

Añade filas y columnas en la pestaña CABLEADO cuando quieras:
- La app descarga la tabla al abrirse **solo si cambió** (ahorra datos móviles). También se puede forzar en **Ajustes → Actualizar la tabla ahora**.
- Los cables nuevos se encuentran al escanear y al buscar.
- Las columnas nuevas **no** se añaden solas a la ficha (para no cambiar lo que ve el equipo): la app avisa y las marca como "Nueva" en **Columnas**, donde se activan con un toque.
- Mantén `CABLE_NUMBER` y los encabezados en la fila 1.

## 5. Cómo se usa

- **Escanear**: cámara, lector USB o Bluetooth en modo teclado (basta con tener la app abierta) o escribir el tag. Las etiquetas son Code 128 y llevan el tag completo; al ser largas tienen barras muy finas, así que con la cámara: buena luz, el código dentro del recuadro amarillo y lo bastante cerca para que ocupe casi todo el ancho (botón de zoom si tu móvil lo tiene). Un lector USB o Bluetooth las lee sin esfuerzo.
- **Modo lista**: lee varios códigos seguidos. En **Lista**: Excel, CSV, copiar para pegar en Sheets o **Enviar a Google Sheet** (pestaña ESCANEOS).
- **Buscar**: por parte del tag, con filtros por status.
- **Ficha**: columnas elegidas, PDF de Drive, fotos (Hacer foto o galería) y notas con tu nombre. Sin cobertura todo queda pendiente y se sube solo al volver la conexión.
- **Columnas**: elige las de la ficha y las de la lista/Excel por separado.

## 6. Instalar como app

- **Android y PC (Chrome o Edge):** botón **Instalar** de la barra superior, o menú del navegador → Instalar app.
- **iPhone y iPad:** en Safari, **Compartir → Añadir a pantalla de inicio**.
- Una vez instalada abre sin barra del navegador y funciona sin conexión con los datos ya descargados. Incluye accesos directos (Escanear, Buscar, Lista) al mantener pulsado el icono en Android.

## 7. Versión y actualizaciones

La versión se ve en el pie de la app (menú lateral en escritorio, final de la pantalla Escanear en móvil y Ajustes → Acerca de). Sale de `config.js`: al publicar cambios, sube el número de `version` y los dispositivos instalados se actualizan solos y avisan.

## 8. Pantallas

- **Móvil:** pestañas abajo; la ficha ocupa toda la pantalla y el botón Atrás del móvil la cierra. La cámara se abre a pantalla completa con zoom, linterna, cambio de cámara, enfoque al tocar, aviso verde o rojo al leer, modo lista y pantalla siempre encendida. Al volver a abrir la app se reactiva sola si estaba activa.
- **Tablet:** panel izquierdo con las pestañas y ficha a la derecha.
- **Escritorio (a partir de 900 px):** menú lateral (Escanear, Buscar, Lista, Columnas, Ajustes) con el estado de la conexión y la versión; en medio la lista o la búsqueda y a la derecha la ficha. En **Lista** la tabla usa todo el ancho y la ficha se abre al lado. Atajos: `/` busca, `Esc` cierra la ficha o la ventana abierta.
- Claro u oscuro según el sistema.

## Seguridad

La URL `/exec` es pública pero toda acción exige la clave `TOKEN`. Quien tenga URL y clave puede leer los datos y añadir o borrar notas y fotos (no puede modificar la tabla ni los PDF). Para cambiar la clave: edita `TOKEN`, crea *Nueva versión* de la implementación y actualiza la clave en cada dispositivo. Borrar una nota o foto la borra para todos (las fotos van a la papelera de Drive).

## Estructura

```
index.html  style.css  app.js     la app
config.js                         versión y URL de tu script (lo único que se edita al publicar)
fonts/                            tipografía B612 incluida (funciona sin conexión)
vendor/                           SheetJS (Excel) y ZXing (lector de códigos)
sw.js manifest.json icon*.png     instalación y modo sin conexión
apps-script.gs                    servidor en tu Google (se pega en Apps Script)
tools/xlsx_a_json.py              Excel a data.json (solo si no usas Google)
extras/data.json                  copia de la tabla (NO subir a GitHub)
```
