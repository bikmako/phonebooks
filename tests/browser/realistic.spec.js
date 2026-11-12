import { test, expect } from '@playwright/test';
import { snapshot, exportFile, upload, commitAndReload } from './helpers.js';
import { realisticSnapshot } from '../fixtures/realistic.js';
import { buildExportFile } from '../../src/storage/backupFormat.js';
async function confirm(page, successful = true) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать предварительную полную копию' }).click(); await download;
  await page.getByLabel('Я сохранил предварительную копию и подтверждаю импорт').check();
  await page.getByLabel('Отдельно разрешаю заменить существующие данные, тему и черновики').check();
  if (successful) await commitAndReload(page);
  else await page.getByRole('button', { name: 'Подтвердить импорт', exact: true }).click();
}
async function ready(page) {
  await expect(page.getByRole('button', { name: 'Скачать полную копию', exact: true })).toBeEnabled();
}
async function seed(page, fixture) {
  await page.evaluate(async fixture => {
    const db = await new Promise(resolve => { const r = indexedDB.open('phonebooks', 1); r.onsuccess = () => resolve(r.result); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['state', 'backups', 'meta'], 'readwrite');
      for (const name of ['state', 'backups', 'meta']) { const store = tx.objectStore(name); store.clear(); for (const entry of fixture.indexedDB[name]) name === 'backups' ? store.put(entry.value) : store.put(entry.value, entry.key); }
      tx.oncomplete = resolve; tx.onabort = reject;
    }); db.close();
    for (const entry of fixture.localStorage) localStorage.setItem(entry.key, entry.value);
  }, fixture);
  await page.reload(); await ready(page);
  // The store can be ready before Settings applies its state-to-input effect.
  // Wait for the seeded value so that effect cannot overwrite the next fill.
  await expect(page.getByLabel('Название бизнеса')).toHaveValue(fixture.indexedDB.state[0].value.settings.businessName);
}
test.beforeEach(async ({ page }) => { await page.goto('./#/settings'); await ready(page); });

test('realistic data: exact round-trip, route rendering, reload, cancellation and full recovery', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const fixture = realisticSnapshot(); await seed(page, fixture);
  const original = await exportFile(page), before = await snapshot(page);
  expect(original.snapshot).toEqual(fixture);
  const box = await page.getByText('Загрузить из файла', { exact: true }).boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  for (const route of ['dashboard', 'purchase', 'sales', 'accessories', 'finance', 'history', 'settings']) {
    await page.goto('./#/' + route); await expect(page.locator('main')).toBeVisible();
  }
  await ready(page);
  await upload(page, original);
  expect(await snapshot(page)).toEqual(before);
  for (const name of ['Отмена без записи', 'Подтвердить импорт']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  }
  await page.getByRole('button', { name: 'Отмена без записи' }).click();
  expect(await snapshot(page)).toEqual(before);
  await upload(page, original); await confirm(page); await ready(page);
  await page.reload(); await ready(page);
  const roundtrip = await exportFile(page);
  expect(roundtrip.snapshot.indexedDB.state).toEqual(original.snapshot.indexedDB.state);
  expect(roundtrip.snapshot.indexedDB.backups).toEqual(original.snapshot.indexedDB.backups);
  expect(roundtrip.snapshot.localStorage).toEqual(original.snapshot.localStorage);
  expect(roundtrip.snapshot.indexedDB.meta).toContainEqual(fixture.indexedDB.meta.find(entry => entry.key === 'fixture-metadata'));
  const changed = structuredClone(original); changed.snapshot.indexedDB.state[0].value.settings.businessName = 'Замена'; changed.snapshot.localStorage = [];
  await upload(page, changed); await confirm(page);
  await expect(page.getByLabel('Название бизнеса')).toHaveValue('Замена');
  const details = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Полные копии перед импортом' }) });
  await details.locator('summary').click(); await details.getByRole('button', { name: 'Просмотреть' }).last().click();
  await confirm(page);
  await expect(page.getByLabel('Название бизнеса')).toHaveValue(fixture.indexedDB.state[0].value.settings.businessName);
  const restored = await exportFile(page);
  expect(restored.snapshot.indexedDB.state).toEqual(fixture.indexedDB.state);
  expect(restored.snapshot.localStorage).toEqual(fixture.localStorage);
  await page.goto('./#/purchase?action=purchase');
  await expect(page.getByPlaceholder('iPhone 13', { exact: true })).toHaveValue('Черновик Pixel');
  await page.goto('./#/sales');
  await page.getByRole('button', { name: 'Продажа', exact: true }).click();
  await expect(page.getByPlaceholder('Клиент', { exact: true })).toHaveValue('Учебный черновик');
  expect(errors).toEqual([]);
});

