import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { buildExportFile } from '../../src/storage/backupFormat.js';
import { addDays, today, toISODate } from '../../src/utils/format.js';
import { realisticSnapshot } from '../fixtures/realistic.js';

const solo = 'http://localhost:4397/';
test.beforeEach(async ({ page }, info) => {
  if (info.project.name !== 'team-iphone-webkit') await page.setViewportSize({ width: 1280, height: 900 });
});

function productFixture() {
  const fixture = realisticSnapshot();
  const state = fixture.indexedDB.state[0].value;
  const date = new Date(today() + 'T12:00:00');
  const current = offset => toISODate(addDays(date, offset));
  for (const phone of state.phones) {
    phone.purchaseDate = current(-12);
    phone.color = 'Графит';
    phone.storage = '128 ГБ';
  }
  state.phones.find(phone => phone.status === 'in_stock').status = 'repair';
  for (const name of ['sales', 'accessorySales', 'accessoryBatches', 'expenses', 'transfers', 'cashOps']) {
    state[name].forEach((operation, index) => { operation.date = current(-9 + index); });
  }
  state.settings.businessName = 'Учебный магазин';
  return { ...fixture, localStorage: [], indexedDB: { ...fixture.indexedDB, backups: [] } };
}

async function seedSolo(page, fixture) {
  await page.goto(solo);
  await expect(page.locator('h1')).toBeVisible();
  await page.evaluate(state => new Promise((resolve, reject) => {
    localStorage.setItem('phonebooks.theme', 'light');
    const open = indexedDB.open('phonebooks', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction('state', 'readwrite');
      transaction.objectStore('state').put(state, 'current');
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), fixture.indexedDB.state[0].value);
  await page.reload();
}

async function checkLayout(page) {
  await expect(page.locator('h1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
}

async function capture(page, testInfo, title) {
  const dir = process.env.PHONEBOOKS_STAGE7_SCREENSHOTS;
  if (!dir || testInfo.project.name === 'team-firefox') return;
  const suffix = testInfo.project.name === 'team-iphone-webkit' ? 'iphone' : 'desktop';
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, title + '-' + suffix + '.png'), animations: 'disabled', fullPage: suffix === 'desktop' });
}

test('Solo product navigation, device details and finance', async ({ page }, info) => {
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await seedSolo(page, productFixture());
  await expect(page.getByText('Выручка', { exact: true })).toBeVisible();
  await expect(page.getByText('Последние операции', { exact: true })).toBeVisible();
  await checkLayout(page);
  await capture(page, info, 'solo-overview');
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await navigation.getByRole('button', { name: 'Скупка', exact: true }).click();
  await expect(page.getByRole('button', { name: /Samsung S23/ })).toBeVisible();
  await capture(page, info, 'solo-stock');
  await page.getByRole('button', { name: /Samsung S23/ }).click();
  await expect(page.getByRole('heading', { name: 'Samsung S23', exact: true })).toBeVisible();
  await capture(page, info, 'solo-device');
  await page.getByRole('button', { name: 'Операции', exact: true }).click();
  await expect(page.getByText('Продажа · Samsung S23')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить устройство', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сканировать IMEI' })).toBeVisible();
  await checkLayout(page);
  await capture(page, info, 'solo-add');
  await navigation.getByRole('button', { name: 'Финансы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Движение денежных средств' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Выручка и Чистая прибыль за выбранный период' })).toBeVisible();
  await checkLayout(page);
  await capture(page, info, 'solo-finance');
  await navigation.getByRole('button', { name: 'Скупка', exact: true }).click();
  await page.getByRole('button', { name: 'Другие товары', exact: true }).click();
  await page.getByRole('button', { name: 'Новая категория', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Мониторы');
  await page.getByRole('button', { name: 'Добавить характеристику' }).click();
  await page.getByRole('textbox', { name: 'Характеристика 1' }).fill('Диагональ');
  await page.getByRole('combobox', { name: 'Тип', exact: true }).selectOption('number');
  await page.getByRole('button', { name: 'Сохранить категорию' }).click();
  await page.getByRole('button', { name: 'Добавить товар', exact: true }).click();
  await page.getByRole('combobox', { name: 'Категория', exact: true }).selectOption({ label: 'Мониторы' });
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Учебный монитор');
  await page.getByLabel('Диагональ', { exact: true }).fill('27');
  await page.getByRole('button', { name: 'Сохранить товар' }).click();
  await expect(page.getByRole('button', { name: /Учебный монитор/ })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Учебный монитор/ }).click();
  await expect(page.getByLabel('Диагональ', { exact: true })).toHaveValue('27');
  expect(browserErrors).toEqual([]);
});

test('Team product navigation, repair, transaction history and period cash flow', async ({ page }, info) => {
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  const address = crypto.randomUUID() + '@phonebooks.test';
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  await capture(page, info, 'team-account');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await page.getByLabel('Электронная почта').fill(address);
  await page.getByLabel('Пароль', { exact: true }).fill('Product-stage7-test!');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('подтвердите адрес');
  const mail = await page.request.get('/__test/mail?email=' + encodeURIComponent(address) + '&kind=email');
  const { token } = await mail.json();
  await page.goto('/?view=confirm#' + token);
  await page.getByRole('button', { name: 'Подтвердить адрес' }).click();
  await page.getByLabel('Название нового пространства').fill('Учебный магазин');
  await page.getByRole('button', { name: 'Создать пространство' }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
  await page.getByRole('button', { name: 'Аккаунт', exact: true }).click();
  await expect(page.getByText('Подключено', { exact: true })).toBeVisible();
  await page.getByText('Перенос из Solo', { exact: true }).click();
  const backup = Buffer.from(JSON.stringify(buildExportFile(productFixture())));
  await page.getByLabel('Резервная копия Solo').setInputFiles({ name: 'training.json', mimeType: 'application/json', buffer: backup });
  await page.getByRole('button', { name: 'Подтвердить перенос' }).click();
  await expect(page.getByText('Сервер подтвердил перенос и сверку данных.')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  await nav.getByRole('button', { name: 'Обзор', exact: true }).click();
  await expect(page.getByText('Выручка', { exact: true })).toBeVisible();
  await checkLayout(page);
  await capture(page, info, 'team-overview');
  await nav.getByRole('button', { name: 'Скупка', exact: true }).click();
  await expect(page.getByRole('button', { name: /Samsung S23/ })).toBeVisible();
  await capture(page, info, 'team-stock');
  await page.getByRole('button', { name: 'Добавить товар', exact: true }).click();
  await expect(page.getByText('IMEI', { exact: true })).toBeVisible();
  await checkLayout(page);
  await capture(page, info, 'team-add');
  await page.getByRole('button', { name: 'Вернуться' }).click();
  await page.getByRole('button', { name: /Samsung S23/ }).click();
  await expect(page.getByRole('heading', { name: 'Samsung S23' })).toBeVisible();
  await capture(page, info, 'team-device');
  await page.getByRole('button', { name: 'Операции', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Операции с товаром' })).toBeVisible();
  await expect(page.getByText(/Продажа ·/)).toBeVisible();
  await page.getByRole('button', { name: 'К товарам' }).click();
  await page.getByRole('button', { name: /Кабель/ }).click();
  await expect(page.getByRole('button', { name: 'Передать в ремонт' })).toHaveCount(0);
  await page.getByRole('button', { name: 'К товарам' }).click();
  const stockPhone = page.getByRole('button', { name: /iPhone (13|14).*На складе/ });
  await stockPhone.click();
  await page.getByRole('button', { name: 'Передать в ремонт' }).click();
  await page.getByRole('button', { name: 'Провести операцию' }).click();
  await expect(page.getByText('Операция подтверждена сервером.')).toBeVisible();
  const repairedItem = page.getByRole('region', { name: 'Устройства в ремонте' }).getByRole('button', { name: /iPhone/ }).first();
  await expect(repairedItem).toBeVisible();
  await nav.getByRole('button', { name: 'Финансы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Движение денежных средств' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Касса и счета' })).toBeVisible();
  await checkLayout(page);
  await capture(page, info, 'team-finance');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Касса и счета' })).toBeVisible();
  await page.getByRole('button', { name: 'Рабочие пространства', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Приглашения сотрудников' })).toBeVisible();
  await capture(page, info, 'team-management');
  expect(browserErrors).toEqual([]);
});
