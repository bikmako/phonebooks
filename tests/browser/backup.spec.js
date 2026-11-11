import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open('phonebooks', 1); req.onsuccess = () => resolve(req.result); req.onerror = reject; });
    const result = {};
    for (const name of ['state', 'backups', 'meta']) result[name] = await new Promise(resolve => { const req = db.transaction(name).objectStore(name).getAll(); req.onsuccess = () => resolve(req.result); });
    db.close();
    return { ...result, localStorage: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])) };
  });
}
async function exportFile(page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать полную копию', exact: true }).click();
  const file = await download; return JSON.parse(await fs.readFile(await file.path(), 'utf8'));
}
const upload = (page, data) => page.getByLabel('Файл резервной копии').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) });
test.beforeEach(async ({ page }) => {
  await page.goto('./#/settings');
  await expect(page.getByRole('button', { name: 'Скачать полную копию', exact: true })).toBeVisible();
});

test('export, readonly preview, cancel, confirmations, import, reload and full restoration', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(() => { localStorage.setItem('phonebooks.draft.purchase', '{"model":"Черновик"}'); localStorage.setItem('phonebooks.theme', 'dark'); localStorage.setItem('unrelated', 'kept'); });
  const file = await exportFile(page);
  expect(file.formatVersion).toBe(2);
  expect(file.snapshot.localStorage).toContainEqual({ key: 'phonebooks.draft.purchase', value: '{"model":"Черновик"}' });
  const before = await snapshot(page);
  const incoming = structuredClone(file);
  incoming.snapshot.indexedDB.state[0].value.settings.businessName = 'Перенесённый бизнес';
  incoming.snapshot.localStorage = [{ key: 'phonebooks.theme', value: 'light' }];
  await upload(page, incoming);
  await expect(page.getByRole('heading', { name: 'Предварительный просмотр импорта' })).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Подтвердить импорт', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Отмена без записи' }).click();
  expect(await snapshot(page)).toEqual(before);
  await upload(page, incoming);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать предварительную полную копию' }).click();
  await download;
  await page.getByLabel('Я сохранил предварительную копию и подтверждаю импорт').check();
  await expect(page.getByRole('button', { name: 'Подтвердить импорт', exact: true })).toBeDisabled();
  await page.getByLabel('Отдельно разрешаю заменить существующие данные, тему и черновики').check();
  await page.getByRole('button', { name: 'Подтвердить импорт', exact: true }).click();
  await expect(page.getByLabel('Название бизнеса')).toHaveValue('Перенесённый бизнес');
  await expect(page.getByRole('heading', { name: 'Предварительный просмотр импорта' })).not.toBeVisible();
  let after = await snapshot(page);
  expect(after.localStorage['phonebooks.theme']).toBe('light');
  expect(after.localStorage['phonebooks.draft.purchase']).toBeUndefined();
  expect(after.localStorage.unrelated).toBe('kept');
  await page.getByText('Полные копии перед импортом (1)', { exact: true }).click();
  await page.getByRole('button', { name: 'Просмотреть', exact: true }).click();
  await page.getByRole('button', { name: 'Скачать предварительную полную копию' }).click();
  await page.getByLabel('Я сохранил предварительную копию и подтверждаю импорт').check();
  await page.getByLabel('Отдельно разрешаю заменить существующие данные, тему и черновики').check();
  await page.getByRole('button', { name: 'Подтвердить импорт', exact: true }).click();
  await expect(page.getByLabel('Название бизнеса')).toHaveValue('Моя скупка');
  after = await snapshot(page);
  expect(after.state).toEqual(before.state);
  expect(after.backups).toEqual(before.backups);
  expect(after.localStorage).toEqual(before.localStorage);
  expect(errors).toEqual([]);
});

test('malformed and future format files do not change browser storage', async ({ page }) => {
  const file = await exportFile(page), before = await snapshot(page);
  await upload(page, '{broken');
  await expect(page.getByRole('alert')).toContainText('Копия не принята');
  expect(await snapshot(page)).toEqual(before);
  file.formatVersion = 500;
  await upload(page, file);
  await expect(page.getByRole('alert')).toContainText('Неизвестный формат');
  expect(await snapshot(page)).toEqual(before);
});

