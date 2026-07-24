// MisGastos Service Worker
// Estrategias:
//  - Documento (index.html): Stale-While-Revalidate — responde al instante desde
//    caché y actualiza la copia en segundo plano. Los cambios en index.html llegan
//    solos en la siguiente apertura, SIN necesidad de subir CACHE_NAME.
//  - Fuentes de Google: Cache First con revalidación en segundo plano.
//  - Resto de recursos locales (íconos, manifest): Cache First.
// Toda petición de red lleva límite de tiempo: en redes moribundas (metro) el
// fetch no falla, se queda colgado — y un recurso que bloquea el render colgado
// equivale a app que no carga aunque todo esté en caché.
// CACHE_NAME solo necesita subirse cuando cambia este archivo (sw.js) o la lista
// de precache; el navegador detecta el sw.js nuevo automáticamente en cada visita.
const CACHE_NAME = 'misgastos-v14';

// Recursos que se cachean al instalar
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

// CSS de fuentes: se precachea best-effort (si falla, la app usa fuente del
// sistema; los .woff2 se cachean solos la primera vez que la red los entrega)
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap';

// Dominios externos que también se cachean (fuentes)
const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

// fetch con límite de tiempo. Sin esto, en "lie-fi" (señal de una raya que no
// transmite) la promesa de fetch puede tardar minutos en rechazar.
function fetchTimeout(request, ms){
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      r => { clearTimeout(timer); resolve(r); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
}

// Guardar en caché solo respuestas completas y NO redirigidas: Safari se niega a
// navegar con una respuesta redirigida servida desde un service worker, y una
// sola entrada así envenenada rompe todos los arranques offline siguientes.
function cachePut(request, response){
  if(response && response.status === 200 && !response.redirected){
    const clone = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
  }
  return response;
}

// ── INSTALL: precachear recursos locales ──
// Solo el documento es crítico; el resto es best-effort. Lección aprendida:
// addAll es atómico y en GitHub Pages faltaban icon-192/512 → 404 → la
// instalación fallaba completa y el iPhone se quedaba con un SW viejo sin los
// fixes offline (aunque el HTML sí se actualizaba y mostraba versión nueva).
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(['./', './index.html'])
        .then(() => Promise.all(
          PRECACHE.concat(FONT_CSS).map(url =>
            cache.match(url).then(hit => hit || cache.add(url).catch(() => null))
          )
        )))
      .then(() => self.skipWaiting()) // activar inmediatamente
  );
});

// ── MESSAGE: reparación de caché bajo demanda ──
// v19: iOS puede desechar CacheStorage (presión de almacenamiento) aunque la app
// siga instalada — la página lo detecta al abrir con red y pide re-precachear.
self.addEventListener('message', event => {
  if(event.data && event.data.type === 'ENSURE_PRECACHE'){
    event.waitUntil(
      caches.open(CACHE_NAME).then(cache =>
        Promise.all(PRECACHE.concat(FONT_CSS).map(url =>
          cache.match(url, { ignoreSearch: true })
            .then(hit => hit || cache.add(url).catch(() => null))
        ))
      )
    );
  }
});

// ── ACTIVATE: limpiar cachés viejos ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim()) // tomar control de pestañas abiertas
  );
});

// Página mínima cuando no hay red NI caché (solo puede pasar en la primera carga)
function offlineFallback(){
  return new Response(
    `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>MisGastos — Sin conexión</title>
    <style>
      body{font-family:sans-serif;background:#F8F8F7;display:flex;align-items:center;
        justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px;}
      h1{font-size:20px;color:#111;}p{font-size:14px;color:#666;text-align:center;}
      button{background:#111;color:#fff;border:none;border-radius:100px;
        padding:12px 28px;font-size:15px;font-weight:600;cursor:pointer;}
    </style></head>
    <body>
      <div style="font-size:48px;">📵</div>
      <h1>Sin conexión</h1>
      <p>MisGastos no pudo cargar.<br>Conecta a internet para la primera carga.</p>
      <button onclick="location.reload()">Reintentar</button>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// Buscar el documento en caché con red de seguridad: primero la URL pedida
// (ignorando query string — la home screen de iOS puede añadir parámetros),
// luego las entradas del precache. Si la copia guardada quedó marcada como
// redirigida (precache viejo), se reconstruye limpia para que Safari la acepte.
function matchDocument(request){
  return caches.match(request, { ignoreSearch: true })
    .then(r => r || caches.match('./index.html'))
    .then(r => r || caches.match('./'))
    .then(r => {
      if(r && r.redirected){
        return r.blob().then(body =>
          new Response(body, { status: 200, headers: r.headers })
        );
      }
      return r;
    });
}

// ── FETCH ──
self.addEventListener('fetch', event => {
  // Solo manejar GET
  if(event.request.method !== 'GET') return;

  // Fuentes de Google: Cache First + revalidación en segundo plano. Antes eran
  // Network First y el CSS de fuentes BLOQUEA el render: en el metro la petición
  // colgaba sin fallar y la app se quedaba en blanco pese a estar cacheada.
  if(FONT_ORIGINS.some(origin => event.request.url.startsWith(origin))){
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fresh = fetchTimeout(event.request, 4000)
          .then(response => cachePut(event.request, response))
          .catch(() => null);
        // Con caché responde ya (fresh actualiza para la próxima); sin caché,
        // máximo 4 s de espera y se suelta el render con la fuente del sistema.
        return cached || fresh.then(r => r || Response.error());
      })
    );
    return;
  }

  // Documento: Stale-While-Revalidate — sirve la copia cacheada al instante y
  // refresca en segundo plano; la siguiente apertura ya trae la versión nueva.
  if(event.request.mode === 'navigate' || event.request.destination === 'document'){
    event.respondWith(
      matchDocument(event.request).then(cached => {
        const fresh = fetchTimeout(event.request, 8000)
          .then(response => cachePut(event.request, response))
          .catch(() => null);
        // Con caché: responde ya (fresh sigue corriendo y actualiza para la próxima).
        // Sin caché (primera visita): espera la red; si tampoco hay, página offline.
        return cached || fresh.then(r => r || offlineFallback());
      })
    );
    return;
  }

  // Resto de recursos locales (íconos, manifest): Cache First, red como respaldo
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if(cached) return cached;
        return fetchTimeout(event.request, 8000)
          .then(response => cachePut(event.request, response))
          // Sin red y sin caché: error de red explícito (antes devolvía
          // undefined, que rompe el respondWith con un TypeError críptico).
          .catch(() => Response.error());
      })
  );
});
