import { test, expect } from '@playwright/test';
import { snapshot } from './helpers.js';
import { createInitialState } from '../../src/storage/initialState.js';
import { createAccessoryBatch, createAccessorySale } from '../../src/domain/accessories.js';
import { today } from '../../src/utils/format.js';

const longName = 'Чехол MagSafe для iPhone 14 Pro с усиленной защитой камеры и противоударными бортиками';
const longCompatibility = 'iPhone 13 / iPhone 14 Pro / iPhone 15 Pro Max';
function fixture() {
  let data = createInitialState();
  data.accounts[0].openingBalance = 100000;
  const accountId = data.accounts[0].id;
  for (const [name, category, compatibility, qty, unitCost, salePrice, minStock] of [
    [longName, 'case', 'iPhone 14 Pro', 5, 200, 1200, 3],
    ['Кабель USB-C', 'cable', longCompatibility, 12, 300, 900, 2],
    ['Сетевое зарядное устройство', 'charger', 'USB-C', 2, 800, 2400, 3],
  ]) data = createAccessoryBatch(data, {
    newItem: { name, category, compatibility, color: 'Чёрный', salePrice, minStock },
    qty, unitCost, accountId, date: today(), paymentMethod: 'cash',
  });
  data = createAccessorySale(data, {
    items: [{ itemId: data.accessoryItems.find(item => item.name === longName).id, qty: 4, unitPrice: 1200 }],
    accountId, date: today(), paymentMethod: 'cash', discount: 0,
  });
  return data;
}
async function settleEntrance(page) {
  await page.locator('.accessories-page').evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
}
async function seed(page, data = fixture()) {
  await page.goto('./#/settings');
  await expect(page.getByRole('button', { name: 'Скачать полную копию', exact: true })).toBeEnabled();
  await page.evaluate(async data => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('phonebooks', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = reject;
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(data, 'current'); tx.oncomplete = resolve; tx.onabort = reject;
    });
    db.close(); localStorage.setItem('phonebooks.theme', 'light');
  }, data);
  await page.goto('./#/accessories');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Товары на складе' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(data.accessoryItems.length);
  await settleEntrance(page);
}
async function choose(page, title, label) {
  if (title !== 'Сортировка') {
    await page.getByRole('combobox', { name: title, exact: true }).selectOption({ label });
    return;
  }
  const trigger = page.getByRole('button', { name: new RegExp(`^${title}:`) });
  await trigger.click();
  const modal = page.getByRole('dialog', { name: title, exact: true });
  await modal.getByRole('button', { name: label, exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(trigger).toBeFocused();
}
async function noOverflow(page) {
  expect(await page.locator('.accessories-page').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const outside = await page.locator('.accessories-page').evaluate(root =>
    [...root.querySelectorAll('button, input, article, h3')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width && (r.left < -1 || r.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1);
    }).map(el => el.textContent || el.getAttribute('aria-label')),
  );
  expect(outside).toEqual([]);
}

test('compact statistics toggle repeatedly without writes or stale heights', async ({ page }) => {
  await seed(page);
  const before = await snapshot(page);
  const summary = page.getByRole('region', { name: 'Краткая статистика аксессуаров' });
  await expect(summary).toContainText('5 400 ₽');
  await expect(summary).toContainText('4 800 ₽');
  const toggle = page.getByRole('button', { name: 'Подробная статистика', exact: true });
  const initiallyOpen = page.viewportSize().width >= 1024;
  await expect(toggle).toHaveAttribute('aria-expanded', String(initiallyOpen));
  if (initiallyOpen) await toggle.click();
  const region = page.getByRole('region', { name: 'Подробная статистика', includeHidden: true });
  await expect(region).toBeHidden();
  const originalTop = (await page.getByRole('article').first().boundingBox()).y;
  for (let count = 0; count < 2; count++) {
    await toggle.click(); await expect(region).toBeVisible();
    await expect(region).toContainText('4 000 ₽'); await expect(region).toContainText('4 шт.');
    await expect(region.getByRole('heading', { name: 'Заканчиваются · 2' })).toBeVisible();
    // Rapid repeated taps must settle without a stale height or overlay.
    await toggle.click(); await toggle.click(); await toggle.click();
    await expect(region).toBeHidden();
    await expect.poll(async () => Math.abs((await page.getByRole('article').first().boundingBox()).y - originalTop)).toBeLessThan(2);
  }
  expect(await snapshot(page)).toEqual(before);
});

test('search, filters, every sort option and long values never write to storage', async ({ page }) => {
  test.slow(); // Several real iOS sheets, including opening the on-screen keyboard.
  await seed(page);
  const before = await snapshot(page);
  const search = page.getByRole('searchbox', { name: 'Поиск по названию' });
  await search.fill('КАБЕЛЬ'); await expect(page.getByRole('article')).toHaveCount(1);
  await search.fill('USB-C'); await expect(page.getByRole('article')).toHaveCount(2);
  await page.getByRole('button', { name: 'Очистить поиск' }).click();
  await choose(page, 'Категория', 'Зарядные устройства');
  await expect(page.getByRole('article')).toHaveCount(1);
  await choose(page, 'Категория', 'Все категории');
  await choose(page, 'Совместимость', longCompatibility);
  await expect(page.getByRole('article')).toHaveCount(1); await noOverflow(page);
  await choose(page, 'Совместимость', 'Совместимость');
  for (const [sort, first] of [
    ['По названию', 'Кабель USB-C'], ['По остатку', 'Кабель USB-C'],
    ['По цене', 'Сетевое зарядное устройство'], ['Заканчивающиеся сначала', longName],
  ]) {
    await choose(page, 'Сортировка', sort);
    await expect(page.getByRole('article').first()).toHaveAttribute('aria-label', first);
  }
  await search.fill('несуществующий товар'); await expect(page.getByText('Ничего не найдено', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Очистить поиск' }).click();
  expect(await snapshot(page)).toEqual(before);
});

test('iPhone 13, iPhone 14 Pro, small screens, tablet, desktop, safe area and scaling', async ({ page }, testInfo) => {
  test.slow(); // Five full reloads and retina screenshots, plus the enlarged-text check.
  await seed(page);
  for (const [name, width, height] of [
    ['iphone-13', 390, 844], ['iphone-14-pro', 393, 852],
    ['small', 320, 568], ['tablet', 768, 1024], ['desktop', 1440, 1000],
  ]) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await settleEntrance(page);
    const toggle = page.getByRole('button', { name: 'Подробная статистика', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', String(width >= 1024));
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '34px'));
    await noOverflow(page);
    const cards = await page.locator('.accessories-stat').evaluateAll(nodes => nodes.map(el => {
      const r = el.getBoundingClientRect(); return { top: r.top, height: r.height };
    }));
    expect(cards[0]).toEqual(cards[1]);
    const actions = page.getByRole('group', { name: 'Управление товарами', exact: true });
    const boxes = await actions.getByRole('button').evaluateAll(nodes => nodes.map(el => {
      const r = el.getBoundingClientRect(); return { top: r.top, height: r.height };
    }));
    expect(boxes[0]).toEqual(boxes[1]); expect(boxes[0].height).toBeGreaterThanOrEqual(43.9);
    const first = await page.getByRole('article').first().boundingBox();
    if (width < 640) expect(first.y).toBeLessThan(430);
    expect(await page.locator('.accessories-product-actions button').evaluateAll(nodes => nodes.every(el => el.getBoundingClientRect().height >= 43.9))).toBe(true);
    // Focused search retains 16 px text, avoiding automatic input zoom on iOS.
    expect(await page.getByRole('searchbox').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
    await page.getByRole('article').last().getByRole('button', { name: 'Изменить', exact: true }).scrollIntoViewIfNeeded();
    const last = await page.getByRole('article').last().getByRole('button', { name: 'Изменить', exact: true }).boundingBox();
    if (width < 1024) {
      const nav = await page.getByRole('navigation', { name: 'Основная навигация' }).boundingBox();
      expect(last.y + last.height).toBeLessThanOrEqual(nav.y);
    }
  }
  // Emulate the CSS viewport of a desktop at 200% zoom, with enlarged text as well.
  await page.setViewportSize({ width: 720, height: 500 });
  await page.addStyleTag({ content: '.accessories-page :is(button, h3, .accessories-caption, .accessories-note) { font-size: 20px; }' });
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('zoom-200.png'), fullPage: true });
});

test('existing item actions persist through reload; other routes remain available', async ({ page }) => {
  await seed(page);
  const before = await snapshot(page);
  const actions = page.getByRole('group', { name: 'Управление товарами', exact: true });
  await actions.getByRole('button', { name: 'Добавить товар', exact: true }).click();
  await page.getByPlaceholder('Например: Чехол iPhone 15').fill('Новый тестовый чехол');
  await page.getByRole('dialog').getByPlaceholder('0', { exact: true }).first().fill('500');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const added = page.getByRole('article', { name: 'Новый тестовый чехол', exact: true });
  await expect(added).toBeVisible();
  await added.getByRole('button', { name: 'Изменить', exact: true }).click();
  await page.getByPlaceholder('Например: Чехол iPhone 15').fill('Тестовый чехол');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const item = page.getByRole('article', { name: 'Тестовый чехол', exact: true });
  await item.getByRole('button', { name: 'Поступление', exact: true }).click();
  const purchase = page.getByRole('dialog', { name: 'Поступление аксессуаров', exact: true });
  await expect(purchase.locator('select').first()).toContainText('Тестовый чехол');
  const fields = purchase.getByPlaceholder('0', { exact: true });
  await fields.nth(0).fill('3'); await fields.nth(1).fill('100');
  await purchase.getByRole('button', { name: 'Купить · 300 ₽', exact: true }).click();
  await expect(item.locator('.accessories-stock')).toContainText('3 шт.');
  await item.getByRole('button', { name: 'Количество', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '1', exact: true }).first().click();
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(item.locator('.accessories-stock')).toContainText('2 шт.');
  await item.getByRole('button', { name: 'История', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Списание');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).state[0].accessoryItems.length).toBe(4);
  await expect.poll(async () => (await snapshot(page)).state[0].accessoryBatches.length)
    .toBe(before.state[0].accessoryBatches.length + 2);
  const after = await snapshot(page);
  expect(after.state[0].accessorySales).toEqual(before.state[0].accessorySales);
  expect(after.state[0].phones).toEqual(before.state[0].phones);
  expect(after.state[0].sales).toEqual(before.state[0].sales);
  await page.reload(); await expect(item.locator('.accessories-stock')).toContainText('2 шт.');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const route of ['dashboard', 'purchase', 'sales', 'finance', 'history', 'settings', 'accessories']) {
    await page.goto('./#/' + route); await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('main')).not.toBeEmpty();
  }
  expect(errors).toEqual([]);
});

test('empty inventory and empty statistics remain usable', async ({ page }) => {
  await seed(page, createInitialState());
  await expect(page.getByText('Аксессуаров пока нет', { exact: true })).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Подробная статистика', exact: true });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await expect(page.getByText('Все товары в достатке', { exact: true })).toBeVisible();
  await expect(page.getByText('За этот период продаж пока нет', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Совместимость', exact: true })).toBeDisabled();
});
