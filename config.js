/* Configuración de la app. Es lo único que hay que tocar al publicar una versión nueva.
   - version: se muestra en el pie de página y renombra la caché (así los móviles se actualizan solos).
   - scriptUrl: dirección de tu aplicación web de Google (termina en /exec). Es pública; la clave NO va aquí. */
self.CABLE_CONFIG = {
  version: '1.8.1',
  disciplina: 'INS',       // disciplina que se cuenta al importar el CC_SCHEDULE desde un Excel (el script usa su propio DISCIPLINA_FILTRO)
  metaSemanal: 3000,       // meta de metros tendidos por semana (se puede cambiar en Ajustes)
  scriptUrl: 'https://script.google.com/macros/s/AKfycbxWm5f4wOms0N2NyhOCwsshL9m9Zj4eO6wMHbMekD-Lxef_NzK5PrMKopxXIrHqD9UGog/exec'
};
