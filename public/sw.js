/* Only application files live in Cache Storage. IndexedDB and localStorage are
   deliberately outside the service worker's update protocol. */
const VERSION = 'phonebooks-v9-template';
const SCOPE = self.registration.scope;
const BASE = new URL(SCOPE).pathname;
const CACHE = `${VERSION}:${BASE}`;
const BUILT = [];
const REVISIONS = {};
const abs = path => new URL(path, SCOPE).href;
const INDEX = abs('./index.html');
const SHELL = BUILT.map(abs);
const META = abs('./__phonebooks_cache_metadata');

async function complete() {
  if (!(await caches.has(CACHE))) return false;
  const cache = await caches.open(CACHE);
  const cached = new Set((await cache.keys()).map(request => request.url));
  return SHELL.every(url => cached.has(url));
}
async function windows() {
  return (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .filter(client => client.url.startsWith(SCOPE));
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.put(META, new Response(JSON.stringify({ status: 'pending' })));
      // Verify bytes as well as status: a non-atomic deployment must never mix
      // a new index.html with files from a different release. No HTTP cache.
      for (const path of BUILT) {
        // Pages canonicalizes index.html to the scope directory (308). Fetch
        // that URL directly, but retain index.html as the verified cache key.
        const source = path === './index.html' ? SCOPE : abs(path);
        const response = await fetch(source, { cache: 'reload' });
        if (!response.ok || response.redirected) throw new Error(`Incomplete release: ${path} (${response.status}, redirected=${response.redirected})`);
        const bytes = await response.clone().arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (!REVISIONS[path].includes(hash)) throw new Error(`Release checksum mismatch: ${path}`);
        await cache.put(abs(path), response);
      }
      // No skipWaiting here. An installed update waits for the user's consent.
    } catch (error) {
      await caches.delete(CACHE);
      console.error('[PhoneBooks update] Installation failed', VERSION, error);
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  // Retain the previous working cache until the new document has actually booted.
  event.waitUntil((async () => {
    // This marker also protects a reused cache during a rollback installation.
    // Losing a metadata write must not prevent an otherwise complete UI boot.
    try { await (await caches.open(CACHE)).put(META, new Response(JSON.stringify({ status: 'active' }))); } catch {}
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  const reply = value => event.ports[0]?.postMessage(value);
  event.waitUntil((async () => {
    if (!event.source?.url?.startsWith(SCOPE)) return;
    if (event.data?.type === 'UPDATE_STATUS') {
      reply({ version: VERSION, ready: await complete() });
    } else if (event.data?.type === 'ACTIVATE_UPDATE') {
      if (!(await complete())) return reply({ error: 'Новая версия загружена не полностью. Повторите проверку с интернетом.' });
      if ((await windows()).some(client => client.id !== event.source.id)) {
        return reply({ error: 'Закройте остальные вкладки и окна PhoneBooks, затем нажмите «Обновить» ещё раз.' });
      }
      reply({ ok: true });
      await self.skipWaiting();
    } else if (event.data?.type === 'CLEANUP_UPDATE' && event.data.version === VERSION) {
      // Only the matching, successfully booted UI may remove old application
      // caches, and only when no other tab could still need their assets.
      if ((await windows()).some(client => client.id !== event.source.id)) return;
      // CacheStorage.keys() is ordered by creation. Wall-clock dates can move
      // backwards on a phone and must never decide which release is newer.
      const keys = await caches.keys(), current = keys.indexOf(CACHE);
      if (current < 0) return;
      for (const key of keys.slice(0, current)) {
        if (key === CACHE || !key.startsWith('phonebooks-')) continue;
        if (key.endsWith(`:${BASE}`)) {
          const oldMeta = await (await caches.open(key)).match(META);
          // Even an older name can be reused by an installing rollback worker.
          if (oldMeta && (await oldMeta.json()).status === 'pending') continue;
          await caches.delete(key);
        }
        else if (!key.includes(':')) {
          // Legacy caches have no scope in their name. Check every URL first.
          const old = await caches.open(key), requests = await old.keys();
          if (requests.length && requests.every(request => request.url.startsWith(SCOPE))) await caches.delete(key);
        }
      }
    }
  })().catch(() => reply({ error: 'Не удалось подготовить обновление. Попробуйте позже.' })));
});
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  // The index and all its files come from the SAME installed release, including
  // online navigation. Only sw.js is checked against the network for updates.
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(INDEX, { ignoreVary: true }))
      .then(response => response || Response.error()));
  } else if (SHELL.includes(url.href)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(request, { ignoreVary: true }))
      .then(response => response || Response.error()));
  } else if (url.pathname.startsWith(BASE + 'assets/') || url.pathname.startsWith(BASE + 'scanner-assets/')) {
    // A tab opened during activation, or an activation that finished after a
    // UI timeout, may still request an old content-addressed module. Its exact
    // URL can be served from the retained old release until the new UI boots.
    event.respondWith((async () => {
      for (const key of (await caches.keys()).reverse()) {
        if (!key.startsWith('phonebooks-') || (key.includes(':') && !key.endsWith(`:${BASE}`))) continue;
        const cached = await (await caches.open(key)).match(request, { ignoreVary: true });
        if (cached) return cached;
      }
      return fetch(request);
    })());
  }
});
