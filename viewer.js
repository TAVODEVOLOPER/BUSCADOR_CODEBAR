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
  PV.zoom = 1; PV.title = title || 'PDF'; PV.texts = null; PV.q = ''; PV.matches = []; PV.cur = 0; $('#pvQ').value = ''; $('#pvCount').textContent = '';
  $('#pvTitle').textContent = PV.title;
  m.hidden = false; document.body.classList.add('no-scroll');
  $('#pvBody').scrollTop = 0;
  pvRender();
}
const pvNorm = s => Array.from(String(s)).map(c => c.normalize('NFD').replace(/[\u0300-\u036f]/g, '')[0] || c).join('').toLowerCase();
async function pvRender() {
  const tk = ++PV.token, body = $('#pvBody'), doc = PV.doc;
  body.innerHTML = ''; PV.layers = {};
  $('#pvZoom').textContent = Math.round(PV.zoom * 100) + ' %';
  const width = Math.max(240, body.clientWidth - 16) * PV.zoom, dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (let n = 1; n <= doc.numPages; n++) {
    if (tk !== PV.token) return;
    const page = await doc.getPage(n);
    const v1 = page.getViewport({ scale: 1 }), sc = width / v1.width, vp = page.getViewport({ scale: sc * dpr }), vpc = page.getViewport({ scale: sc });
    const wrap = document.createElement('div'); wrap.className = 'pv-pg'; wrap.dataset.n = n;
    wrap.style.width = width + 'px'; wrap.style.height = vpc.height + 'px';
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height; c.style.width = width + 'px'; c.style.height = vpc.height + 'px';
    const tl = document.createElement('div'); tl.className = 'textLayer'; tl.style.setProperty('--scale-factor', sc);
    wrap.append(c, tl); body.appendChild(wrap);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    if (tk !== PV.token) return;
    try {
      const strs = [], divs = [];
      await window.pdfjsLib.renderTextLayer({ textContentSource: await page.getTextContent(), container: tl, viewport: vpc, textContentItemsStr: strs, textDivs: divs }).promise;
      PV.layers[n] = { strs, divs, norm: strs.map(pvNorm) };
      pvMarkPage(n);
    } catch { /* sin texto: sigue viéndose como imagen */ }
    if (n === 1) pvPage();
  }
  pvSearch(true);
}
/* búsqueda de texto */
function pvMarkPage(n) {
  const L = PV.layers[n]; if (!L) return;
  L.divs.forEach((d, i) => { if (d.dataset.hl) { d.textContent = L.strs[i]; delete d.dataset.hl; } });
  const q = PV.q; if (!q) return;
  (PV.matches || []).forEach((m, k) => {
    if (m.page !== n) return;
    const d = L.divs[m.item], s = L.strs[m.item]; if (!d) return;
    const cur = k === PV.cur;
    if (!d.dataset.hl) { d.textContent = ''; d.dataset.hl = '1'; d._last = 0; }
    d.append(document.createTextNode(s.slice(d._last, m.start)));
    const mk = document.createElement('mark'); mk.className = cur ? 'pv-cur' : 'pv-hl'; mk.textContent = s.slice(m.start, m.start + q.length); mk.dataset.k = k; d.append(mk);
    d._last = m.start + q.length;
  });
  L.divs.forEach(d => { if (d.dataset.hl) { const s = L.strs[L.divs.indexOf(d)]; d.append(document.createTextNode(s.slice(d._last))); } });
}
async function pvLoadText() {
  if (PV.texts || !PV.doc) return;
  const doc = PV.doc, out = [];
  for (let n = 1; n <= doc.numPages; n++) { const tc = await (await doc.getPage(n)).getTextContent(); out.push(tc.items.filter(x => x.str !== undefined).map(x => x.str)); }
  if (doc === PV.doc) PV.texts = out.map(a => ({ strs: a, norm: a.map(pvNorm) }));
}
async function pvSearch(keep) {
  const raw = $('#pvQ').value.trim(); PV.q = pvNorm(raw);
  const prevCur = keep ? PV.cur : 0;
  PV.matches = []; PV.cur = 0;
  if (PV.q) {
    await pvLoadText();
    (PV.texts || []).forEach((t, p) => t.norm.forEach((s, item) => {
      let at = s.indexOf(PV.q);
      while (at >= 0) { PV.matches.push({ page: p + 1, item, start: at }); at = s.indexOf(PV.q, at + PV.q.length); }
    }));
    PV.cur = Math.min(prevCur, Math.max(0, PV.matches.length - 1));
  }
  Object.keys(PV.layers || {}).forEach(n => pvMarkPage(+n));
  $('#pvCount').textContent = !PV.q ? '' : PV.matches.length ? `${PV.cur + 1} de ${PV.matches.length}` : 'Sin resultados';
  if (!keep && PV.matches.length) pvGo(0);
}
function pvGo(k) {
  const n = PV.matches.length; if (!n) return;
  PV.cur = (k + n) % n;
  Object.keys(PV.layers || {}).forEach(p => pvMarkPage(+p));
  $('#pvCount').textContent = `${PV.cur + 1} de ${n}`;
  const m = PV.matches[PV.cur], body = $('#pvBody'), mk = body.querySelector('mark.pv-cur');
  const target = mk || body.querySelector(`.pv-pg[data-n="${m.page}"]`);
  if (target) { const r = target.getBoundingClientRect(), b = body.getBoundingClientRect(); body.scrollTop += r.top - b.top - b.height / 3; }
}
function pvPage() {
  const body = $('#pvBody'), cs = [...body.querySelectorAll('.pv-pg')]; if (!cs.length) return;
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
  $('#pvFind').addEventListener('submit', e => { e.preventDefault(); if ($('#pvQ').dataset.last === $('#pvQ').value) pvGo(PV.cur + (e.submitter && e.submitter.id === 'pvPrev' ? -1 : 1)); else { $('#pvQ').dataset.last = $('#pvQ').value; pvSearch(false); } });
  let ft; $('#pvQ').addEventListener('input', () => { clearTimeout(ft); ft = setTimeout(() => { $('#pvQ').dataset.last = $('#pvQ').value; pvSearch(false); }, 250); });
  $('#pvQ').addEventListener('keydown', e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); pvGo(PV.cur - 1); } });
  $('#pvNext').addEventListener('click', () => pvGo(PV.cur + 1));
  $('#pvPrev').addEventListener('click', () => pvGo(PV.cur - 1));
  m.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    if (m.hidden) return;
    if (e.key === 'Escape') closePdfView();
    if ((e.ctrlKey || e.metaKey) && /^f$/i.test(e.key)) { e.preventDefault(); $('#pvQ').focus(); $('#pvQ').select(); }
    if ((e.ctrlKey || e.metaKey) && /^[ps]$/i.test(e.key)) e.preventDefault();
  });
})();
