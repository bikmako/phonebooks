import { test, expect } from '@playwright/test';
import { setPhoneStatus } from '../../src/domain/phones.js';
import { completeRepair, getRepairSessionId } from '../../src/domain/repairs.js';
import { realisticSnapshot } from '../fixtures/realistic.js';
import { snapshot, exportFile, upload, commitAndReload } from '../browser/helpers.js';

const notice = page => page.getByRole('region', { name: 'Обновление PhoneBooks' });
async function release(request, name, failure) {
  await request.post('http://127.0.0.1:4175/__test/release', { data: { release: name, failure } });
}
async function controlled(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
}
async function check(page, event = 'online') {
  await page.evaluate(type => {
    window.dispatchEvent(new Event(type));
  }, event);
}
async function ready(page, request, name = 'b') {
  await release(request, name);
  await page.bringToFront();
  // Lifecycle tests need a prepared worker, independent of the other tab's
  // startup update job. Detection timing is tested separately below.
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
    await registration.update();
  });
  await expect(notice(page)).toBeVisible();
}
async function apply(page) {
  const navigation = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
  await notice(page).getByRole('button', { name: 'Обновить', exact: true }).click();
  await navigation;
  await page.waitForLoadState('load');
  await expect(page.getByRole('button', { name: 'Скачать полную копию', exact: true })).toBeVisible();
  await controlled(page);
}
async function seed(page) {
  const fixture = realisticSnapshot();
  let data = fixture.indexedDB.state[0].value;
  const phoneId = data.phones[2].id;
  data = setPhoneStatus(data, phoneId, 'repair');
  data = completeRepair(data, phoneId, { sessionId: getRepairSessionId(data.phones[2]), amount: 2500, accountId: data.accounts[0].id, comment: 'Учебный ремонт' });
  fixture.indexedDB.state[0].value = data;
  fixture.indexedDB.backups[0].value.payload = JSON.stringify(data);
  await page.evaluate(async data => {
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open('phonebooks', 1); req.onsuccess = () => resolve(req.result); req.onerror = reject; });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['state', 'backups', 'meta'], 'readwrite');
      for (const name of ['state', 'backups', 'meta']) {
        const store = tx.objectStore(name); store.clear();
        for (const { key, value } of data.indexedDB[name]) store.keyPath ? store.put(value) : store.put(value, key);
      }
      tx.oncomplete = resolve; tx.onabort = reject;
    }); db.close();
    for (const { key, value } of data.localStorage) localStorage.setItem(key, value);
    localStorage.setItem('unrelated', 'preserved');
    const foreign = await caches.open('another-app'); await foreign.put('/other-app', new Response('keep'));
    const sibling = await caches.open('phonebooks-v9-sibling:/demo/'); await sibling.put('/demo/index.html', new Response('demo'));
  }, fixture);
  await page.reload(); await page.waitForLoadState('load');
  await expect(page.getByLabel('Название бизнеса')).toHaveValue('Учебная скупка — синтетические данные');
}
test.beforeEach(async ({ page, request }) => {
  await release(request, 'a');
  await page.goto('./#/settings');
  await expect(page.getByRole('button', { name: 'Скачать полную копию', exact: true })).toBeVisible();
  await controlled(page);
});

test('first installation, prepared offline shell, repeat opening', async ({ page, context }) => {
  await expect(notice(page)).toHaveCount(0);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('Название бизнеса')).toBeVisible();
  expect((await exportFile(page)).formatVersion).toBe(2);
  const another = await context.newPage();
  await another.goto('./#/settings');
  await expect(another.getByLabel('Название бизнеса')).toBeVisible();
  await expect(notice(another)).toHaveCount(0);
  await context.setOffline(false);
});

test('three consecutive releases preserve every store, repair, backup and draft; restore still works', async ({ page, request, context }) => {
  await seed(page);
  const before = await snapshot(page), backup = await exportFile(page);
  let reloads = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) reloads++; });
  for (const version of ['b', 'c', 'd']) {
    await ready(page, request, version);
    expect(await snapshot(page)).toEqual(before);
    await apply(page);
    expect(await snapshot(page)).toEqual(before);
    await expect(page.locator(`[data-test-release="${version}"]`)).toHaveCount(1);
    await expect(notice(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter(k => k.endsWith(':/phonebooks/')).length)).toBe(1);
  }
  expect(reloads).toBe(3);
  expect(await page.evaluate(async () => (await caches.keys()).includes('another-app') && (await caches.keys()).includes('phonebooks-v9-sibling:/demo/'))).toBe(true);
  await context.setOffline(true); await page.reload();
  await expect(page.getByLabel('Название бизнеса')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await context.setOffline(false);
  await upload(page, backup);
  await page.getByRole('button', { name: 'Скачать предварительную полную копию' }).click();
  await page.getByLabel('Я сохранил предварительную копию и подтверждаю импорт').check();
  await page.getByLabel('Отдельно разрешаю заменить существующие данные, тему и черновики').check();
  await commitAndReload(page);
  const after = await snapshot(page);
  expect(after.state).toEqual(before.state); expect(after.backups).toEqual(before.backups); expect(after.localStorage).toEqual(before.localStorage);
});

