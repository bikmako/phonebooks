/* PhoneBooks service worker: офлайн-оболочка и кеширование ассетов.
   Работает под любым путём (например /phonebooks/): все адреса считаются от scope воркера.
   Данные приложения лежат в IndexedDB и этим воркером не затрагиваются. */
const CACHE = 'phonebooks-v8';
const SCOPE = self.registration.scope;            // напр. https://bikmako.github.io/phonebooks/
const BASE = new URL(SCOPE).pathname;             // напр. /phonebooks/
const abs = (p) => new URL(p, SCOPE).href;
const INDEX = abs('./index.html');

// список собранных ассетов (относительные пути, актуален для текущей сборки)
const BUILT = ["./","./index.html","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png","./icons/apple-touch-icon.png","./fonts/manrope-cyrillic.woff2","./fonts/manrope-latin.woff2","./assets/charts-DM28DfPR.js","./assets/icons-B2J5C2Sm.js","./assets/index-BAX7GeKn.js","./assets/index-D8TNLwJT.css","./assets/react-C74ucnfc.js"];
const SHELL = BUILT.map(abs);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // удаляем только СТАРЫЕ кеши PhoneBooks; чужие кеши на этом домене не трогаем
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('phonebooks-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Внешние домены и всё вне нашего пути не трогаем
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  // Навигация: сеть (в обход HTTP-кеша GitHub Pages), при отсутствии сети — кеш (офлайн-оболочка)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(INDEX, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(INDEX).then((r) => r || caches.match(SCOPE)))
    );
    return;
  }

  // Шрифты: cache-first без сетевых запросов после первого скачивания.
  // В новой сборке шрифты лежат в assets/ с хэшем в имени, поэтому проверяем и расширение.
  if (url.pathname.startsWith(BASE + 'fonts/') || url.pathname.endsWith('.woff2')) {
    event.respondWith(caches.match(request, { ignoreVary: true }).then((r) => r || fetch(request)));
    return;
  }

  // Ассеты: cache-first с фоновым обновлением
  event.respondWith(
    // Same-origin static files: module requests include Origin, while precache
    // requests do not. Vary: Origin (e.g. Vite preview) must not hide offline assets.
    caches.match(request, { ignoreVary: true }).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
