import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { demoSoloUrl, demoTeamUrl } from '../../src/demo/mode.js';
import { interfaceMatrix, soloRoutes, teamRoutes } from '../support/interface-layout.js';

async function capture(page, info, name) {
  const dir = process.env.PHONEBOOKS_RELEASE_SHOTS;
  if (!dir || info.project.name === 'firefox') return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, name + '-' + info.project.name + '.png'), animations: 'disabled' });
}

async function layout(page, route) {
  await expect(page.locator('main')).toBeVisible();
  const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(width.document, route).toBeLessThanOrEqual(width.viewport);
  await expect(page.locator('main')).toHaveCSS('font-family', /Manrope/);
}

for (const mode of ['solo', 'team']) {
  const solo = mode === 'solo';
  const url = solo ? demoSoloUrl : demoTeamUrl;
  test(mode + ' demo interface and contrast at six widths in both themes', async ({ page }) => {
    test.slow();
    await page.goto(url);
    await expect(page.getByRole('note').getByText('Демоверсия')).toBeVisible();
    await interfaceMatrix(page, { url, solo });
  });
  test(mode + ' guest demo, financial reports and 320 px routes', async ({ page }, info) => {
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith(url)) external.push(request.url()); });
    await page.setViewportSize({ width: info.project.name === 'iphone-webkit' ? 390 : 1280, height: 850 });
    await page.goto(url);
    await expect(page.getByRole('note').getByText('Демоверсия')).toBeVisible();
    await expect(page.getByText('Выручка', { exact: true })).toBeVisible();
    await capture(page, info, mode + '-overview');
    await page.setViewportSize({ width: 320, height: 720 });
    for (const route of solo ? soloRoutes : teamRoutes) {
      await page.goto(url + '#/' + route);
      await expect(page).toHaveURL(url + '#/' + route);
      await layout(page, route);
    }
    await expect(page.getByText('Импорт и экспорт Excel/CSV')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Скачать полную копию' })).toHaveCount(0);
    await page.setViewportSize({ width: info.project.name === 'iphone-webkit' ? 390 : 1280, height: 850 });
    await page.goto(url + '#/purchase');
    await expect(page.getByText(/iPhone/).first()).toBeVisible();
    await capture(page, info, mode + '-stock');
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(url + '#/' + (solo ? 'catalog' : 'purchase'));
    const stockActions = page.getByRole('group', { name: 'Действия склада' });
    await expect(stockActions.getByRole('button', { name: 'Добавить товар' })).toBeVisible();
    const stockLayout = await stockActions.evaluate(group => {
      const search = group.previousElementSibling;
      const list = group.nextElementSibling;
      return search.classList.contains('pb-toolbar') && list.classList.contains('pb-list') &&
        group.getBoundingClientRect().bottom <= list.getBoundingClientRect().top;
    });
    expect(stockLayout).toBe(true);
    await layout(page, 'stock actions');
    await page.goto(url + '#/finance');
    const quick = page.getByRole('group', { name: 'Быстрые действия' });
    await expect(quick).toBeVisible();
    const actionSizes = await quick.getByRole('button').evaluateAll(buttons => buttons.map(button => ({
      height: button.getBoundingClientRect().height, radius: getComputedStyle(button).borderRadius,
    })));
    expect(new Set(actionSizes.map(size => size.height)).size).toBe(1);
    expect(new Set(actionSizes.map(size => size.radius)).size).toBe(1);
    const actionsAbove = await quick.evaluate(group => {
      const metrics = group.closest('main').querySelector('.pb-metrics');
      return metrics && group.getBoundingClientRect().bottom <= metrics.getBoundingClientRect().top;
    });
    expect(actionsAbove).toBe(true);
    await page.setViewportSize({ width: info.project.name === 'iphone-webkit' ? 390 : 1280, height: 850 });
    await page.getByRole('button', { name: 'Расширенная аналитика' }).click();
    await expect(page.getByRole('img', { name: 'Выручка за выбранный период' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Скачать Excel' })).toHaveCount(0);
    await capture(page, info, mode + '-analytics');
    await page.getByRole('button', { name: 'Залежавшиеся товары' }).click();
    await expect(page.getByText('Заморожено в товарах')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lenovo ThinkPad T14' })).toBeVisible();
    await capture(page, info, mode + '-aging');
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
}

test('Solo demo uses its own IndexedDB and preserves changes offline', async ({ page, context }) => {
  await page.goto(demoSoloUrl + '#/settings');
  await expect(page.getByText('Демоверсия', { exact: true })).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller != null);
  await page.getByLabel('Название бизнеса').fill('Учебная проверка');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => page.evaluate(() => new Promise(resolve => {
    const opened = indexedDB.open('phonebooks-demo-v2');
    opened.onsuccess = () => {
      const db = opened.result;
      const req = db.transaction('state').objectStore('state').get('current');
      req.onsuccess = () => { resolve(req.result.settings.businessName); db.close(); };
    };
  }))).toBe('Учебная проверка');
  if (await page.evaluate(() => typeof indexedDB.databases === 'function')) {
    expect(await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name))).not.toContain('phonebooks');
  }
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('Название бизнеса')).toHaveValue('Учебная проверка');
});

test('Team demo guest sessions use isolated businesses and block transfers and exports', async ({ browser }) => {
  const origin = new URL(demoTeamUrl).origin;
  const contexts = [await browser.newContext(), await browser.newContext()];
  try {
    const post = (context, path, data) => context.request.post(origin + '/api/' + path, { data, headers: { Origin: origin } });
    const [left, right] = await Promise.all(contexts.map(context => post(context, 'workspaces', { p_preferred: null }).then(async response => {
      expect(response.ok()).toBeTruthy();
      return response.json();
    })));
    expect(left.selected.id).not.toBe(right.selected.id);
    const scope = { p_workspace: left.selected.id, p_actor: left.account.id };
    expect((await post(contexts[1], 'cloud/feed', { ...scope, p_position: { since: null } })).status()).toBe(403);
    for (const route of ['cloud/transfer', 'cloud/sheet-export', 'cloud/sheet-import', 'auth/register']) {
      expect((await post(contexts[0], route, scope)).ok()).toBeFalsy();
    }
    const members = await post(contexts[0], 'team/members', scope);
    expect((await members.json()).members).toHaveLength(3);
    expect((await post(contexts[0], 'cloud/command', { ...scope, p_request: crypto.randomUUID(),
      p_command: { type: 'deposit', accountId: 'ac_default_cash', amountMinor: 500 } })).ok()).toBeTruthy();
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