test('Later survives reload/focus/online and reminds after four hours', async ({ page, request }) => {
  await ready(page, request);
  const before = await snapshot(page);
  await notice(page).getByRole('button', { name: 'Позже' }).click();
  await expect(notice(page)).toHaveCount(0);
  await page.reload(); await controlled(page);
  await check(page); await check(page, 'focus');
  await expect(notice(page)).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await page.clock.install();
  await page.clock.setSystemTime(Date.now() + 4 * 60 * 60 * 1000 + 1000);
  await check(page, 'focus');
  await expect(notice(page)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});

test('a different waiting release resets Later', async ({ page, request }) => {
  await ready(page, request);
  await notice(page).getByRole('button', { name: 'Позже' }).click();
  await ready(page, request, 'c');
  await expect(notice(page)).toBeVisible();
});

test('unsaved purchase requires consent; cancel keeps fields, accept flushes current draft', async ({ page, request }) => {
  await ready(page, request);
  await page.goto('./#/purchase?action=purchase');
  const model = page.locator('#model');
  await model.fill('Незавершённый Pixel');
  page.once('dialog', dialog => dialog.dismiss());
  await notice(page).getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(model).toHaveValue('Незавершённый Pixel');
  page.once('dialog', dialog => dialog.accept());
  const navigation = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
  await notice(page).getByRole('button', { name: 'Обновить', exact: true }).click();
  await navigation; await page.waitForLoadState('load');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('phonebooks.draft.phone-new')).model)).toBe('Незавершённый Pixel');
});

test('unsaved settings require consent and saved settings commit before reload', async ({ page, request }) => {
  await ready(page, request);
  await page.getByLabel('Название бизнеса').fill('Новое название');
  page.once('dialog', dialog => dialog.dismiss());
  await notice(page).getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByLabel('Название бизнеса')).toHaveValue('Новое название');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await apply(page);
  await expect(page.getByLabel('Название бизнеса')).toHaveValue('Новое название');
});

for (const failure of ['interrupt', 'corrupt']) test(`${failure}: failed release keeps old cache and retries after reconnection`, async ({ page, request, context }) => {
  await seed(page);
  const before = await snapshot(page);
  await release(request, 'b', failure);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
    if (registration.installing) await new Promise(resolve => {
      const worker = registration.installing;
      worker.addEventListener('statechange', () => { if (worker.state === 'redundant' || worker.state === 'installed') resolve(); });
    });
  });
  await expect(notice(page)).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await context.setOffline(true); await page.reload();
  await expect(page.getByLabel('Название бизнеса')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await release(request, 'b'); await context.setOffline(false); await check(page);
  await expect(notice(page)).toBeVisible(); await apply(page);
  expect(await snapshot(page)).toEqual(before);
});

test('offline update only offered if already fully prepared', async ({ page, request, context }) => {
  await context.setOffline(true); await check(page);
  await expect(notice(page)).toHaveCount(0);
  // Publish before reconnection: Firefox dispatches online immediately, so
  // publishing afterwards can race the already-running (old release) check.
  await release(request, 'b'); await context.setOffline(false); await check(page);
  await expect(notice(page)).toBeVisible();
  await context.setOffline(true); await apply(page);
  await expect(page.locator('[data-test-release="b"]')).toHaveCount(1);
  await context.setOffline(false);
});

test('other tabs prevent activation and are never reloaded', async ({ page, context, request }) => {
  const other = await context.newPage(); await other.goto('./#/settings'); await controlled(other);
  let otherReloads = 0; other.on('framenavigated', frame => { if (frame === other.mainFrame()) otherReloads++; });
  await ready(page, request);
  await notice(page).getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(notice(page).getByRole('alert')).toContainText('Закройте остальные');
  expect(otherReloads).toBe(0);
  await other.close(); await apply(page);
});

test('focus checks are throttled; periodic checks discover a release', async ({ page, request }) => {
  await page.clock.install();
  await page.reload(); await controlled(page);
  await release(request, 'b');
  await page.clock.setSystemTime(Date.now() + 61000);
  await check(page, 'focus');
  await expect(notice(page)).toBeVisible();
  await notice(page).getByRole('button', { name: 'Позже' }).click();
  for (let index = 0; index < 12; index++) await check(page, 'focus');
  const requests = await (await request.get('http://127.0.0.1:4175/__test/requests')).json();
  expect(requests.filter(url => url === 'sw.js').length).toBeLessThanOrEqual(2);
  await release(request, 'c');
  await page.clock.fastForward(15 * 60 * 1000 + 1000);
  await expect(notice(page)).toBeVisible();
});

