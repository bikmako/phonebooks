import { test, expect } from '@playwright/test';
import bwipjs from 'bwip-js';
import { snapshot } from './helpers.js';

const first = '490154203237518';
const second = '356938035643809';

async function denyCamera(page, name = 'NotAllowedError') {
  await page.addInitScript(name => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => { throw new DOMException('Test camera failure', name); },
    } });
  }, name);
}
async function ready(page) {
  await page.goto('./#/settings');
  await expect(page.getByRole('button', { name: 'Скачать полную копию', exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const req = indexedDB.open('phonebooks', 1); req.onsuccess = () => resolve(req.result); });
    await new Promise(resolve => {
      const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state');
      const req = store.get('current');
      req.onsuccess = () => { const state = req.result; state.accounts[0].openingBalance = 100000; store.put(state, 'current'); };
      tx.oncomplete = resolve;
    }); db.close();
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Скачать полную копию', exact: true })).toBeEnabled();
  await page.goto('./#/purchase?action=purchase');
  await expect(page.locator('#imei').last()).toBeVisible();
}
async function open(page) {
  await page.getByRole('button', { name: 'Сканировать IMEI', exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: 'Сканировать IMEI', exact: true })).toBeVisible();
}
async function textImage(page, lines) {
  const encoded = await page.evaluate(lines => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 650;
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 1200, 650);
    context.fillStyle = '#111'; context.font = '48px monospace';
    lines.forEach((line, index) => context.fillText(line, 60, 90 + index * 105));
    return canvas.toDataURL('image/png').split(',')[1];
  }, lines);
  return { name: 'imei.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') };
}
async function recognize(page, fixture) {
  await page.getByLabel('Изображение с IMEI', { exact: true }).setInputFiles(fixture);
  await expect.poll(async () => page.locator('.imei-scanner-body[aria-busy="true"]').count(), { timeout: 60000 }).toBe(0);
}
async function choose(page, imei) {
  if (await page.getByRole('dialog').count()) await page.getByRole('button', { name: `Выбрать IMEI ${imei}`, exact: true }).click();
  await expect(page.locator('#imei').last()).toHaveValue(imei);
}

test('real OCR: dual-SIM screen, automatic filling, purchase persistence, editing and manual input', async ({ page, context }) => {
  await denyCamera(page); await ready(page);
  const requests = [];
  context.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  const before = await snapshot(page);
  await page.locator('#model').fill('Scanner test phone'); await page.locator('#price').fill('1000');
  await page.locator('#imei').last().fill('123');
  await open(page);
  await recognize(page, await textImage(page, ['*#06#', 'IMEI1:', first, 'IMEI2:', second]));
  await expect(page.getByRole('dialog').getByRole('button', { name: /^Выбрать IMEI/ })).toHaveCount(2);
  await expect(page.locator('#imei').last()).toHaveValue('123');
  expect((await snapshot(page)).state).toEqual(before.state);
  await choose(page, first);
  await expect(page.getByRole('button', { name: 'Сканировать IMEI', exact: true }).last()).toBeFocused();
  await page.getByRole('button', { name: 'Купить телефон', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).state[0].phones[0]?.imei).toBe(first);
  await page.reload();
  await page.locator('main').getByText('Scanner test phone').filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await expect(page.locator('#imei').last()).toHaveValue(first);
  await open(page); await recognize(page, await textImage(page, ['IMEI', second])); await choose(page, second);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).last().click();
  await expect.poll(async () => (await snapshot(page)).state[0].phones[0]?.imei).toBe(second);
  expect((await snapshot(page)).state[0].phones[0].purchasePrice).toBe(1000);
  expect((await snapshot(page)).state[0].accounts).toEqual(before.state[0].accounts);
  expect(requests.filter(r => /^https?:/.test(r.url) && (!r.url.startsWith('http://127.0.0.1:4173/') || r.method !== 'GET'))).toEqual([]);
});

