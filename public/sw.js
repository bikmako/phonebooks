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
  const cache = await caches.open(CACHE);
  return (await Promise.all(SHELL.map(url => cache.match(url, { ignoreVary: true })))).every(Boolean);
}
async function windows() {
  return (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .filter(client => client.url.startsWith(SCOPE));
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.put(META, new Response(JSON.stringify({ created: Date.now() })));
      // Verify bytes as well as status: a non-atomic deployment must never mix
      // a new index.html with files from a different release. No HTTP cache.
      for (const path of BUILT) {
        const response = await fetch(abs(path), { cache: 'reload' });
        if (!response.ok || response.redirected) throw new Error('Incomplete release');
        const bytes = await response.clone().arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (!REVISIONS[path].includes(hash)) throw new Error(`Release checksum mismatch: ${path}`);
        await cache.put(abs(path), response);
      }
      // No skipWaiting here. An installed update waits for the user's consent.
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  // Retain the previous working cache until the new document has actually booted.
  event.waitUntil(self.clients.claim());
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
      const currentMeta = await (await caches.open(CACHE)).match(META);
      if (!currentMeta) return;
      const created = (await currentMeta.json()).created;
      for (const key of await caches.keys()) {
        if (key === CACHE || !key.startsWith('phonebooks-')) continue;
        if (key.endsWith(`:${BASE}`)) {
          const oldMeta = await (await caches.open(key)).match(META);
          // A newer cache can belong to a worker currently installing/waiting.
          if (oldMeta && (await oldMeta.json()).created < created) await caches.delete(key);
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
