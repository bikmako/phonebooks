import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { realisticSnapshot } from '../fixtures/realistic.js';

const button = (page, name) => page.getByRole('button', { name, exact: true });
const field = (page, name) => page.getByLabel(name, { exact: true });
const heading = (page, name) => page.getByRole('heading', { name, exact: true });

async function shot(page, project, name) {
  const sizes = await page.locator('.pb-trade-form .pb-warehouse-actions > button').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().toJSON()));
  expect(sizes).toHaveLength(2);
  expect(Math.abs(sizes[0].width - sizes[1].width)).toBeLessThan(1);
  expect(Math.abs(sizes[0].height - sizes[1].height)).toBeLessThan(1);
  expect(sizes[0].y).toBe(sizes[1].y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const directory = process.env.PHONEBOOKS_TRADE_SHOTS;
  if (!directory || project === 'team-firefox') return;
  await mkdir(directory, { recursive: true });
  const suffix = project === 'team-iphone-webkit' ? 'iphone' : 'desktop';
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: resolve(directory, name + '-' + suffix + '.png'), animations: 'disabled' });
}

async function reserve(page, project, mode) {
  await field(page, 'Имя покупателя').fill('Анна Соколова');
  await field(page, 'Контакт').fill('+7 000 000-00-00');
  await field(page, 'Количество').fill('2');
  await field(page, 'Цена за единицу, ₽').fill('900');
  await field(page, 'Срок бронирования').fill('2031-11-28T18:00');
  await field(page, 'Комментарий').fill('Самовывоз после 17:00');
  await shot(page, project, mode + '-reservation');
  await button(page, 'Забронировать').click();
  await expect(page.getByText('Анна Соколова', { exact: true })).toBeVisible();
  await button(page, 'Продать из резерва').click();
  await field(page, 'Количество').fill('1');
  await button(page, 'Продать из резерва').click();
  await expect(heading(page, 'Активные бронирования')).toBeVisible();
}

async function customerReturn(page, project, mode) {
  await button(page, 'Возврат покупателя').click();
  await field(page, 'Сумма возврата, ₽').fill('900');
  await field(page, 'Причина').fill('Покупатель вернул товар');
  await shot(page, project, mode + '-return');
  await button(page, 'Возврат покупателя').click();
  await expect(heading(page, 'Активные бронирования')).toBeVisible();
}

test.beforeEach(async ({ page }, info) => {
  if (info.project.name !== 'team-iphone-webkit') await page.setViewportSize({ width: 1280, height: 900 });
});

test('legacy Solo phone and accessory forms open trade, return a phone and protect reserved units', async ({ page }) => {
  await page.goto('http://localhost:4397/#/settings');
  await expect(button(page, 'Скачать полную копию')).toBeEnabled();
  const state = realisticSnapshot().indexedDB.state[0].value;
  const sale = state.sales.find(item => item.status === 'completed');
  const phone = state.phones.find(item => item.id === sale.phoneId);
  await page.evaluate(data => new Promise((resolve, reject) => {
    const request = indexedDB.open('phonebooks', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(data, 'current');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), state);
  await page.goto('http://localhost:4397/#/purchase');
  await page.reload();
  await page.getByRole('button', { name: new RegExp(phone.model) }).click();
  await button(page, 'Возвраты и бронирования').click();
  const dialog = page.getByRole('dialog', { name: 'Операции с товаром' });
  await button(dialog, 'Возврат покупателя').click();
  await field(dialog, 'Сумма возврата, ₽').fill('1000');
  await field(dialog, 'Причина').fill('Проверка связи с исходным чеком');
  await button(dialog, 'Возврат покупателя').click();
  await expect(heading(dialog, 'Активные бронирования')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.goto('http://localhost:4397/#/accessories');
  const item = page.getByRole('article', { name: state.accessoryItems[0].name });
  await button(item, 'Возвраты и бронирования').click();
  await button(dialog, 'Забронировать').click();
  await field(dialog, 'Имя покупателя').fill('Тестовая бронь');
  await field(dialog, 'Срок бронирования').fill('2031-11-28T18:00');
  await button(dialog, 'Забронировать').click();
  await expect(dialog.getByText('Тестовая бронь', { exact: true })).toBeVisible();
});

test('Solo reserves from stock, sells from a reservation, and persists a refund offline', async ({ page, context }, info) => {
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
  await field(page, 'Название').fill('Товар Solo 9');
  await page.getByRole('combobox', { name: 'Учёт', exact: true }).selectOption('quantity');
  await button(page, 'Сохранить товар').click();
  await page.getByRole('button', { name: /^Товар Solo 9/ }).click();
  await button(page, 'Оформить закупку').click();
  await field(page, 'Количество').fill('3');
  await field(page, 'Цена за единицу, ₽').fill('500');
  await button(page, 'Провести операцию').click();
  await button(page, 'К каталогу').click();
  await button(page, 'Забронировать Товар Solo 9').click();
  await reserve(page, info.project.name, 'solo');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await customerReturn(page, info.project.name, 'solo');
  await page.reload();
  await field(page, 'Статус товара').selectOption('reserved');
  await expect(page.getByRole('button', { name: /Товар Solo 9.*Остаток 3.*резерв 1/ })).toBeVisible();
});

test('Team reserves from stock, sells at the negotiated price, and posts a return', async ({ page }, info) => {
  const address = crypto.randomUUID() + '@phonebooks.test';
  await page.goto('/');
  await button(page, 'Создать аккаунт').click();
  await field(page, 'Электронная почта').fill(address);
  await field(page, 'Пароль').fill('Warehouse-test-123!');
  await button(page, 'Создать аккаунт').click();
  await expect(page.getByRole('status')).toContainText('подтвердите адрес');
  const mail = await page.request.get('/__test/mail?' + new URLSearchParams({ email: address, kind: 'email' }));
  await page.goto('/?view=confirm#' + (await mail.json()).token);
  await button(page, 'Подтвердить адрес').click();
  await field(page, 'Название нового пространства').fill('Тестовый склад');
  await button(page, 'Создать пространство').click();
  await expect(page).toHaveURL(/#\/dashboard$/);
  await page.evaluate(() => { location.hash = '/finance'; });
  await button(page, 'Пополнить счёт').click();
  await field(page, 'Сумма, ₽').fill('10000');
  await button(page, 'Провести операцию').click();
  await expect(page.getByText('Операция подтверждена сервером.')).toBeVisible();
  await page.evaluate(() => { location.hash = '/purchase'; });
  await button(page, 'Добавить товар').click();
  await field(page, 'Название товара').fill('Товар Team 9');
  await page.getByRole('combobox', { name: 'Учёт', exact: true }).selectOption('quantity');
  await field(page, 'Количество').fill('3');
  await field(page, 'Цена за единицу, ₽').fill('500');
  await button(page, 'Провести операцию').click();
  await button(page, 'Забронировать Товар Team 9').click();
  await reserve(page, info.project.name, 'team');
  await customerReturn(page, info.project.name, 'team');
  await button(page, 'К карточке').click();
  await expect(page.getByText('В резерве', { exact: true })).toBeVisible();
  await button(page, 'К товарам').click();
  await field(page, 'Статус товара').selectOption('reserved');
  await expect(page.getByRole('button', { name: /Товар Team 9.*Остаток 3.*резерв 1/ })).toBeVisible();
});