test('update banner fits safe viewport and moves inside open dialog', async ({ page, request }) => {
  await ready(page, request);
  const box = await notice(page).boundingBox(), viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThan(viewport.height - 62);
  await expect(notice(page).getByRole('button', { name: 'Обновить', exact: true })).toBeInViewport();
  await upload(page, await exportFile(page));
  await expect(page.getByRole('dialog').getByRole('region', { name: 'Обновление PhoneBooks' })).toBeVisible();
  await expect(notice(page).getByRole('button', { name: 'Обновить', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Отмена без записи' }).click();
});

test('real previous build upgrades on next normal navigation without touching storage', async ({ page, request }) => {
  // Start a separate browser context so the old worker is really the first one.
  const oldContext = await page.context().browser().newContext({ ...test.info().project.use, baseURL: 'http://127.0.0.1:4175/phonebooks/' });
  try {
    const old = await oldContext.newPage();
    await release(request, 'legacy'); await old.goto('http://127.0.0.1:4175/phonebooks/#/settings'); await controlled(old);
    await seed(old); const before = await snapshot(old);
    await release(request, 'b');
    // The pre-change UI has no prompt code: its network-first navigation loads
    // the new coordinator on the next user launch/reload. Never force-reload it.
    await old.reload(); await old.waitForLoadState('load');
    await expect(notice(old)).toBeVisible();
    await apply(old);
    expect(await snapshot(old)).toEqual(before);
  } finally { await oldContext.close(); }
});

test('failed accounting write blocks activation and retry commits it', async ({ page, request }) => {
  await ready(page, request);
  const before = await snapshot(page);
  await page.evaluate(() => {
    window.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'state') throw new DOMException('Нет места для записи', 'QuotaExceededError');
      return window.originalPut.apply(this, args);
    };
  });
  await page.getByLabel('Название бизнеса').fill('Запись перед обновлением');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await notice(page).getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(notice(page).getByRole('alert')).toBeVisible();
  await expect(page.locator('[data-test-release="a"]')).toHaveCount(1);
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
  await apply(page);
  await expect(page.getByLabel('Название бизнеса')).toHaveValue('Запись перед обновлением');
});

test('open backup import blocks update without cancelling or overwriting the import', async ({ page, request }) => {
  await ready(page, request);
  const backup = await exportFile(page), before = await snapshot(page);
  await upload(page, backup);
  page.once('dialog', dialog => dialog.accept());
  await notice(page).getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(notice(page).getByRole('alert')).toContainText('просмотр импорта');
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Отмена без записи' }).click();
  await apply(page);
  expect(await snapshot(page)).toEqual(before);
});

test('new sale draft is flushed and quota failure prevents reload', async ({ page, request }) => {
  await ready(page, request);
  await page.goto('./#/sales');
  await page.getByRole('button', { name: 'Продажа', exact: true }).click();
  await page.locator('#buyer').fill('Черновик покупателя');
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'phonebooks.draft.sale-new') throw new DOMException('Нет места для черновика', 'QuotaExceededError');
      return window.originalSetItem.call(this, key, value);
    };
  });
  page.once('dialog', dialog => dialog.accept());
  await notice(page).getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(notice(page).getByRole('alert')).toContainText('Нет места');
  await expect(page.locator('#buyer')).toHaveValue('Черновик покупателя');
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
  page.once('dialog', dialog => dialog.accept());
  const navigation = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
  await notice(page).getByRole('button', { name: 'Обновить', exact: true }).click();
  await navigation; await page.waitForLoadState('load');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('phonebooks.draft.sale-new')).buyerName)).toBe('Черновик покупателя');
});

test('unsaved repair confirmation can be cancelled without losing fields or data', async ({ page, request }) => {
  await seed(page); await ready(page, request);
  await page.goto('./#/purchase');
  const phone = page.locator('main').getByText('iPhone 14').filter({ visible: true }).first();
  await phone.click(); await page.getByRole('button', { name: 'Ремонт', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).state[0].phones[2].status).toBe('repair');
  await phone.click(); await page.getByRole('button', { name: 'Завершить ремонт', exact: true }).click();
  const amount = page.locator('#repair-amount'); await amount.fill('1234');
  const before = await snapshot(page);
  page.once('dialog', dialog => dialog.dismiss());
  await notice(page).getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(amount).toHaveValue('1234');
  expect(await snapshot(page)).toEqual(before);
});

test('first incomplete installation can recover online without document reload', async ({ browser, request }) => {
  const context = await browser.newContext({ ...test.info().project.use, baseURL: 'http://127.0.0.1:4175/phonebooks/' });
  try {
    await release(request, 'a', 'interrupt');
    const fresh = await context.newPage();
    await fresh.goto('./#/settings');
    await expect(fresh.getByLabel('Название бизнеса')).toBeVisible();
    await expect.poll(async () => (await (await request.get('http://127.0.0.1:4175/__test/requests')).json()).includes('release-fixture.txt')).toBe(true);
    await expect.poll(() => fresh.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    await release(request, 'a'); await check(fresh);
    await controlled(fresh);
    await context.setOffline(true); await fresh.reload();
    await expect(fresh.getByLabel('Название бизнеса')).toBeVisible();
  } finally { await context.close(); }
});
