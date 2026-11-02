/* Búsqueda por columnas, como el filtro de Excel, reutilizable (Conexionado, Almacén):
   - "Buscar en": columnas donde se busca el texto (por defecto, todas).
   - "Filtrar por columna": marca valores de una o varias columnas (entre columnas se combinan con Y). */
class ColFilter {
  constructor(o) { this.o = o; this.sc = null; this.f = new Map(); this.mode = ''; this.col = -1; this.root = null; }
  cols() { return this.o.columns(); }
  mount(root) {
    this.root = root;
    root.innerHTML = `<div class="sfbar"><button class="filter" data-cf="cols" type="button" aria-expanded="false"></button><button class="filter" data-cf="filter" type="button" aria-expanded="false">Filtrar por columna</button><button class="filter" data-cf="clear" type="button" hidden>Quitar filtros</button></div><div class="sfpanel cfpanel" hidden></div><div class="filters cf-active"></div>`;
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-cf],[data-cfx],[data-cfa],[data-cfc]'); if (!b) return;
      if (b.dataset.cf === 'cols') { this.mode = this.mode === 'cols' ? '' : 'cols'; this.paint(); }
      else if (b.dataset.cf === 'filter') { this.mode = this.mode === 'filter' ? '' : 'filter'; this.paint(); }
      else if (b.dataset.cf === 'clear') { this.f.clear(); this.change(); this.paint(); }
      else if (b.dataset.cfx !== undefined) { this.mode = ''; this.paint(); }
      else if (b.dataset.cfc !== undefined) { this.f.delete(+b.dataset.cfc); this.change(); this.paint(); }
      else if (b.dataset.cfa) {
        const set = this.f.get(this.col) || new Set();
        if (b.dataset.cfa === 'none') set.clear();
        else if (b.dataset.cfa === 'allcols') { this.sc = null; this.change(); this.paint(); return; }
        else this.root.querySelectorAll('.cfpanel .sf-item:not([hidden]) input[data-v]').forEach(i => set.add(i.dataset.v));
        set.size ? this.f.set(this.col, set) : this.f.delete(this.col); this.change(); this.paint();
      }
    });
    root.addEventListener('input', e => {
      if (!e.target.classList.contains('sf-find')) return;
      const t = (this.o.norm || (s => String(s).toLowerCase()))(e.target.value);
      e.target.parentElement.querySelectorAll('.sf-item').forEach(el => { el.hidden = !!t && !el.dataset.n.includes(t); });
    });
    root.addEventListener('change', e => {
      const t = e.target;
      if (t.id === this.o.id + 'Sel') { this.col = +t.value; this.paint(); return; }
      if (t.dataset.c !== undefined) {
        const all = this.cols().map((_, i) => i), cur = this.sc ? new Set(this.sc) : new Set(all), c = +t.dataset.c;
        t.checked ? cur.add(c) : cur.delete(c);
        this.sc = !cur.size || cur.size === all.length ? null : cur; this.change(); this.label();
      } else if (t.dataset.v !== undefined) {
        const set = this.f.get(this.col) || new Set();
        t.checked ? set.add(t.dataset.v) : set.delete(t.dataset.v);
        set.size ? this.f.set(this.col, set) : this.f.delete(this.col); this.change(); this.chips();
      }
    });
    this.paint();
  }
  change() { this.o.onChange && this.o.onChange(); }
  cell(r, c) { const v = String(r[c] ?? '').trim(); return v === '' ? '(vacío)' : v; }
  active() { return this.f.size > 0; }
  reset() { this.f.clear(); this.sc = null; this.mode = ''; this.col = -1; if (this.root) this.paint(); }
  /* ¿la fila cumple los filtros de columna? */
  test(r) { for (const [c, set] of this.f) if (!set.has(this.cell(r, c))) return false; return true; }
  /* ¿la fila contiene el texto en las columnas elegidas? (q ya normalizado, por palabras) */
  matches(r, q, norm) {
    if (!q) return true;
    const cols = this.sc ? [...this.sc] : r.map((_, i) => i), hay = cols.map(c => norm(r[c])).join(' ');
    return q.split(/\s+/).every(w => hay.includes(w));
  }
  label() {
    const b = this.root.querySelector('[data-cf="cols"]'), cs = this.cols();
    b.textContent = 'Buscar en: ' + (!this.sc ? 'todas las columnas' : this.sc.size === 1 ? cs[[...this.sc][0]].name : this.sc.size + ' columnas');
    b.classList.toggle('on', this.mode === 'cols'); b.setAttribute('aria-expanded', this.mode === 'cols');
  }
  chips() {
    const cs = this.cols(), el = this.root.querySelector('.cf-active');
    this.root.querySelector('[data-cf="clear"]').hidden = !this.f.size;
    el.innerHTML = [...this.f].map(([c, set]) => cs[c] ? `<button class="filter on" data-cfc="${c}" type="button" title="Quitar este filtro">${this.o.esc(cs[c].name)}: ${set.size === 1 ? this.o.esc([...set][0]) : set.size + ' valores'} ✕</button>` : '').join('');
  }
  paint() {
    if (!this.root) return;
    const cs = this.cols(), esc = this.o.esc, norm = this.o.norm || (s => String(s).toLowerCase());
    [...this.f.keys()].forEach(c => { if (!cs[c]) this.f.delete(c); });
    this.label(); this.chips();
    const f = this.root.querySelector('[data-cf="filter"]'); f.classList.toggle('on', this.mode === 'filter'); f.setAttribute('aria-expanded', this.mode === 'filter');
    const p = this.root.querySelector('.cfpanel'); p.hidden = !this.mode; if (!this.mode) return;
    if (this.mode === 'cols') {
      p.innerHTML = `<button class="sf-x" type="button" data-cfx="1">Cerrar</button><input class="sf-find" type="search" placeholder="Buscar columna" autocomplete="off"><div class="sf-acts"><button class="btn" data-cfa="allcols" type="button">Todas las columnas</button></div><div class="sf-list">`
        + cs.map((c, i) => `<label class="sf-item" data-n="${esc(norm(c.name))}"><input type="checkbox" data-c="${i}" ${!this.sc || this.sc.has(i) ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('') + `</div><p class="help">El texto se busca en las columnas marcadas.</p>`;
    } else {
      if (this.col < 0 || !cs[this.col]) this.col = this.o.defCol ? this.o.defCol() : 0;
      const cnt = new Map(); this.o.rows().forEach(r => { const v = this.cell(r, this.col); cnt.set(v, (cnt.get(v) || 0) + 1); });
      const vals = [...cnt].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'es', { numeric: true })), sel = this.f.get(this.col) || new Set();
      p.innerHTML = `<button class="sf-x" type="button" data-cfx="1">Cerrar</button><label class="field"><span>Columna</span><select id="${this.o.id}Sel">${cs.map((c, i) => `<option value="${i}" ${i === this.col ? 'selected' : ''}>${esc(c.name)}${this.f.has(i) ? ' •' : ''}</option>`).join('')}</select></label>
        <input class="sf-find" type="search" placeholder="Buscar valor (${vals.length.toLocaleString('es-ES')} distintos)" autocomplete="off">
        <div class="sf-acts"><button class="btn" data-cfa="all" type="button">Marcar visibles</button><button class="btn" data-cfa="none" type="button">Desmarcar todo</button></div>
        <div class="sf-list">${vals.slice(0, 800).map(([v, n]) => `<label class="sf-item" data-n="${esc(norm(v))}"><input type="checkbox" data-v="${esc(v)}" ${sel.has(v) ? 'checked' : ''}><span>${esc(v)}</span><small>${n}</small></label>`).join('')}</div>
        <p class="help">${vals.length > 800 ? 'Se muestran los primeros 800 valores; usa el buscador. ' : ''}Sin ninguno marcado no se filtra esta columna.</p>`;
    }
    if (innerWidth >= 900) { const t = Math.max(8, this.root.querySelector('.sfbar').getBoundingClientRect().top); p.style.top = t + 'px'; p.style.maxHeight = (innerHeight - t - 16) + 'px'; } else p.style.top = p.style.maxHeight = '';
  }
}
