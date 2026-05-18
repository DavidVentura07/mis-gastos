// MisGastos Service Worker
// Estrategia: Cache First para recursos estáticos, Network First para fuentes
const CACHE_NAME = 'misgastos-v1';

// Recursos que se cachean al instalar
const PRECACHE = [
  './',
  './index.html',
  './icon-180.png',
];

// Dominios externos que también se cachean (fuentes)
const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

// ── INSTALL: precachear recursos locales ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()) // activar inmediatamente
  );
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

// ── FETCH: servir desde caché cuando no hay red ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Solo manejar GET
  if(event.request.method !== 'GET') return;

  // Fuentes de Google: Network First, fallback a caché
  if(FONT_ORIGINS.some(origin => event.request.url.startsWith(origin))){
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Guardar copia fresca en caché
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request)) // sin red → usar caché
    );
    return;
  }

  // Recursos locales (HTML, PNG): Cache First, red como respaldo
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if(cached) return cached;

        // No está en caché → intentar red
        return fetch(event.request)
          .then(response => {
            // Guardar en caché para la próxima vez
            if(response && response.status === 200){
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => {
            // Sin red y sin caché: devolver página offline básica
            if(event.request.destination === 'document'){
              return new Response(
                `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
                <meta name="viewport" content="width=device-width,initial-scale=1">
                <title>MisGastos — Sin conexión</title>
                <style>
                  body{font-family:sans-serif;background:#F8F8F7;display:flex;align-items:center;
                    justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px;}
                  h1{font-size:20px;color:#111;}p{font-size:14px;color:#666;text-align:center;}
                  button{background:#6C63FF;color:#fff;border:none;border-radius:100px;
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
          });
      })
  );
});
