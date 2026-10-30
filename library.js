/* Biblioteca de PDF útiles del proyecto: isométricos de bandeja y transit, ordenados por carpeta (subcarpetas de Drive) */
const LB = { q: '', tipo: '', open: new Set() };
const LB_T = { iso: 'Isométrico de bandeja', transit: 'Transit' };
const lbNat = (a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

function renderLibrary() {
  const root = $('#library'); if (!root) return;
  const adm = cloud.admin(), q = LB.q.trim().toLowerCase();
  const all = PDFS.filter(p => LB_T[p.tipo]);
  $('#lbInfo').textContent = all.length ? `${all.length} PDF` : '';
  const list = all.filter(p => (!LB.tipo || p.tipo === LB.tipo) && (!q || (p.name + ' ' + (p.carpeta || '')).toLowerCase().includes(q)));
  const groups = Object.keys(LB_T).filter(t => !LB.tipo || t === LB.tipo).map(t => {
    const cats = new Map();
    list.filter(p => p.tipo === t).forEach(p => { const k = p.carpeta || 'General'; (cats.get(k) || cats.set(k, []).get(k)).push(p); });
    return { t, cats: [...cats].sort((x, y) => (x[0] === 'General') - (y[0] === 'General') || lbNat(x[0], y[0])), n: list.filter(p => p.tipo === t).length };
  }).filter(g => g.n);
  const active = document.activeElement && document.activeElement.id === 'lbQ';
  root.innerHTML = `
    <div class="lb-tools">
      <input id="lbQ" type="search" placeholder="Buscar por nombre o carpeta" aria-label="Buscar PDF" value="${esc(LB.q)}">
      ${adm ? '<button class="btn primary" id="lbUp">Subir PDF</button>' : ''}
    </div>
    <div class="chips" id="lbTipo"><button class="filter ${LB.tipo === '' ? 'on' : ''}" data-t="">Todos</button>${Object.entries(LB_T).map(([k, v]) => `<button class="filter ${LB.tipo === k ? 'on' : ''}" data-t="${k}">${v}</button>`).join('')}</div>
    ${groups.map(g => lbGroup(g, q, adm)).join('') || lbEmpty(all.length, adm)}`;
  if (active) { const i = $('#lbQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}

function lbItem(p, adm) {
  const del = adm ? `<button class="btn small danger" data-delpdf="${esc(p.id)}">Quitar</button>` : '';
  return `<div class="item"><span class="nm">${esc(p.name.replace(/\.pdf$/i, ''))}<small>Actualizado ${esc(p.date)}</small></span><span class="go"><button class="btn small" data-pdf="${esc(p.id)}">Ver</button>${del}</span></div>`;
}
function lbGroup(g, q, adm) {
  const cats = g.cats.map(([cat, items]) => {
    const key = g.t + '|' + cat, open = q || LB.open.has(key) || g.cats.length === 1 ? 'open' : '';
    items.sort((x, y) => lbNat(x.name, y.name));
    return `<details class="lb-cat" data-k="${esc(key)}" ${open}><summary>${esc(cat)} <small class="muted">${items.length}</small></summary>${items.map(p => lbItem(p, adm)).join('')}</details>`;
  }).join('');
  return `<div class="lb-group"><h3>${LB_T[g.t]} <small>${g.n}</small></h3>${cats}</div>`;
}
function lbEmpty(total, adm) {
  const msg = total ? 'Prueba con otra palabra o quita el filtro.' : cloud.on() ? (adm ? 'Sube el primer PDF con el botón. Cada carpeta que crees aquí será una categoría.' : 'Todavía no hay PDF. Los sube quien administra la app.') : 'Conecta tu Google en Ajustes para ver los PDF.';
  return `<div class="d-empty"><h2>${total ? 'Ningún PDF coincide' : 'La biblioteca está vacía'}</h2><p>${msg}</p></div>`;
}

document.addEventListener('input', e => { if (e.target.id === 'lbQ') { LB.q = e.target.value; renderLibrary(); } });
document.addEventListener('toggle', e => { const d = e.target; if (d.classList && d.classList.contains('lb-cat')) { d.open ? LB.open.add(d.dataset.k) : LB.open.delete(d.dataset.k); } }, true);
document.addEventListener('click', async e => {
  if (!e.target.closest('#library')) return;
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.t !== undefined && t.closest('#lbTipo')) { LB.tipo = t.dataset.t; renderLibrary(); }
  else if (t.dataset.pdf) openPdfItem(PDFS.find(x => x.id === t.dataset.pdf));
  else if (t.dataset.delpdf) {
    if (!confirm('¿Quitar este PDF? Se mueve a la papelera de tu Drive y desaparece para todos.')) return;
    try { await apiPost('delPdf', { id: t.dataset.delpdf }); await syncCloud(true); renderLibrary(); toast('PDF quitado'); }
    catch (err) { toast('No se pudo quitar el PDF: ' + err.message, 5000); }
  } else if (t.id === 'lbUp') lbUpload();
});

function lbUpload() {
  const cats = [...new Set(PDFS.filter(p => LB_T[p.tipo] && p.carpeta && !p.carpeta.includes('/')).map(p => p.carpeta))].sort(lbNat);
  const o = document.createElement('div'); o.className = 'overlay modal';
  o.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-label="Subir PDF a la biblioteca">
    <div class="sheet-head"><h2>Subir PDF</h2><button class="btn quiet" type="button" id="luX">Cerrar</button></div>
    <div class="sheet-body fs-form">
      <label class="field"><span>Tipo</span><select id="luTipo">${Object.entries(LB_T).map(([k, v]) => `<option value="${k}" ${LB.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>Carpeta (por ejemplo, Nivel 3)</span><input id="luCat" list="luCats" type="text" autocomplete="off"><datalist id="luCats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="field"><span>Archivo PDF</span><input id="luFile" type="file" accept="application/pdf"></label>
      <p class="help">Si la carpeta no existe, se crea en tu Drive. Sin carpeta, queda en General.</p>
    </div>
    <div class="pdf-foot"><button class="btn primary" id="luGo" type="submit">Subir</button></div></form>`;
  document.body.appendChild(o);
  const close = () => o.remove();
  o.querySelector('#luX').onclick = close;
  o.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const f = o.querySelector('#luFile').files[0];
    if (!f) return toast('Elige un archivo PDF');
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return toast('Elige un archivo PDF');
    if (f.size > 25 * 1024 * 1024) return toast('El PDF pesa más de 25 MB y no se puede subir desde la app', 5000);
    const btn = o.querySelector('#luGo'); btn.disabled = true;
    try {
      toast(`Subiendo ${f.name}`, 60000);
      await apiPost('uploadPdf', { tipo: o.querySelector('#luTipo').value, carpeta: o.querySelector('#luCat').value.trim(), name: f.name, data: await fileToB64(f) });
      await syncCloud(true); close(); renderLibrary(); toast('PDF subido a la biblioteca', 4000);
    } catch (err) { btn.disabled = false; toast('No se pudo subir el PDF: ' + err.message, 6000); }
  };
}
