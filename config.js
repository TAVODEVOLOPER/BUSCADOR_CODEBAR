/* Configuración de la app. Es lo único que hay que tocar al publicar una versión nueva.
   - version: se muestra en el pie de página y renombra la caché (así los móviles se actualizan solos).
   - scriptUrl: dirección de tu aplicación web de Google (termina en /exec). Es pública; la clave NO va aquí. */
self.CABLE_CONFIG = {
  version: '1.2.0',
  scriptUrl: 'https://script.google.com/macros/s/AKfycbxdSR_6VmlQweLM3Q9wxOvcgKfNDnrSmXD9O8SLqsDJe6OIkSPfEGkkN_9EBkaXshH16Q/exec'
};