test('journal restart restores exact drafts and state before editing', async ({ page }) => {
  const fixture = realisticSnapshot(); await seed(page, fixture); const before = await snapshot(page);
  await page.evaluate(async () => {
    const entries = Object.keys(localStorage).filter(key => key.startsWith('phonebooks.')).map(key => ({ key, value: localStorage.getItem(key) }));
    const db = await new Promise(resolve => { const r = indexedDB.open('phonebooks', 1); r.onsuccess = () => resolve(r.result); });
    await new Promise(resolve => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ localStorage: entries }, 'pendingImport'); tx.oncomplete = resolve; }); db.close();
    localStorage.clear(); localStorage.setItem('phonebooks.theme', 'light');
  });
  await page.reload(); await ready(page);
  expect(await snapshot(page)).toEqual(before);
});

for (const failure of ['localStorage', 'IndexedDB']) test(`realistic import rolls back ${failure} write failure without loss`, async ({ page }) => {
  const fixture = realisticSnapshot(); await seed(page, fixture); const before = await snapshot(page);
  const incoming = buildExportFile(fixture); incoming.snapshot.indexedDB.state[0].value.settings.businessName = 'Injected'; incoming.snapshot.localStorage = [{ key: 'phonebooks.theme', value: 'light' }];
  await upload(page, incoming);
  await page.evaluate(failure => {
    if (failure === 'localStorage') { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'phonebooks.theme' && value === 'light') { Storage.prototype.setItem = original; throw new DOMException('Injected quota', 'QuotaExceededError'); } return original.call(this, key, value); }; }
    else { const original = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(value, ...args) { if (this.name === 'state' && value.settings?.businessName === 'Injected') { IDBObjectStore.prototype.put = original; throw new DOMException('Injected quota', 'QuotaExceededError'); } return original.call(this, value, ...args); }; }
  }, failure);
  await confirm(page, false);
  await expect(page.getByRole('alert')).toContainText('Injected quota');
  expect(await snapshot(page)).toEqual(before);
  await page.reload(); await ready(page); expect(await snapshot(page)).toEqual(before);
});

test('ordinary recovery point previews, cancels and restores; displaced drafts stay recoverable', async ({ page }) => {
  const fixture = realisticSnapshot(); await seed(page, fixture);
  await page.getByLabel('Название бизнеса').fill('Изменённое название');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).state[0].settings.businessName).toBe('Изменённое название');
  const before = await snapshot(page);
  const details = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Точки восстановления' }) });
  await details.locator('summary').click(); await details.getByRole('button', { name: 'Просмотреть' }).click();
  await expect(page.getByText(/Старая копия: только состояние базы/)).toBeVisible();
  await page.getByRole('button', { name: 'Отмена без записи' }).click(); expect(await snapshot(page)).toEqual(before);
  await details.getByRole('button', { name: 'Просмотреть' }).click(); await confirm(page);
  await expect(page.getByLabel('Название бизнеса')).toHaveValue(fixture.indexedDB.state[0].value.settings.businessName);
  const restored = await exportFile(page);
  expect(restored.snapshot.indexedDB.state).toEqual(fixture.indexedDB.state);
  expect(restored.snapshot.localStorage).toEqual([{ key: 'phonebooks.theme', value: 'dark' }]);
  const recovery = restored.snapshot.indexedDB.meta.find(entry => entry.key.startsWith('recovery:')).value;
  expect(recovery.localStorage).toEqual(fixture.localStorage);
});
