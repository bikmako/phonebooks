// One coordinator per document. No automatic reload on controllerchange.
export const CHECK_INTERVAL = 15 * 60 * 1000;
export const CHECK_THROTTLE = 60 * 1000;
export const REMIND_AFTER = 4 * 60 * 60 * 1000;
let state = { ready: false, busy: false, error: null, version: null };
const listeners = new Set();
let registration, started = false, checking = false, lastCheck = -Infinity;
let reconnectPending = false;
let waiting, deferredUntil = 0, reminderTimer;
let memoryDeferral;
const publish = next => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
export const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const getSnapshot = () => state;
const deferKey = () => `pb-update:${new URL('./', location.href).pathname}`;
export function messageWorker(worker, message, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const close = () => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); };
    const timer = setTimeout(() => { close(); reject(new Error('Обновление не отвечает. Попробуйте ещё раз.')); }, timeout);
    channel.port1.onmessage = event => { close(); event.data?.error ? reject(new Error(event.data.error)) : resolve(event.data); };
    try { worker.postMessage(message, [channel.port2]); }
    catch (error) { close(); reject(error); }
  });
}
async function inspectWaiting() {
  const worker = registration?.waiting;
  if (!worker) { waiting = null; if (state.ready) publish({ ready: false }); return; }
  if (!navigator.serviceWorker.controller) return;
  try {
    const status = await messageWorker(worker, { type: 'UPDATE_STATUS' });
    if (worker !== registration.waiting) return;
    if (!status.ready) { waiting = null; publish({ ready: false }); return; }
    waiting = worker;
    let deferred = memoryDeferral;
    try { deferred = JSON.parse(sessionStorage.getItem(deferKey())) || memoryDeferral; } catch {}
    deferredUntil = deferred?.version === status.version ? deferred.until : 0;
    publish({ version: status.version, ready: Date.now() >= deferredUntil,
      ...(state.version !== status.version ? { error: null } : {}),
    });
    clearTimeout(reminderTimer);
    if (deferredUntil > Date.now()) reminderTimer = setTimeout(() => {
      if (document.visibilityState === 'visible') void inspectWaiting();
    }, deferredUntil - Date.now());
  } catch { /* Incomplete/redundant workers are never advertised as ready. */ }
}
export function deferUpdate() {
  deferredUntil = Date.now() + REMIND_AFTER;
  memoryDeferral = { version: state.version, until: deferredUntil };
  try { sessionStorage.setItem(deferKey(), JSON.stringify(memoryDeferral)); } catch {}
  publish({ ready: false, error: null });
  clearTimeout(reminderTimer);
  reminderTimer = setTimeout(() => {
    if (document.visibilityState === 'visible') void inspectWaiting();
  }, REMIND_AFTER);
}
const boundRegistrations = new WeakSet();
function watchRegistration(next) {
  if (boundRegistrations.has(next)) return;
  boundRegistrations.add(next);
  const watch = worker => {
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') void inspectWaiting();
    });
  };
  next.addEventListener('updatefound', () => watch(next.installing));
  watch(next.installing);
}
export async function checkForUpdate(force = false) {
  if (!navigator.onLine || document.visibilityState === 'hidden') return;
  if (checking) { if (force) reconnectPending = true; return; }
  if (!force && Date.now() - lastCheck < CHECK_THROTTLE) return;
  checking = true; lastCheck = Date.now();
  try {
    if (!registration || (!registration.active && !registration.installing && !registration.waiting)) {
      // A failed FIRST installation removes its registration. Re-register after
      // reconnection too; update() on that obsolete registration cannot recover.
      const scope = new URL('./', location.href);
      registration = await navigator.serviceWorker.register(new URL('sw.js', scope), { scope: scope.href, updateViaCache: 'none' });
      watchRegistration(registration);
    } else await registration.update();
    await inspectWaiting();
  } catch { /* Failed download/quota: keep the UI; retry on the next check. */ }
  finally {
    checking = false;
    if (reconnectPending) { reconnectPending = false; void checkForUpdate(true); }
  }
}
export async function startUpdates() {
  if (started || !('serviceWorker' in navigator)) return;
  started = true;
  // Attach recovery triggers even if the first registration fails offline.
  setInterval(() => void checkForUpdate(), CHECK_INTERVAL);
  const resume = () => { if (document.visibilityState === 'visible') { void inspectWaiting(); void checkForUpdate(); } };
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', resume);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', () => void checkForUpdate(true));
  await checkForUpdate(true);
}
export function cleanupAfterBoot() {
  const version = document.querySelector('meta[name="phonebooks-build"]')?.content;
  if (version) navigator.serviceWorker?.controller?.postMessage({ type: 'CLEANUP_UPDATE', version });
}
export async function installUpdate(prepare) {
  if (state.busy) return;
  const worker = registration?.waiting;
  if (!worker || worker !== waiting || worker.state !== 'installed') {
    publish({ error: 'Обновление уже изменилось. Повторите проверку с интернетом.' });
    void checkForUpdate(true); return;
  }
  publish({ busy: true, error: null });
  let release, timer, changed;
  try {
    const status = await messageWorker(worker, { type: 'UPDATE_STATUS' });
    if (!status.ready) throw new Error('Новая версия загружена не полностью.');
    // Flush and lock writes before activating. The caller also flushes drafts.
    release = await prepare();
    let reloaded = false;
    const activated = new Promise((resolve, reject) => {
      changed = () => {
        if (navigator.serviceWorker.controller !== worker || reloaded) return;
        reloaded = true;
        resolve();
      };
      navigator.serviceWorker.addEventListener('controllerchange', changed);
      timer = setTimeout(() => reject(new Error('Активация заняла слишком много времени. Повторите попытку позже.')), 20000);
    });
    // Attach rejection handling before the message can fail.
    const activation = Promise.all([messageWorker(worker, { type: 'ACTIVATE_UPDATE' }), activated]);
    await activation;
    clearTimeout(timer);
    navigator.serviceWorker.removeEventListener('controllerchange', changed);
    // This is the only reload in the protocol, reached only after this click.
    location.reload();
  } catch (error) {
    clearTimeout(timer);
    if (changed) navigator.serviceWorker.removeEventListener('controllerchange', changed);
    release?.();
    publish({ busy: false, error: error.message });
  }
}
