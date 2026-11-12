import fs from 'node:fs/promises';
export async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open('phonebooks', 1); req.onsuccess = () => resolve(req.result); req.onerror = reject; });
    const result = {};
    for (const name of ['state', 'backups', 'meta']) result[name] = await new Promise(resolve => { const req = db.transaction(name).objectStore(name).getAll(); req.onsuccess = () => resolve(req.result); });
    db.close();
    return { ...result, localStorage: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])) };
  });
}
export async function exportFile(page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать полную копию', exact: true }).click();
  const file = await download; return JSON.parse(await fs.readFile(await file.path(), 'utf8'));
}
export const upload = (page, data) => page.getByLabel('Файл резервной копии').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) });
export async function commitAndReload(page) {
  // The business-name field can update before the application reloads. Wait for
  // the new document before reading IndexedDB or issuing a second navigation.
  const navigation = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
  await page.getByRole('button', { name: 'Подтвердить импорт', exact: true }).click();
  await navigation; await page.waitForLoadState('load');
  await page.getByRole('button', { name: 'Скачать полную копию', exact: true }).waitFor();
}
