import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import bwipjs from 'bwip-js';

async function shot(page, info, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const directory = process.env.PHONEBOOKS_WAREHOUSE_SHOTS;
  if (!directory || info.project.name === 'team-firefox') return;
  await mkdir(directory, { recursive: true });
  const suffix = info.project.name === 'team-iphone-webkit' ? 'iphone' : 'desktop';
  await page.screenshot({ path: resolve(directory, name + '-' + suffix + '.png'), animations: 'disabled' });
}
async function alignedPreview(page) {
  const sizes = await page.locator('.pb-bulk .pb-actions > button').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().toJSON()));
  expect(sizes).toHaveLength(2);
  expect(Math.abs(sizes[0].width - sizes[1].width)).toBeLessThan(1);
  expect(Math.abs(sizes[0].height - sizes[1].height)).toBeLessThan(1);
  if (page.viewportSize().width <= 420) expect(sizes[0].x).toBe(sizes[1].x);
  else expect(sizes[0].y).toBe(sizes[1].y);
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
const heading = (page, name) => page.getByRole('heading', { name, exact: true });
const field = (page, name) => page.getByRole('textbox', { name, exact: true });
async function go(page, path) {
  await page.evaluate(path => { location.hash = '/' + path; }, path);
  await expect(page).toHaveURL(new RegExp('#/' + path + '$'));
}
test.beforeEach(async ({ page }, info) => {
  if (info.project.name !== 'team-iphone-webkit') await page.setViewportSize({ width: 1280, height: 900 });
});

test('Solo universal stock purchases, repairs, sales, offline reload and bulk undo', async ({ page, context }, info) => {
  await page.goto('http://localhost:4397/#/catalog');
  await expect(heading(page, 'Каталог товаров')).toBeVisible();
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('phonebooks', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('state', 'readwrite');
      const store = tx.objectStore('state');
      const entry = store.get('current');
      entry.onsuccess = () => {
        const state = entry.result;
        state.accounts[0].openingBalance = 10000;
        store.put(state, 'current');
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await button(page, 'Добавить товар').click();
  await field(page, 'Название').fill('Учебный ноутбук');
  await field(page, 'Серийный номер').fill('S8-0001');
  await field(page, 'Плановая цена продажи, ₽').fill('900');
  await shot(page, info, 'solo-device-form');
  await button(page, 'Сохранить товар').click();
  await page.getByRole('button', { name: /Учебный ноутбук/ }).click();
  await button(page, 'Оформить закупку').click();
  await field(page, 'Цена за единицу, ₽').fill('500');
  await button(page, 'Провести операцию').click();
  await expect(button(page, 'Передать в ремонт')).toBeVisible();
  await button(page, 'Передать в ремонт').click();
  await button(page, 'Провести операцию').click();
  await button(page, 'Завершить ремонт').click();
  await field(page, 'Стоимость ремонта, ₽').fill('100');
  await button(page, 'Провести операцию').click();
  await button(page, 'Оформить продажу').click();
  await expect(field(page, 'Цена за единицу, ₽')).toHaveValue('900');
  await button(page, 'Провести операцию').click();
  await expect(page.getByText('Продажа товара', { exact: true })).toBeVisible();
  await shot(page, info, 'solo-card');
  await button(page, 'К каталогу').click();
  await button(page, 'Массовое редактирование').click();
  await page.getByRole('checkbox', { name: 'Учебный ноутбук' }).check();
  await field(page, 'Новая плановая цена, ₽').fill('950');
  await button(page, 'Предпросмотр изменений').click();
  await alignedPreview(page);
  await shot(page, info, 'solo-bulk-preview');
  await button(page, 'Применить изменения').click();
  await button(page, 'Отменить изменения').click();
  await expect(button(page, 'Отменить изменения')).toHaveCount(0);
  await button(page, 'Глобальный поиск').click();
  await page.getByRole('searchbox').fill('S8-0001');
  await button(page, 'Найти').click();
  await expect(page.getByText('Продажа товара · Учебный ноутбук', { exact: true })).toBeVisible();
  await shot(page, info, 'solo-search');
  await go(page, 'sales');
  await expect(page.getByText(/Прибыль.*300/)).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/Прибыль.*300/)).toBeVisible();
});

