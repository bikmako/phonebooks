/**
 * PhoneBooks read-only migration bridge. Run in DevTools on the OLD origin.
 * No network, localStorage writes, database creation, upgrades or deletes.
 * Close other tabs/forms and wait for the saved indicator before running.
 */
(async () => {
  const localKeys = key => key === 'phonebooks.theme' || key === 'phonebooks.data.v1' || key.startsWith('phonebooks.draft.');
  const readLocal = () => Object.keys(localStorage).filter(localKeys).sort().map(key => ({ key, value: localStorage.getItem(key) }));
  const before = readLocal();
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('phonebooks');
    request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('База PhoneBooks отсутствует; экспорт остановлен без создания базы')); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () => reject(new Error('Закройте другие вкладки'));
  });
  try {
    if (db.version !== 1 || !['state', 'backups', 'meta'].every(name => db.objectStoreNames.contains(name))) throw new Error('Неизвестная схема базы');
    const tx = db.transaction(['state', 'backups', 'meta'], 'readonly');
    const complete = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); });
    const stores = await Promise.all(['state', 'backups', 'meta'].map(name => new Promise((resolve, reject) => {
      const entries = [], request = tx.objectStore(name).openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { entries.push({ key: cursor.key, value: cursor.value }); cursor.continue(); }
        else resolve([name, entries]);
      };
    }))).then(Object.fromEntries);
    await complete;
    if (JSON.stringify(before) !== JSON.stringify(readLocal())) throw new Error('Настройки или черновики изменились во время выгрузки. Повторите экспорт');
    if (!stores.state.some(x => x.key === 'current') || stores.meta.some(x => x.key === 'pendingImport')) throw new Error('Нет текущей базы или есть незавершённый импорт');
    const file = { app: 'PhoneBooks', formatVersion: 2, schemaVersion: 1, exportedAt: new Date().toISOString(), snapshot: { indexedDB: { name: 'phonebooks', version: 1, ...stores }, localStorage: before } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `phonebooks-netlify-full-${Date.now()}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    console.info('Полная копия PhoneBooks подготовлена. Проверьте наличие файла в загрузках. Старая база не изменена.');
  } finally { db.close(); }
})().catch(error => { console.error('Экспорт PhoneBooks остановлен:', error.message); });
