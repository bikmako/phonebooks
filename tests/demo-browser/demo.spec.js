import { test, expect } from '@playwright/test';
import bwipjs from 'bwip-js';
import { checkDataIntegrity } from '../../src/domain/integrity.js';
import { getStats, getTotalMoney } from '../../src/utils/calculations.js';
import { getPeriod } from '../../src/utils/format.js';

async function state(page, name = 'phonebooks-demo') {
  return page.evaluate(async name => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open(name, 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const value = await new Promise(resolve => { const r = db.transaction('state').objectStore('state').get('current'); r.onsuccess = () => resolve(r.result); }); db.close(); return value;
  }, name);
}
async function ready(page, route = 'settings') {
  await page.goto('./#/' + route);
  await expect(page.getByRole('region', { name: 'Демонстрационная версия' })).toBeVisible();
}
async function reset(page) {
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Сбросить демо', exact: true }).click();
  await page.getByRole('button', { name: 'Восстановить тестовые данные', exact: true }).click();
  await expect(page.getByText('Демо восстановлено', { exact: true })).toBeVisible();
}
async function denyCamera(page) {
  await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { throw new DOMException('Test denial', 'NotAllowedError'); } } }));
}
async function openPurchase(page) {
  await page.goto('./#/purchase?action=purchase');
  await expect(page.locator('#model')).toBeVisible();
}

test('first launch is synthetic, all routes fit mobile, backup UI absent, CTA has a useful fallback', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  const s = await state(page);
  expect(s.phones).toHaveLength(14); expect(checkDataIntegrity(s)).toEqual([]);
  expect(getStats(s, getPeriod('month')).netProfit).toBe(51370);
  expect(getTotalMoney(s)).toBe(1020770);
  await expect(page.getByLabel('Файл резервной копии')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Скачать|импорт|восстановлени/i })).toHaveCount(0);
  await expect(page.getByText('Всё сходится', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Купить полную версию', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Контакт продавца пока не указан');
  await page.getByRole('button', { name: 'Понятно', exact: true }).click();
  for (const route of ['dashboard', 'purchase', 'sales', 'accessories', 'finance', 'history', 'settings']) {
    await page.goto('./#/' + route); await expect(page.locator('main')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const banner = page.getByRole('region', { name: 'Демонстрационная версия' });
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await expect(banner).toBeInViewport();
    await expect(banner.getByText('Купить полную версию')).toBeInViewport();
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath('demo-settings.png'), animations: 'disabled' });
  await page.goto('./#/dashboard'); await expect(page.locator('main')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('demo-dashboard.png'), animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('purchase, completed sale, finance and drafts persist; confirmed reset restores all demo data', async ({ page }) => {
  await ready(page); const original = await state(page);
  await openPurchase(page);
  await page.locator('#model').fill('Покупатель пробует Pixel'); await page.locator('#price').fill('10000');
  await page.getByRole('button', { name: 'Купить телефон', exact: true }).click();
  await expect.poll(async () => (await state(page)).phones.length).toBe(15);
  await page.reload();
  await page.locator('main').getByText('Покупатель пробует Pixel').filter({ visible: true }).first().click();
  await page.getByRole('button', { name: /Продать/ }).last().click();
  await expect(page.getByRole('button', { name: 'Продать', exact: true })).toBeVisible();
  await page.locator('#sale-price').fill('15000');
  await page.getByRole('button', { name: 'Продать', exact: true }).click();
  await expect.poll(async () => (await state(page)).sales.length).toBe(9);
  const sold = await state(page);
  expect(checkDataIntegrity(sold)).toEqual([]); expect(getTotalMoney(sold)).toBe(1025770);
  expect(getStats(sold, getPeriod('month')).netProfit).toBe(56370);
  await page.goto('./#/settings');
  await page.getByLabel('Название бизнеса').fill('Мой тестовый магазин'); await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(async () => (await state(page)).settings.businessName).toBe('Мой тестовый магазин');
  await openPurchase(page); await page.locator('#model').fill('Черновик для сброса');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('phonebooks.demo.draft.phone-new'))).toContain('Черновик для сброса');
  await page.goto('./#/settings'); await page.getByRole('button', { name: 'Сбросить демо', exact: true }).click();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect((await state(page)).phones.length).toBe(15);
  await reset(page); await page.reload();
  const restored = await state(page);
  expect(restored.phones.length).toBe(original.phones.length); expect(restored.settings).toEqual(original.settings);
  expect(getStats(restored, getPeriod('month'))).toEqual(getStats(original, getPeriod('month')));
  expect(getTotalMoney(restored)).toBe(getTotalMoney(original));
  expect(await page.evaluate(() => localStorage.getItem('phonebooks.demo.draft.phone-new'))).toBeNull();
  await openPurchase(page); await expect(page.locator('#model')).toHaveValue('');
});