test('Team custom category, dynamic stock, global history, rename and IMEI scan', async ({ page }, info) => {
  const address = crypto.randomUUID() + '@phonebooks.test';
  await page.goto('/');
  await button(page, 'Создать аккаунт').click();
  await field(page, 'Электронная почта').fill(address);
  await page.getByLabel('Пароль', { exact: true }).fill('Warehouse-test-123!');
  await button(page, 'Создать аккаунт').click();
  await expect(page.getByRole('status')).toContainText('подтвердите адрес');
  const mail = await page.request.get('/__test/mail?' + new URLSearchParams({ email: address, kind: 'email' }));
  await page.goto('/?view=confirm#' + (await mail.json()).token);
  await button(page, 'Подтвердить адрес').click();
  await field(page, 'Название нового пространства').fill('Учебное предприятие');
  await button(page, 'Создать пространство').click();
  await expect(page).toHaveURL(/#\/dashboard$/);
  await button(page, 'Рабочие пространства').click();
  await field(page, 'Название предприятия').fill('Учебный склад');
  await button(page, 'Сохранить название').click();
  await expect(heading(page, 'Учебный склад')).toBeVisible();
  await go(page, 'finance');
  await button(page, 'Пополнить счёт').click();
  await field(page, 'Сумма, ₽').fill('10000');
  await button(page, 'Провести операцию').click();
  await expect(page.getByText('Операция подтверждена сервером.')).toBeVisible();

  await go(page, 'purchase');
  await button(page, 'Категории товаров').click();
  await field(page, 'Название').fill('Учебные модули');
  await button(page, 'Добавить характеристику').click();
  await field(page, 'Характеристика 1').fill('Объём');
  await page.getByRole('combobox', { name: 'Тип', exact: true }).selectOption('number');
  await shot(page, info, 'team-category');
  await button(page, 'Сохранить категорию').click();

  await button(page, 'Добавить товар').click();
  await page.getByRole('combobox', { name: 'Категория', exact: true }).selectOption({ label: 'Учебные модули' });
  await field(page, 'Название товара').fill('Модуль S8');
  await page.getByRole('combobox', { name: 'Учёт', exact: true }).selectOption('quantity');
  await page.getByRole('spinbutton', { name: 'Объём', exact: true }).fill('16');
  await page.getByRole('spinbutton', { name: 'Количество', exact: true }).fill('4');
  await field(page, 'Цена за единицу, ₽').fill('50');
  await field(page, 'Плановая цена продажи, ₽').fill('90');
  await button(page, 'Провести операцию').click();
  await page.getByRole('button', { name: /Модуль S8.*Остаток 4/ }).click();
  await expect(heading(page, 'Модуль S8')).toBeVisible();
  await shot(page, info, 'team-card');
  await button(page, 'К товарам').click();
  await button(page, 'Массовое редактирование').click();
  await page.getByRole('checkbox', { name: 'Модуль S8' }).check();
  await field(page, 'Новая плановая цена, ₽').fill('95');
  await button(page, 'Предпросмотр изменений').click();
  await alignedPreview(page);
  await shot(page, info, 'team-bulk-preview');
  await button(page, 'Применить изменения').click();
  await button(page, 'Отменить изменения').click();
  await expect(button(page, 'Отменить изменения')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Модуль S8' }).check();
  await page.getByRole('combobox', { name: 'Изменяемое поле', exact: true }).selectOption({ label: 'Объём' });
  await page.getByRole('spinbutton', { name: 'Новое значение', exact: true }).fill('32');
  await button(page, 'Предпросмотр изменений').click();
  await button(page, 'Применить изменения').click();
  await button(page, 'Отменить изменения').click();
  await expect(button(page, 'Отменить изменения')).toHaveCount(0);
  await button(page, 'К складу').click();
  await button(page, 'Глобальный поиск').click();
  await page.getByRole('searchbox', { name: 'Поиск по складу и истории' }).fill('Модуль S8');
  await button(page, 'Найти').click();
  await expect(heading(page, 'История операций')).toBeVisible();
  await expect(page.getByRole('region', { name: 'История операций' }).getByText('Модуль S8')).toBeVisible();
  await shot(page, info, 'team-search');

  await go(page, 'purchase');
  await page.getByRole('button', { name: /Модуль S8.*Остаток 4/ }).click();
  await button(page, 'Продать').click();
  await expect(field(page, 'Цена за единицу, ₽')).toHaveValue('90');
  await page.getByRole('spinbutton', { name: 'Количество', exact: true }).fill('2');
  await shot(page, info, 'team-sale');
  await button(page, 'Провести операцию').click();
  await expect(heading(page, 'Операции продаж')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Операции продаж' }).getByText('Модуль S8')).toBeVisible();

  await go(page, 'purchase');
  await button(page, 'Добавить товар').click();
  await page.getByRole('combobox', { name: 'Категория', exact: true }).selectOption('smartphones');
  await button(page, 'Сканировать IMEI').click();
  const scanner = page.getByRole('dialog', { name: 'Сканировать IMEI' });
  await expect(scanner).toBeVisible();
  const imei = '490154203237518';
  const buffer = await bwipjs.toBuffer({ bcid: 'code128', text: imei, scale: 3, height: 24, padding: 10 });
  await scanner.getByLabel('Изображение с IMEI').setInputFiles({ name: 'imei.png', mimeType: 'image/png', buffer });
  await expect(field(page, 'IMEI')).toHaveValue(imei, { timeout: 20000 });
  await expect(scanner).toBeHidden();
  await shot(page, info, 'team-imei');
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
