/* Configuración de la app. Es lo único que hay que tocar al publicar una versión nueva.
   - version: se muestra en el pie de página y renombra la caché (así los móviles se actualizan solos).
   - scriptUrl: dirección de tu aplicación web de Google (termina en /exec). Es pública; la clave NO va aquí. */
self.CABLE_CONFIG = {
  version: '1.12.0',
  disciplina: 'INS',       // disciplina que se cuenta al importar el CC_SCHEDULE desde un Excel (el script usa su propio DISCIPLINA_FILTRO)
  pinHash: 'b68be563a5aa8402b5d444082d8d7dd62c6b3ddb2853d9ac273341894d47ca99',             // opcional: SHA-256 de un PIN para abrir Ajustes (vacío = sin PIN). Pídemelo y lo calculo
  metaSemanal: 3000,       // meta de metros tendidos por semana (se puede cambiar en Ajustes)
  scriptUrl: 'https://script.google.com/macros/s/AKfycbxWm5f4wOms0N2NyhOCwsshL9m9Zj4eO6wMHbMekD-Lxef_NzK5PrMKopxXIrHqD9UGog/exec'
};