test('real OCR rejects incomplete, bad checksum, longer EID and ambiguous text; closing preserves manual entry', async ({ page }) => {
  await denyCamera(page); await ready(page); await page.locator('#imei').last().fill(first); await open(page);
  await recognize(page, await textImage(page, ['IMEI: 490154203237519', 'IMEI: 49015420323751', 'EID: 89049032000000000000000000000000', 'IMEI: 4901542XX237518']));
  await expect(page.getByRole('dialog').getByRole('button', { name: /^Выбрать IMEI/ })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('IMEI не найден');
  await page.getByRole('button', { name: 'Закрыть сканер' }).click();
  await expect(page.locator('#imei').last()).toHaveValue(first);
  await page.locator('#imei').last().fill(second); await expect(page.locator('#imei').last()).toHaveValue(second);
});

for (const type of ['code128', 'qrcode', 'ocr']) test(`real ${type} works locally and offline after resource caching`, async ({ page, context }) => {
  await denyCamera(page); await ready(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await page.locator('main').getByRole('button', { name: 'Скупка', exact: true }).click();
  await open(page);
  const fixture = type === 'ocr' ? await textImage(page, ['IMEI', first]) : {
    name: 'barcode.png', mimeType: 'image/png',
    buffer: await bwipjs.toBuffer({ bcid: type, text: first, scale: 3, height: 20, padding: 20, backgroundcolor: 'FFFFFF' }),
  };
  await recognize(page, fixture);
  await choose(page, first);
  await context.setOffline(false);
});

for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError']) test(`camera ${name}: recovery via gallery and manual entry`, async ({ page }) => {
  await denyCamera(page, name); await ready(page); await open(page);
  await expect(page.getByRole('alert')).toContainText({ NotAllowedError: 'запрещён', NotFoundError: 'не найдена', NotReadableError: 'занята' }[name]);
  await expect(page.getByLabel('Изображение с IMEI', { exact: true })).toBeEnabled();
  const bounds = await page.getByRole('dialog').boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#imei').last().fill(first);
});

test('camera cleanup covers active streams, late permission grants, retries and backgrounding', async ({ page }) => {
  await page.addInitScript(() => {
    window.cameraStops = 0; window.cameraGrants = [];
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: () => new Promise(resolve => window.cameraGrants.push(() => resolve({ getTracks: () => [{ stop: () => window.cameraStops++ }] }))) } });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, set(value) { this._testStream = value; }, get() { return this._testStream; } });
    HTMLMediaElement.prototype.play = async () => {};
  });
  await ready(page); await open(page);
  await expect.poll(() => page.evaluate(() => window.cameraGrants.length)).toBe(1);
  await page.getByRole('button', { name: 'Закрыть сканер' }).click();
  await page.evaluate(() => window.cameraGrants.shift()());
  await expect.poll(() => page.evaluate(() => window.cameraStops)).toBe(1);
  await open(page); await page.evaluate(() => window.cameraGrants.shift()());
  await expect(page.getByLabel('Предпросмотр камеры', { exact: true })).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => page.evaluate(() => window.cameraStops)).toBe(2);
  await page.getByRole('button', { name: 'Камера', exact: true }).click();
  await page.evaluate(() => window.cameraGrants.shift()());
  await expect(page.getByLabel('Предпросмотр камеры', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть сканер' }).click();
  await expect.poll(() => page.evaluate(() => window.cameraStops)).toBe(3);
});

test('captured camera frame uses real OCR, releases camera and respects duplicate validation', async ({ page }) => {
  await page.addInitScript(() => {
    window.cameraStops = 0;
    Object.defineProperty(navigator, 'mediaDevices', { value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: () => window.cameraStops++ }] }),
    } });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, set(value) { this._testStream = value; } });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { get: () => 1200 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { get: () => 650 });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { get: () => 4 });
    HTMLMediaElement.prototype.play = async () => {};
    window.cameraFrames = 0;
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
      if (!(source instanceof HTMLVideoElement)) return draw.call(this, source, ...args);
      window.cameraFrames++;
      this.fillStyle = '#fff'; this.fillRect(0, 0, 1200, 650);
      this.fillStyle = '#111'; this.font = '48px monospace';
      this.fillText('IMEI 490154203237518', 100, 340);
    };
  });
  await ready(page);
  await page.locator('#model').fill('Original phone'); await page.locator('#price').fill('1000'); await page.locator('#imei').last().fill(first);
  await page.getByRole('button', { name: 'Купить телефон', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).state[0].phones.length).toBe(1);
  await page.locator('main').getByRole('button', { name: 'Скупка', exact: true }).click();
  await page.locator('#model').fill('Duplicate phone'); await page.locator('#price').fill('1000');
  await open(page);
  await expect(page.locator('#imei').last()).toHaveValue(first, { timeout: 60000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.cameraStops)).toBe(1);
  expect(await page.evaluate(() => window.cameraFrames)).toBeGreaterThanOrEqual(4);
  await choose(page, first);
  await page.getByRole('button', { name: 'Купить телефон', exact: true }).click();
  await expect(page.getByText(/Телефон с IMEI .* уже есть на складе/).first()).toBeVisible();
  expect((await snapshot(page)).state[0].phones).toHaveLength(1);
});

