import { test, expect } from '@playwright/test';
import { snapshot, exportFile, upload, commitAndReload } from './helpers.js';
import { getAccountBalance, getPhoneTotalCost, getSaleProfit, getStats } from '../../src/utils/calculations.js';
const cash = 'ac_default_cash', bank = 'repair_bank';
const model = 'Repair test iPhone';
const state = async page => (await snapshot(page)).state[0];
async function settings(page) {
  await page.goto('./#/settings');
  await expect(page.getByRole('button', { name: 'Скачать полную копию', exact: true })).toBeEnabled();
}
async function openPhone(page) {
  await page.locator('main').getByText(model).filter({ visible: true }).first().click();
  const finance = page.getByRole('region', { name: 'Финансовая информация' });
  await expect(finance).toBeVisible();
  await expect(finance.locator('..').locator('..').getByRole('button', { name: 'Закрыть', exact: true })).toBeInViewport({ ratio: 1 });
}
async function buy(page) {
  await page.goto('./#/purchase?action=purchase');
  await page.locator('#model').fill(model); await page.locator('#price').fill('20000');
  await page.getByRole('button', { name: 'Купить телефон', exact: true }).click();
  await expect.poll(async () => (await state(page)).phones.length).toBe(1);
  await openPhone(page);
}
async function start(page) {
  await page.getByRole('button', { name: 'Ремонт', exact: true }).click();
  await expect.poll(async () => (await state(page)).phones[0].status).toBe('repair');
  await openPhone(page);
  await expect(page.getByRole('button', { name: 'На складе', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Продать', exact: true })).toHaveCount(0);
}
async function dialog(page, amount) {
  await page.getByRole('button', { name: 'Завершить ремонт', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Завершить ремонт', exact: true });
  await modal.getByLabel('Стоимость ремонта, ₽').fill(String(amount));
  return modal;
}
async function finish(page, amount, accountId = cash) {
  const modal = await dialog(page, amount);
  if (Number(amount) > 0) await modal.getByLabel('Счёт списания').selectOption(accountId);
  await modal.getByRole('button', { name: 'Завершить ремонт', exact: true }).click();
  await expect(modal).toBeHidden();
  await expect.poll(async () => (await state(page)).phones[0].status).toBe('in_stock');
}
async function cost(page, amount) {
  const finance = page.getByRole('region', { name: 'Финансовая информация' });
  await expect(finance.getByText('Себестоимость').locator('..')).toContainText(amount);
}

test.beforeEach(async ({ page }) => {
  await settings(page);
  await page.evaluate(async ({ bank }) => {
    const db = await new Promise(resolve => { const request = indexedDB.open('phonebooks', 1); request.onsuccess = () => resolve(request.result); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state'), request = store.get('current');
      request.onsuccess = () => {
        const data = request.result; data.accounts[0].openingBalance = 100000;
        data.accounts.push({ ...data.accounts[0], id: bank, name: 'Банк ремонта', type: 'bank', openingBalance: 10000 });
        store.put(data, 'current');
      }; tx.oncomplete = resolve; tx.onabort = reject;
    }); db.close();
  }, { bank });
  await page.reload(); await expect(page.getByRole('button', { name: 'Скачать полную копию', exact: true })).toBeEnabled();
});

test('purchase, repair cancellation/validation, double-click, stock cost and 6000 sale profit', async ({ page }, testInfo) => {
  await buy(page); await cost(page, '20 000'); await start(page);
  const before = await state(page); let modal = await dialog(page, 2000);
  await modal.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(await state(page)).toEqual(before);
  modal = await dialog(page, '');
  await modal.getByRole('button', { name: 'Завершить ремонт', exact: true }).click();
  await expect(modal.getByRole('alert')).toBeVisible(); expect(await state(page)).toEqual(before);
  for (const value of ['-1', '80001', 'bad']) {
    await modal.getByLabel('Стоимость ремонта, ₽').fill(value);
    await modal.getByRole('button', { name: 'Завершить ремонт', exact: true }).click();
    await expect(modal.getByRole('alert')).toBeVisible(); expect(await state(page)).toEqual(before);
  }
  await modal.getByLabel('Стоимость ремонта, ₽').fill('');
  await modal.getByLabel('Стоимость ремонта, ₽').pressSequentially('2000', { delay: 80 });
  await expect(modal.getByLabel('Стоимость ремонта, ₽')).toHaveValue('2000');
  await modal.getByLabel('Комментарий').fill('Замена экрана');
  await page.screenshot({ path: testInfo.outputPath('repair-dialog.png') });
  const box = await modal.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
  await modal.getByRole('button', { name: 'Завершить ремонт', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(modal).toBeHidden(); await cost(page, '22 000');
  await page.screenshot({ path: testInfo.outputPath('repair-card.png') });
  let data = await state(page); expect(data.phones[0].purchasePrice).toBe(20000); expect(data.phones[0].repairs).toHaveLength(1);
  expect(getAccountBalance(data, cash)).toBe(78000); expect(data.expenses).toHaveLength(0);
  await page.getByRole('button', { name: 'Продать', exact: true }).click();
  await page.locator('#sale-price').fill('28000');
  await expect(page.getByText('+6000 ₽', { exact: true })).toBeVisible();
  await expect(page.getByText('+6 000 ₽ · 21%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Продать', exact: true }).last().click();
  await expect.poll(async () => (await state(page)).sales.length).toBe(1);
  data = await state(page); expect(getSaleProfit(data.sales[0], data.phones)).toBe(6000);
  expect(getStats(data, { from: '2000-01-01', to: '2100-01-01' }).netProfit).toBe(6000);
  await page.goto('./#/history'); await expect(page.getByText(`Ремонт · ${model}`, { exact: true }).filter({ visible: true }).first()).toBeVisible();
});

test('repeat repairs, correction across accounts, deletion, zero, reload and actual export/import', async ({ page }) => {
  await buy(page); await start(page); await finish(page, 2000);
  await start(page); await finish(page, 500, bank); await cost(page, '22 500');
  await page.getByRole('button', { name: 'Исправить ремонт 1', exact: true }).click();
  let modal = page.getByRole('dialog', { name: 'Исправить ремонт', exact: true });
  await modal.getByLabel('Стоимость ремонта, ₽').fill('1500'); await modal.getByLabel('Счёт списания').selectOption(bank);
  await modal.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(modal).toBeHidden();
  let data = await state(page); expect(data.phones[0].repairs).toHaveLength(2);
  expect(getAccountBalance(data, cash)).toBe(80000); expect(getAccountBalance(data, bank)).toBe(8000);
  await cost(page, '22 000');
  await page.getByRole('button', { name: 'Удалить ремонт 2', exact: true }).click();
  modal = page.getByRole('dialog', { name: 'Удалить ремонт?', exact: true });
  await modal.getByRole('button', { name: 'Удалить', exact: true }).click(); await expect(modal).toBeHidden();
  expect(getAccountBalance(await state(page), bank)).toBe(8500);
  await start(page); await finish(page, 0); await cost(page, '21 500');
  data = await state(page); expect(data.phones[0].repairs).toHaveLength(2); expect(data.phones[0].repairs[1].accountId).toBeNull();
  await page.reload(); await openPhone(page); await cost(page, '21 500'); expect(await state(page)).toEqual(data);
  await settings(page); const backup = await exportFile(page);
  await upload(page, backup);
  await page.getByRole('button', { name: 'Отмена без записи', exact: true }).click(); expect(await state(page)).toEqual(data);
  await upload(page, backup);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать предварительную полную копию', exact: true }).click(); await download;
  await page.getByLabel('Я сохранил предварительную копию и подтверждаю импорт').check();
  await page.getByLabel('Отдельно разрешаю заменить существующие данные, тему и черновики').check();
  await commitAndReload(page); expect(await state(page)).toEqual(data);
  await page.goto('./#/purchase'); await openPhone(page); await cost(page, '21 500');
});

test('aborted storage write leaves all financial state unchanged and retry commits once', async ({ page }) => {
  await buy(page); await start(page); const before = await state(page);
  const modal = await dialog(page, 2000);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...args) {
      const request = original.call(this, value, ...args);
      if (this.name === 'state' && value.phones?.[0]?.repairs?.length) { IDBObjectStore.prototype.put = original; this.transaction.abort(); }
      return request;
    };
  });
  await modal.getByRole('button', { name: 'Завершить ремонт', exact: true }).click();
  await expect(modal.getByRole('alert')).toBeVisible(); expect(await state(page)).toEqual(before);
  await modal.getByRole('button', { name: 'Завершить ремонт', exact: true }).click(); await expect(modal).toBeHidden();
  const after = await state(page); expect(after.phones[0].repairs).toHaveLength(1); expect(getAccountBalance(after, cash)).toBe(78000);
  await page.reload(); await openPhone(page); await cost(page, '22 000');
});

test('two tabs cannot commit the same repair twice', async ({ page, context }) => {
  await buy(page); await start(page);
  const other = await context.newPage(); await other.goto('./#/purchase'); await openPhone(other);
  const otherDialog = await dialog(other, 2000);
  await finish(page, 2000);
  await otherDialog.getByRole('button', { name: 'Завершить ремонт', exact: true }).click();
  await expect(otherDialog.getByRole('alert')).toContainText('другой вкладкой');
  const data = await state(page); expect(data.phones[0].repairs).toHaveLength(1); expect(getAccountBalance(data, cash)).toBe(78000);
  await other.reload(); await openPhone(other); await cost(other, '22 000'); await other.close();
});

test('offline completion and reload preserve repair history and cost', async ({ page, context }) => {
  await buy(page); await start(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await context.setOffline(true);
  await finish(page, 2000); await page.reload(); await openPhone(page); await cost(page, '22 000');
  expect(getPhoneTotalCost((await state(page)).phones[0])).toBe(22000);
});

test('deleting a phone refunds purchase and repairs to the original accounts', async ({ page }) => {
  await buy(page); await start(page); await finish(page, 2000, bank);
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Удалить закупку?', exact: true });
  await expect(modal).toContainText('Ремонты');
  await modal.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect((await state(page)).phones).toHaveLength(1);
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await modal.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect.poll(async () => (await state(page)).phones.length).toBe(0);
  expect(getAccountBalance(await state(page), cash)).toBe(100000); expect(getAccountBalance(await state(page), bank)).toBe(10000);
  await page.reload(); expect((await state(page)).phones).toHaveLength(0);
});
