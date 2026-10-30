/* Visor de PDF de solo lectura: se dibuja en pantalla (pdf.js), sin botón de descarga ni de impresión */
const PV = { doc: null, zoom: 1, token: 0, title: '' };
async function openPdfBlob(blob, title) {
  const m = $('#pvModal');
  try {
    if (!window.pdfjsLib) {
      await loadScript('vendor/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }
    const buf = await blob.arrayBuffer();
    if (PV.doc) { try { PV.doc.destroy(); } catch { } }
    PV.doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
  } catch (e) { toast('No se pudo abrir el PDF: ' + e.message, 5000); return; }
  PV.zoom = 1; PV.title = title || 'PDF';
  $('#pvTitle').textContent = PV.title;
  m.hidden = false; document.body.classList.add('no-scroll');
  $('#pvBody').scrollTop = 0;
  pvRender();
}
async function pvRender() {
  const tk = ++PV.token, body = $('#pvBody'), doc = PV.doc;
  body.innerHTML = '';
  $('#pvZoom').textContent = Math.round(PV.zoom * 100) + ' %';
  const width = Math.max(240, body.clientWidth - 16) * PV.zoom, dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (let n = 1; n <= doc.numPages; n++) {
    if (tk !== PV.token) return;
    const page = await doc.getPage(n);
    const v1 = page.getViewport({ scale: 1 }), sc = width / v1.width, vp = page.getViewport({ scale: sc * dpr });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height; c.style.width = width + 'px'; c.style.height = (vp.height / dpr) + 'px';
    c.dataset.n = n; body.appendChild(c);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    if (n === 1) pvPage();
  }
}
function pvPage() {
  const body = $('#pvBody'), cs = [...body.querySelectorAll('canvas')]; if (!cs.length) return;
  const mid = body.scrollTop + body.clientHeight / 3; let cur = 1;
  for (const c of cs) { if (c.offsetTop <= mid) cur = +c.dataset.n; }
  $('#pvPage').textContent = `${cur} / ${PV.doc.numPages}`;
}
function closePdfView() {
  PV.token++; $('#pvModal').hidden = true; $('#pvBody').innerHTML = ''; document.body.classList.remove('no-scroll');
  if (PV.doc) { try { PV.doc.destroy(); } catch { } PV.doc = null; }
}
async function openPdfItem(p) {
  toast('Abriendo ' + p.name, 2500);
  try { await openPdfBlob(await ensurePdf(p), p.name.replace(/\.pdf$/i, '')); }
  catch (err) { toast(navigator.onLine ? 'No se pudo abrir el PDF: ' + err.message : 'Sin cobertura y este PDF no se abrió antes en este dispositivo. Ábrelo una vez con señal y quedará guardado', 6000); }
}
(function () {
  const m = $('#pvModal'); if (!m) return;
  $('#pvClose').addEventListener('click', closePdfView);
  $('#pvIn').addEventListener('click', () => { PV.zoom = Math.min(4, PV.zoom * 1.25); pvRender(); });
  $('#pvOut').addEventListener('click', () => { PV.zoom = Math.max(.5, PV.zoom / 1.25); pvRender(); });
  $('#pvFit').addEventListener('click', () => { PV.zoom = 1; pvRender(); });
  $('#pvBody').addEventListener('scroll', pvPage, { passive: true });
  m.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    if (m.hidden) return;
    if (e.key === 'Escape') closePdfView();
    if ((e.ctrlKey || e.metaKey) && /^[ps]$/i.test(e.key)) e.preventDefault();
  });
})();