test('two side-by-side box barcodes are distinct candidates, including vertical orientation', async ({ page }) => {
  await denyCamera(page); await ready(page);
  const barcodes = await Promise.all([first, second].map(async text => (await bwipjs.toBuffer({
    bcid: 'code128', text, scale: 2, height: 20, padding: 20, backgroundcolor: 'FFFFFF',
  })).toString('base64')));
  const encoded = await page.evaluate(async barcodes => {
    const images = await Promise.all(barcodes.map(async data => { const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode(); return image; }));
    const canvas = document.createElement('canvas'); canvas.width = images.reduce((sum, image) => sum + image.width, 0); canvas.height = Math.max(...images.map(image => image.height));
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    let x = 0; for (const image of images) { context.drawImage(image, x, 0); x += image.width; }
    // Start with vertical bars; the decoder also checks a rotated luminance plane.
    const rotated = document.createElement('canvas'); rotated.width = canvas.height; rotated.height = canvas.width;
    const target = rotated.getContext('2d'); target.translate(rotated.width, 0); target.rotate(Math.PI / 2); target.drawImage(canvas, 0, 0);
    return rotated.toDataURL().split(',')[1];
  }, barcodes);
  await open(page); await recognize(page, { name: 'dual-sim-box.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
  await expect(page.getByRole('dialog').getByRole('button', { name: /^Выбрать IMEI/ })).toHaveCount(2);
  await page.getByRole('button', { name: 'Повернуть', exact: true }).click();
  await expect.poll(async () => page.locator('.imei-scanner-body[aria-busy="true"]').count(), { timeout: 60000 }).toBe(0);
  await expect(page.getByRole('dialog').getByRole('button', { name: /^Выбрать IMEI/ })).toHaveCount(2);
  await choose(page, second);
});

test.describe('scanner loading failures', () => {
  test.use({ serviceWorkers: 'block' });
  test('unsupported camera, malformed gallery file and OCR loading failure are recoverable', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { value: undefined }); });
  await ready(page); await open(page); await expect(page.getByRole('alert')).toContainText('Камера недоступна');
  await recognize(page, { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
  await expect(page.getByRole('alert')).toContainText('Не удалось открыть фото');
  await page.getByRole('button', { name: 'Закрыть сканер' }).click();
  await page.route('**/scanner-assets/**/worker.min.js', route => route.abort());
  await open(page); await recognize(page, await textImage(page, ['IMEI', first]));
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить распознавание текста');
});

});

for (const [name, seed, font, size, contrast, angle] of [
  ['small box label', '86279804123456', 'Arial', 22, 85, -3],
  ['grey label and JPEG compression', '35391805234165', 'Arial', 26, 145, 2],
  ['serif label', '35824005123456', 'Georgia', 28, 65, -2],
  ['phone screen in dark mode', '35175609123456', 'Arial', 32, 240, 0],
]) test(`actual OCR reads ${name} with a different valid IMEI`, async ({ page }) => {
  await denyCamera(page); await ready(page);
  const { isValidImei } = await import('../../src/utils/imei.js');
  const imei = [...Array(10).keys()].map(digit => seed + digit).find(isValidImei);
  const encoded = await page.evaluate(({ imei, font, size, contrast, angle, name }) => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1100;
    const ctx = canvas.getContext('2d');
    const dark = name.includes('dark');
    ctx.fillStyle = dark ? '#17191e' : '#e5e0d7'; ctx.fillRect(0, 0, 1600, 1100);
    ctx.fillStyle = dark ? '#f3f3f5' : '#444'; ctx.font = '38px Arial'; ctx.fillText(dark ? '*#06#' : 'Smartphone / 128 GB', 450, 260);
    ctx.save(); ctx.translate(440, 540); ctx.rotate(angle * Math.PI / 180);
    ctx.fillStyle = `rgb(${contrast},${contrast},${contrast})`; ctx.font = `${size}px ${font}`;
    ctx.fillText('IMEI: ' + imei, 0, 0);
    ctx.font = '19px Arial'; ctx.fillText('S/N: XAJ6749TEST', 0, 55);
    ctx.fillText('EID: 89049032000000000000000000000000', 0, 95);
    ctx.restore();
    return canvas.toDataURL('image/jpeg', .68).split(',')[1];
  }, { imei, font, size, contrast, angle, name });
  await open(page);
  await recognize(page, { name: 'box-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(encoded, 'base64') });
  await expect(page.locator('#imei').last()).toHaveValue(imei, { timeout: 60000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