test('paid database, legacy keys, drafts, theme and caches survive demo launch, edits and reset', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('paid-seeded')) return;
    localStorage.setItem('phonebooks.data.v1', 'invalid paid legacy, must never be parsed');
    localStorage.setItem('phonebooks.theme', 'dark'); localStorage.setItem('phonebooks.draft.phone-new', '{"model":"Private draft"}');
    const r = indexedDB.open('phonebooks', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('state'); r.result.createObjectStore('backups', { keyPath: 'id' }); r.result.createObjectStore('meta'); };
    r.onsuccess = () => {
      const tx = r.result.transaction(['state', 'backups', 'meta'], 'readwrite');
      tx.objectStore('state').put({ private: 'paid sentinel' }, 'current'); tx.objectStore('backups').put({ id: 'paid-backup', payload: 'private backup' }); tx.objectStore('meta').put('private metadata', 'pendingImport');
      tx.oncomplete = () => { r.result.close(); sessionStorage.setItem('paid-seeded', 'yes'); };
    };
    caches.open('phonebooks-v9-sentinel').then(cache => cache.put('/paid-sentinel', new Response('paid cached value')));
  });
  await ready(page); await expect.poll(() => page.evaluate(() => sessionStorage.getItem('paid-seeded'))).toBe('yes');
  await reset(page); await page.reload();
  expect(await state(page, 'phonebooks')).toEqual({ private: 'paid sentinel' });
  expect(await page.evaluate(() => localStorage.getItem('phonebooks.data.v1'))).toBe('invalid paid legacy, must never be parsed');
  expect(await page.evaluate(() => localStorage.getItem('phonebooks.theme'))).toBe('dark');
  expect(await page.evaluate(() => localStorage.getItem('phonebooks.draft.phone-new'))).toContain('Private draft');
  expect(await page.evaluate(async () => (await caches.open('phonebooks-v9-sentinel')).match('/paid-sentinel').then(r => r.text()))).toBe('paid cached value');
  await expect(page.getByRole('button', { name: 'Скачать исходные данные для восстановления' })).toHaveCount(0);
});

for (const type of ['code128', 'ocr']) test(`offline IMEI ${type}, camera denial recovery and purchase work without external requests`, async ({ page, context }) => {
  await denyCamera(page); await ready(page);
  const external = []; page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:4175/')) external.push(r.url()); });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })); });
  await context.setOffline(true); await page.reload(); await openPurchase(page);
  await page.getByRole('button', { name: 'Сканировать IMEI', exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: 'Сканировать IMEI', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('запрещён');
  const imei = '490154203237518';
  const buffer = type === 'code128' ? await bwipjs.toBuffer({ bcid: 'code128', text: imei, scale: 3, height: 20, padding: 20, backgroundcolor: 'FFFFFF' }) : Buffer.from(await page.evaluate(imei => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 650;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,1200,650); ctx.fillStyle = '#111'; ctx.font = '48px monospace'; ctx.fillText('IMEI ' + imei,60,200); return canvas.toDataURL().split(',')[1];
  }, imei), 'base64');
  await page.getByLabel('Изображение с IMEI', { exact: true }).setInputFiles({ name: 'imei.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#imei').last()).toHaveValue(imei, { timeout: 60000 });
  await page.locator('#model').fill('Офлайн демо'); await page.locator('#price').fill('5000');
  await page.getByRole('button', { name: 'Купить телефон', exact: true }).click();
  await expect.poll(async () => (await state(page)).phones[0]?.model).toBe('Офлайн демо');
  await page.reload(); expect((await state(page)).phones[0].imei).toBe(imei);
  await reset(page); expect((await state(page)).phones).toHaveLength(14);
  expect(external).toEqual([]); await context.setOffline(false);
});

