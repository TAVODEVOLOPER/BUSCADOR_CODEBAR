/* Avisos para el administrador: cambios nuevos del personal. Insignias en el menú, aviso del sistema (con la app abierta)
   y enlace directo a la pantalla del cambio. Con la app cerrada avisa el correo de Apps Script (avisarCambios). */
const AVI = { on: () => LS.get('avOn', false) && cloud.admin() };
const avSeen = () => LS.get('avSeen', null);
function avBadge(el, n) {
  if (!el) return; const old = el.querySelector(':scope > .bdg'); if (old) old.remove();
  if (n > 0) el.insertAdjacentHTML('beforeend', `<span class="bdg" aria-label="${n} por imputar">${n > 99 ? '99+' : n}</span>`);
}
async function avCurrent() {
  const notes = (await DB.all('notes')).filter(n => n.synced && n.rev !== 'Imputado');
  const cx = []; (typeof CX !== 'undefined' && CX.pmap ? CX.pmap : new Map()).forEach((o, tag) => o.forEach(e => e.ids.forEach(id => cx.push({ id, who: e.who, tag }))));
  return { notes, cx };
}
function avGo(go) {
  if (go === 'conex') { if (typeof CX !== 'undefined') { CX.src = 'pend'; CX.lim = 120; } setTab('cbuscar'); }
  else if (go === 'almacen') setTab('almacen');
  else setTab('cambios');
}
async function avCheck() {
  if (!cloud.admin()) { $$('.bdg').forEach(b => b.remove()); $('#btnNav').classList.remove('has-new'); return; }
  const { notes, cx } = await avCurrent(), cxCables = new Set(cx.map(x => x.tag)).size;
  avBadge($('.snav[data-tab="cambios"]'), notes.length); avBadge($('.sgrp[data-mod="cab"] > summary'), notes.length);
  avBadge($('.snav[data-tab="cbuscar"]'), cxCables); avBadge($('.sgrp[data-mod="con"] > summary'), cxCables);
  $('#btnNav').classList.toggle('has-new', notes.length + cxCables > 0);
  const seen = avSeen(), now = { n: notes.map(n => n.uid), c: cx.map(x => x.id) };
  if (!seen) { LS.set('avSeen', now); return; }   // la primera vez solo se anota el punto de partida
  const nn = notes.filter(n => !seen.n.includes(n.uid)), nc = cx.filter(x => !seen.c.includes(x.id));
  LS.set('avSeen', { n: [...new Set([...seen.n.filter(u => now.n.includes(u)), ...now.n])], c: [...new Set([...seen.c.filter(u => now.c.includes(u)), ...now.c])] });
  if (!nn.length && !nc.length) return;
  const who = [...new Set([...nn.map(n => n.author), ...nc.map(x => x.who)].filter(Boolean))];
  const body = [nn.length ? `${nn.length} status/notas de cableado` : '', nc.length ? `${new Set(nc.map(x => x.tag)).size} cable(s) de conexionado` : ''].filter(Boolean).join(' y ') + (who.length ? ` · ${who.slice(0, 3).join(', ')}` : '');
  avNotify('Cambios nuevos del personal', body, nn.length ? 'cambios' : 'conex');
}
async function avNotify(title, body, go) {
  toast(`${title}: ${body}`, 5000);
  if (!AVI.on() || !('Notification' in window) || Notification.permission !== 'granted') return;
  const opt = { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'cs-' + go, renotify: true, data: { go } };
  try { const reg = await navigator.serviceWorker.ready; await reg.showNotification(title, opt); }
  catch { try { const n = new Notification(title, opt); n.onclick = () => { window.focus(); avGo(go); n.close(); }; } catch { /* sin permiso */ } }
}
function avPaintSet() {
  const sec = $('#sAvSec'); if (!sec) return; sec.hidden = !cloud.admin(); if (sec.hidden) return;
  const sup = 'Notification' in window, perm = sup ? Notification.permission : 'unsupported';
  $('#sAvOn').checked = LS.get('avOn', false) && perm === 'granted'; $('#sAvOn').disabled = !sup || perm === 'denied';
  $('#sAvHelp').textContent = !sup ? 'Este navegador no permite avisos. En iPhone instala la app (Compartir, Añadir a pantalla de inicio) y vuelve a probar.'
    : perm === 'denied' ? 'Las notificaciones están bloqueadas para esta página: actívalas en los ajustes del navegador.'
    : 'Con la app abierta (también en segundo plano) te avisa al instante y al tocar el aviso te lleva al cambio. Con la app cerrada usa el aviso por correo (instalarAvisos en Apps Script).';
}
document.addEventListener('change', async e => {
  if (e.target.id !== 'sAvOn') return;
  if (e.target.checked) { const p = await Notification.requestPermission().catch(() => 'denied'); LS.set('avOn', p === 'granted'); if (p === 'granted') avNotify('Avisos activados', 'Te avisaré de los cambios del personal', 'cambios'); }
  else LS.set('avOn', false);
  avPaintSet();
});
document.addEventListener('click', e => {
  if (e.target.closest('#btnSettings,.snav[data-proxy="btnSettings"]')) setTimeout(avPaintSet, 0);
  if (e.target.id === 'sAvTest') avNotify('Cambios nuevos del personal', 'Así se ve un aviso. Tócalo para abrir los cambios.', 'cambios');
});
/* enlace directo: #cambios, #conex, #almacen (desde el correo o desde el aviso) */
function avHash() { const h = location.hash.replace('#', ''); if (/^(cambios|conex|almacen)$/.test(h)) { history.replaceState(null, '', location.pathname + location.search); setTimeout(() => avGo(h), 600); } }
window.addEventListener('hashchange', avHash);
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.go) avGo(e.data.go); });
setTimeout(avHash, 800);
/* con el aviso activado se revisa cada 90 s aunque la pestaña esté en segundo plano */
setInterval(() => { if (AVI.on() && cloud.on() && navigator.onLine) { syncCloud(true); if (typeof cxSync === 'function') cxSync(true); } }, 90000);
setTimeout(avCheck, 2500);