test('service worker caches Pages subpath and opens application offline', async ({ page, context }) => {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Скачать полную копию', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Скачать полную копию', exact: true })).toBeVisible();
  expect((await exportFile(page)).formatVersion).toBe(2);
  await context.setOffline(false);
});

test('changed database after preview prevents overwrite in the real browser', async ({ page }) => {
  const file = await exportFile(page);
  await upload(page, file);
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const req = indexedDB.open('phonebooks', 1); req.onsuccess = () => resolve(req.result); });
    await new Promise(resolve => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put('concurrent', 'another-tab'); tx.oncomplete = resolve; }); db.close();
  });
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Скачать предварительную полную копию' }).click();
  await page.getByLabel('Я сохранил предварительную копию и подтверждаю импорт').check();
  await page.getByLabel('Отдельно разрешаю заменить существующие данные, тему и черновики').check();
  await page.getByRole('button', { name: 'Подтвердить импорт', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('изменились');
  expect(await snapshot(page)).toEqual(before);
});

test('read-only bridge exports the original build and migrates between origins', async ({ page, context }) => {
  const legacy = await context.newPage();
  await legacy.goto('http://127.0.0.1:4174/backup/original-build/index.html#/settings');
  await expect(legacy.getByRole('button', { name: 'Скачать файл', exact: true })).toBeVisible();
  await legacy.evaluate(() => { localStorage.setItem('phonebooks.draft.purchase', '{"model":"Netlify draft"}'); localStorage.setItem('phonebooks.theme', 'dark'); });
  const before = await snapshot(legacy);
  const bridge = await fs.readFile('tools/export-netlify-backup.js', 'utf8');
  const requestUrls = []; legacy.on('request', request => requestUrls.push(request.url()));
  const download = legacy.waitForEvent('download');
  await legacy.evaluate(bridge);
  const file = JSON.parse(await fs.readFile(await (await download).path(), 'utf8'));
  expect(await snapshot(legacy)).toEqual(before);
  expect(requestUrls).toEqual([]);
  const { parseImportFile } = await import('../../src/storage/backupFormat.js');
  expect(parseImportFile(JSON.stringify(file)).error).toBeNull();
  await upload(page, file);
  await page.getByRole('button', { name: 'Скачать предварительную полную копию' }).click();
  await page.getByLabel('Я сохранил предварительную копию и подтверждаю импорт').check();
  await page.getByLabel('Отдельно разрешаю заменить существующие данные, тему и черновики').check();
  await page.getByRole('button', { name: 'Подтвердить импорт', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Предварительный просмотр импорта' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Скачать полную копию', exact: true })).toBeVisible();
  const after = await snapshot(page);
  expect(after.state).toEqual(before.state);
  expect(after.localStorage).toEqual(before.localStorage);
  expect(await snapshot(legacy)).toEqual(before);
});

test('bridge does not create a database on an empty origin', async ({ context }) => {
  const empty = await context.newPage();
  await empty.goto('http://127.0.0.1:4174/README.md');
  const bridge = await fs.readFile('tools/export-netlify-backup.js', 'utf8');
  await empty.evaluate(bridge);
  expect(await empty.evaluate(async () => (await indexedDB.databases()).map(x => x.name))).toEqual([]);
});

test('corrupt current data blocks startup and remains intact', async ({ page }) => {
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const req = indexedDB.open('phonebooks', 1); req.onsuccess = () => resolve(req.result); });
    await new Promise(resolve => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put({ damaged: true }, 'current'); tx.oncomplete = resolve; }); db.close();
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Автоматическая перезапись заблокирована');
  expect((await snapshot(page)).state).toEqual([{ damaged: true }]);
});

test('mobile preview allows cancellation without storage writes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const file = await exportFile(page), before = await snapshot(page);
  await upload(page, file);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена без записи' }).click();
  expect(await snapshot(page)).toEqual(before);
});