test('a stale tab cannot write over reset data', async ({ page, context }) => {
  await ready(page); const other = await context.newPage(); await ready(other);
  await reset(page);
  await other.getByLabel('Название бизнеса').fill('Устаревшая вкладка'); await other.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(other.getByText(/База изменена другой вкладкой/)).toBeVisible();
  expect((await state(page)).settings.businessName).toBe('PhoneBooks · Демо-магазин'); await other.close();
});

test('accessory stock changes, expenses and cash operations recalculate finances and reset cleanly', async ({ page }) => {
  await ready(page, 'accessories');
  await page.getByRole('button', { name: 'Количество', exact: true }).first().click();
  let dialog = page.getByRole('dialog', { name: 'Изменить количество', exact: true });
  // Write off one item from the first (low-stock) case batch: 280 roubles cost.
  await dialog.getByRole('button', { name: '1', exact: true }).first().click();
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect.poll(async () => getStats(await state(page), getPeriod('month')).writeOff).toBe(840);
  await page.goto('./#/finance'); await page.getByRole('button', { name: 'Расход', exact: true }).first().click();
  dialog = page.getByRole('dialog', { name: 'Новый расход', exact: true });
  await dialog.getByPlaceholder('0', { exact: true }).fill('1000');
  await dialog.getByRole('button', { name: /Добавить|Сохранить/ }).click();
  await expect.poll(async () => (await state(page)).expenses.length).toBe(4);
  await page.getByRole('button', { name: 'Пополнить', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Пополнение счёта', exact: true });
  await dialog.getByPlaceholder('0', { exact: true }).fill('2000');
  await dialog.getByRole('button', { name: /Пополнить|Сохранить/ }).click();
  await expect.poll(async () => (await state(page)).cashOps.length).toBe(3);
  const s = await state(page); expect(checkDataIntegrity(s)).toEqual([]);
  expect(getTotalMoney(s)).toBe(1021770); expect(getStats(s, getPeriod('month')).netProfit).toBe(50090);
  await reset(page); expect(getTotalMoney(await state(page))).toBe(1020770);
});

test('corrupt demo state offers confirmed synthetic reset and no diagnostic export', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('phonebooks-demo', 1); r.onsuccess = () => resolve(r.result); });
    await new Promise(resolve => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put({ broken: true }, 'current'); tx.oncomplete = resolve; }); db.close();
  });
  await page.reload(); await expect(page.getByRole('alert')).toContainText('Текущее состояние повреждено');
  await expect(page.getByRole('button', { name: /Скачать/ })).toHaveCount(0);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Сбросить демо', exact: true }).click();
  expect(await state(page)).toEqual({ broken: true });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Сбросить демо', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Демонстрационная версия' })).toBeVisible();
  expect((await state(page)).phones).toHaveLength(14);
});

test('demo refuses the paid origin before opening databases or registering a service worker', async ({ page, request }) => {
  await page.addInitScript(() => {
    window.openedDatabases = [];
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, ...rest) { window.openedDatabases.push(name); return original.call(this, name, ...rest); };
  });
  await page.route('https://bikmako.github.io/**', async route => {
    const url = new URL(route.request().url());
    const response = await request.get('http://127.0.0.1:4175' + url.pathname);
    await route.fulfill({ response });
  });
  await page.goto('https://bikmako.github.io/demo/');
  await expect(page.getByText('ДЕМО нужно разместить на отдельном домене', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.openedDatabases)).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});
