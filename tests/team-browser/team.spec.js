import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { buildExportFile } from '../../src/storage/backupFormat.js';
import { realisticSnapshot } from '../fixtures/realistic.js';
import { readSpreadsheet, writeSpreadsheet } from '../../src/domain/spreadsheetFile.js';
import { spreadsheetTemplate } from '../../src/domain/spreadsheet.js';

const team = 'https://127.0.0.1:4398';
const solo = 'http://localhost:4397';
const password = 'Team-testing-123!';
const uniqueEmail = () => randomUUID() + '@phonebooks.test';

async function mailLink(page, address, kind) {
  const mailbox = new URL('/__test/mail', team);
  mailbox.search = new URLSearchParams({ email: address, kind }).toString();
  const response = await page.request.get(mailbox.href);
  const { token } = await response.json();
  expect(token).toBeTruthy();
  return team + '/?view=' + (kind === 'email' ? 'confirm' : 'reset') + '#' + token;
}

async function credentials(page, address, secret = password) {
  await page.getByLabel('Электронная почта').fill(address);
  await page.getByLabel('Пароль', { exact: true }).fill(secret);
}

async function register(page, address, { checkUnconfirmed = false } = {}) {
  await page.goto(team);
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await credentials(page, address);
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('подтвердите адрес');
  if (checkUnconfirmed) {
    await credentials(page, address);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Сначала подтвердите почту.');
  }
  await page.goto(await mailLink(page, address, 'email'));
  await expect(page).toHaveURL(team + '/');
  await page.getByRole('button', { name: 'Подтвердить адрес' }).click();
  await expect(page.getByRole('heading', { name: 'Рабочие пространства' })).toBeVisible();
}

async function login(page, address, secret = password) {
  await page.goto(team);
  await credentials(page, address, secret);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Рабочие пространства' })).toBeVisible();
}

async function go(page, route) {
  await page.evaluate(route => { location.hash = '/' + route; }, route);
  await expect(page).toHaveURL(new RegExp('#/' + route + '$'));
}

const workData = page => page.getByRole('region', { name: 'Рабочие данные' });

async function createWorkspace(page, name) {
  await page.getByRole('button', { name: 'Рабочие пространства', exact: true }).click();
  await page.getByLabel('Название нового пространства').fill(name);
  await page.getByRole('button', { name: 'Создать пространство' }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(workData(page).getByText('Подключено', { exact: true })).toBeVisible();
}

async function sheetShot(panel, info, mode) {
  const directory = process.env.PHONEBOOKS_SHEET_SHOTS;
  if (!directory || info.project.name === 'team-firefox') return;
  await mkdir(directory, { recursive: true });
  const suffix = info.project.name === 'team-iphone-webkit' ? 'iphone' : 'desktop';
  const review = panel.locator('.pb-sheet-review');
  await review.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await panel.page().screenshot({ path: resolve(directory, mode + '-' + suffix + '.png'), animations: 'disabled' });
}

for (const [mode, format] of [['Solo', 'csv'], ['Team', 'xlsx']]) {
  test(mode + ' previews a real spreadsheet, cancels safely, imports history and downloads an export', async ({ page, context }, info) => {
    if (mode === 'Team') {
      await register(page, uniqueEmail());
      await createWorkspace(page, 'Учебные таблицы');
      await go(page, 'settings');
    } else {
      await page.goto(solo + '/#/settings');
      await expect(page.getByRole('button', { name: 'Скачать полную копию' })).toBeEnabled();
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      });
      await context.setOffline(true);
    }
    await page.getByText('Импорт и экспорт Excel/CSV', { exact: true }).click();
    const panel = page.getByRole('region', { name: 'Таблицы Excel и CSV' });
    const file = { name: 'demo.' + format, mimeType: 'application/octet-stream', buffer: Buffer.from(writeSpreadsheet(format, spreadsheetTemplate)) };
    async function preview() {
      await panel.getByLabel('Файл Excel или CSV').setInputFiles(file);
      await panel.getByRole('button', { name: 'Проверить и показать сводку' }).click();
      await expect(panel.getByText('Строк готово 2 · ошибок 0')).toBeVisible();
    }
    await preview();
    await expect(panel.getByRole('button', { name: 'Подтвердить импорт' })).toBeDisabled();
    await panel.getByRole('button', { name: 'Отменить импорт', exact: true }).click();
    await expect(panel.getByText('Предпросмотр импорта')).toHaveCount(0);
    await preview();
    await sheetShot(panel, info, mode.toLowerCase());
    await panel.getByRole('checkbox', { name: /Подтверждаю добавление строк/ }).check();
    await panel.getByRole('button', { name: 'Подтвердить импорт' }).click();
    await expect(panel.getByText('Импорт завершён. Строк: 2.')).toBeVisible({ timeout: 20000 });
    await panel.getByRole('button', { name: 'Экспорт', exact: true }).click();
    await panel.getByRole('combobox', { name: 'Данные', exact: true }).selectOption('sale');
    if (mode === 'Solo') await panel.getByRole('combobox', { name: 'Формат файла', exact: true }).selectOption('csv');
    const downloadPending = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Скачать экспорт' }).click();
    const download = await downloadPending;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const piece of stream) chunks.push(piece);
    const [exported] = readSpreadsheet(download.suggestedFilename(), Buffer.concat(chunks));
    const [headers, sale] = exported.rows.map(row => row.values);
    expect(Number(sale[headers.indexOf('Выручка, ₽')])).toBe(1400);
    expect(Number(sale[headers.indexOf('Движение кассы, ₽')])).toBe(0);
    if (mode === 'Team') {
      await panel.getByRole('button', { name: 'Импорт', exact: true }).click();
      page.once('dialog', dialog => dialog.accept());
      await panel.getByRole('button', { name: 'Отменить последний импорт' }).click();
      await expect(panel.getByText('Состояние до импорта восстановлено.')).toBeVisible();
    } else {
      await expect(page.getByText('До импорта таблицы', { exact: false })).toBeHidden();
      await page.getByText(/Точки восстановления/).click();
      await expect(page.getByText(/До импорта таблицы/)).toBeVisible();
      await context.setOffline(false);
    }
  });
}

async function invite(page, email) {
  await page.getByRole('button', { name: 'Рабочие пространства', exact: true }).click();
  await page.getByLabel('Почта сотрудника').fill(email);
  await page.getByRole('button', { name: 'Создать приглашение' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: email })).toContainText('Ожидает');
}

test('registration, email verification, session refresh, other-session revocation and password recovery', async ({ page, browser }) => {
  const address = uniqueEmail();
  const other = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await register(page, address, { checkUnconfirmed: true });
    const cookies = await page.context().cookies(team);
    expect(cookies.filter(cookie => cookie.name.startsWith('__Host-pb-')).map(cookie => cookie.httpOnly && cookie.secure))
      .toEqual([true, true]);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    await page.context().clearCookies({ name: '__Host-pb-access' });
    await page.reload();
    await page.getByRole('button', { name: 'Аккаунт', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Аккаунт', exact: true })).toBeVisible();
    await expect(page.locator('main').getByText(address, { exact: true })).toBeVisible();
    expect((await page.context().cookies(team)).some(cookie => cookie.name === '__Host-pb-access')).toBe(true);
    const otherPage = await other.newPage();
    await login(otherPage, address);
    await page.getByRole('button', { name: 'Завершить другие сессии' }).click();
    await expect(page.getByRole('status')).toHaveText('Другие сессии завершены.');
    await otherPage.reload();
    await expect(otherPage.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Забыли пароль?' }).click();
    await page.getByLabel('Электронная почта').fill(address);
    await page.getByRole('button', { name: 'Отправить ссылку' }).click();
    await expect(page.getByRole('status')).toContainText('ссылка для восстановления');
    await page.goto(await mailLink(page, address, 'recovery'));
    await page.getByRole('button', { name: 'Продолжить восстановление' }).click();
    await page.locator('form').getByLabel('Новый пароль').fill('Team-updated-123!');
    await page.getByRole('button', { name: 'Сохранить пароль' }).click();
    await expect(page.getByRole('status')).toContainText('Пароль изменён');
    await login(page, address, 'Team-updated-123!');
  } finally {
    await other.close();
  }
});

test('workspace selection, invitation acceptance, revocation and user isolation', async ({ page, browser }) => {
  const receiver = uniqueEmail();
  const outsider = uniqueEmail();
  const receiverContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const outsiderContext = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await register(page, uniqueEmail());
    await createWorkspace(page, 'Первый магазин');
    await createWorkspace(page, 'Второй магазин');
    await go(page, 'team');
    await page.getByLabel('Выбрать пространство').selectOption({ label: 'Первый магазин · Владелец' });
    await expect(page.getByRole('heading', { name: 'Первый магазин', exact: true })).toBeVisible();
    await invite(page, receiver);
    await invite(page, outsider);
    const workspaceId = await page.getByLabel('Выбрать пространство').inputValue();
    const outsiderInvite = page.getByRole('listitem').filter({ hasText: outsider });
    await outsiderInvite.getByRole('button', { name: 'Отозвать' }).click();
    await expect(outsiderInvite).toContainText('Отозвано');

    const outside = await outsiderContext.newPage();
    await register(outside, outsider);
    await expect(outside.getByRole('heading', { name: 'Входящие приглашения' })).toHaveCount(0);
    await expect(outside.getByText('Первый магазин', { exact: true })).toHaveCount(0);
    const forbidden = await outside.request.post(team + '/api/invitations/create', {
      headers: { Origin: team }, data: { p_workspace_id: workspaceId, p_email: outsider, p_role: 'employee' },
    });
    expect(forbidden.status()).toBe(403);
    const crossOrigin = await page.request.post(team + '/api/workspaces', {
      headers: { Origin: solo }, data: { p_preferred: workspaceId },
    });
    expect(crossOrigin.status()).toBe(403);

    const invited = await receiverContext.newPage();
    await register(invited, receiver);
    await expect(invited.getByRole('heading', { name: 'Входящие приглашения' })).toBeVisible();
    await invited.getByRole('button', { name: 'Принять приглашение' }).click();
    await expect(invited).toHaveURL(/#\/dashboard$/);
    await go(invited, 'team');
    await expect(invited.getByRole('heading', { name: 'Первый магазин', exact: true })).toBeVisible();
    await expect(invited.getByText('Ваша роль — Сотрудник.')).toBeVisible();
    await expect(invited.getByText(outsider, { exact: true })).toHaveCount(0);
    await expect(invited.getByRole('heading', { name: 'Приглашения сотрудников' })).toHaveCount(0);
  } finally {
    await receiverContext.close();
    await outsiderContext.close();
  }
});

test('Solo keeps its local data and opens offline after switching to Team and back', async ({ page }) => {
  await page.goto(solo + '/#/settings');
  const businessName = page.getByRole('textbox', { name: 'Название бизнеса' });
  await businessName.fill('Локальный магазин');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  // Switching flushes the pending write before leaving the Solo origin.
  await page.getByRole('link', { name: 'Открыть PhoneBooks Team' }).click();
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  await expect(page.getByText('Локальный магазин', { exact: true })).toHaveCount(0);
  await register(page, uniqueEmail());
  await createWorkspace(page, 'Облачный магазин');
  expect(await page.context().cookies(solo)).toEqual([]);
  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  if (await more.isVisible()) await more.click();
  await page.getByRole('link', { name: 'Перейти в Solo' }).click();
  await expect(businessName).toHaveValue('Локальный магазин');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await page.reload();
  await expect(businessName).toHaveValue('Локальный магазин');
  await expect(page.getByText('Облачный магазин', { exact: true })).toHaveCount(0);
});

test('team sees confirmed stock changes and can recover after a committed sale loses its response', async ({ page, browser }) => {
  const owner = uniqueEmail();
  const receiver = uniqueEmail();
  const staffContext = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await register(page, owner);
    await createWorkspace(page, 'Рабочий склад');
    const stock = workData(page);
    const submit = stock.getByRole('button', { name: 'Провести операцию' });
    await expect(stock.getByText('Подключено', { exact: true })).toBeVisible();
    await go(page, 'finance');
    await stock.getByRole('button', { name: 'Пополнить счёт' }).click();
    await stock.getByLabel('Сумма, ₽').fill('1000');
    await submit.click();
    await expect(stock.getByText('Операция подтверждена сервером.')).toBeVisible();
    await go(page, 'purchase');
    await stock.getByRole('button', { name: 'Добавить товар' }).click();
    await stock.getByLabel('Название товара').fill('Тестовый ноутбук');
    await stock.getByLabel('Цена за единицу, ₽').fill('200');
    await submit.click();
    await expect(stock.getByRole('listitem').filter({ hasText: 'Тестовый ноутбук' })).toContainText('Остаток 1');
    await invite(page, receiver);

    const staffPage = await staffContext.newPage();
    await register(staffPage, receiver);
    await staffPage.getByRole('button', { name: 'Принять приглашение' }).click();
    await expect(staffPage).toHaveURL(/#\/dashboard$/);
    const staffStock = workData(staffPage);
    await go(staffPage, 'purchase');
    const staffProduct = staffStock.getByRole('listitem').filter({ hasText: 'Тестовый ноутбук' });
    await expect(staffProduct).toContainText('Остаток 1');
    await expect(staffStock.getByRole('heading', { name: 'Касса и счета', exact: true })).toHaveCount(0);
    await staffPage.route('**/api/cloud/command', async route => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    }, { times: 1 });
    await go(staffPage, 'sales');
    await staffStock.getByRole('button', { name: 'Оформить продажу' }).click();
    await staffStock.getByRole('combobox', { name: 'Товар', exact: true }).selectOption({ label: 'Тестовый ноутбук' });
    await staffStock.getByLabel('Цена за единицу, ₽').fill('340');
    await staffStock.getByRole('button', { name: 'Провести операцию' }).click();
    await expect(staffStock.getByText('Операция ожидает подтверждения.')).toBeVisible();
    await expect(staffStock.getByText(/Операция подтверждена/)).toHaveCount(0);

    await staffContext.setOffline(true);
    await expect(staffStock.getByText(/Нет интернета/)).toBeVisible();
    await expect(staffStock.getByRole('button', { name: 'Проверить операцию' })).toBeDisabled();
    await go(staffPage, 'purchase');
    await expect(staffProduct).toBeVisible();
    await staffContext.setOffline(false);
    await staffStock.getByRole('button', { name: 'Проверить операцию' }).click();
    await expect(staffStock.getByText('Операция подтверждена сервером.')).toBeVisible();
    await go(page, 'purchase');
    await expect(stock.getByRole('listitem').filter({ hasText: 'Тестовый ноутбук' })).toContainText('Остаток 0');
    await go(page, 'sales');
    await expect(stock.getByRole('heading', { name: 'Операции продаж' })).toBeVisible();
    await stock.getByRole('button', { name: /Тестовый ноутбук/ }).click();
    await expect(stock.getByText(/Валовая прибыль/).filter({ hasText: '140' })).toBeVisible();
  } finally {
    await staffContext.close();
  }
});

test('owner reviews a local Solo backup before an atomic import and can replay the same copy', async ({ page }) => {
  const data = realisticSnapshot();
  const file = { name: 'solo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(buildExportFile(data))) };
  await register(page, uniqueEmail());
  await createWorkspace(page, 'Перенос склада');
  const stock = workData(page);
  await expect(stock.getByText('Подключено', { exact: true })).toBeVisible();
  await go(page, 'settings');
  await stock.getByText('Перенос из Solo', { exact: true }).click();
  const input = stock.getByLabel('Резервная копия Solo');
  const confirm = stock.getByRole('button', { name: 'Подтвердить перенос' });
  await input.setInputFiles(file);
  await expect(stock.getByText(/Карточки: 5\./)).toBeVisible();
  await go(page, 'purchase');
  await expect(stock.getByText('Склад пуст.')).toBeVisible();
  await go(page, 'settings');
  await confirm.click();
  await expect(stock.getByText('Сервер подтвердил перенос и сверку данных.')).toBeVisible();
  await go(page, 'purchase');
  await expect(stock.getByRole('listitem').filter({ hasText: 'Чехол' })).toContainText('Остаток');
  await go(page, 'settings');
  await input.setInputFiles([]);
  await input.setInputFiles(file);
  await confirm.click();
  await expect(stock.getByText('Сервер подтвердил ранее завершённый перенос.')).toBeVisible();
  await go(page, 'purchase');
  await expect(stock.getByRole('listitem').filter({ hasText: 'Чехол' })).toHaveCount(1);
});

test('large Solo backup resumes after a reload without reuploading an acknowledged chunk', async ({ page }) => {
  const data = realisticSnapshot();
  for (let index = 0; index < 75; index++) {
    data.indexedDB.state[0].value.audit.push({
      id: 'large-' + index, at: '2026-01-03T00:00:00Z', action: 'note',
      entity: 'audit', entityId: 'fixture', summary: String(index) + 'a'.repeat(60000),
    });
  }
  const buffer = Buffer.from(JSON.stringify(buildExportFile(data)));
  expect(buffer.length).toBeGreaterThan(4 * 1024 * 1024);
  const file = { name: 'solo-large.json', mimeType: 'application/json', buffer };
  const positions = [];
  let disconnected = false;
  await page.route('**/api/cloud/transfer', route => {
    const body = route.request().postDataJSON();
    if (body.action === 'chunk') {
      positions.push(body.position);
      if (body.position === 1 && !disconnected) {
        disconnected = true;
        return route.abort('failed');
      }
    }
    return route.continue();
  });
  await register(page, uniqueEmail());
  await createWorkspace(page, 'Большой перенос');
  const stock = workData(page);
  const open = async () => {
    await expect(stock.getByText('Подключено', { exact: true })).toBeVisible();
    await go(page, 'settings');
    await stock.getByText('Перенос из Solo', { exact: true }).click();
    await stock.getByLabel('Резервная копия Solo').setInputFiles(file);
    await stock.getByRole('button', { name: 'Подтвердить перенос' }).click();
  };
  await open();
  await expect(stock.getByRole('alert')).toContainText('Повторите перенос той же копии');
  await go(page, 'purchase');
  await expect(stock.getByText('Склад пуст.')).toBeVisible();
  await go(page, 'settings');
  await page.reload();
  await open();
  await expect(stock.getByText('Сервер подтвердил перенос и сверку данных.')).toBeVisible({ timeout: 30_000 });
  expect(positions.filter(position => position === 0)).toHaveLength(1);
  expect(positions.filter(position => position === 1)).toHaveLength(2);
  await go(page, 'purchase');
  await expect(stock.getByRole('listitem').filter({ hasText: 'Чехол' })).toHaveCount(1);
});

test('cancelling before server publication leaves Team empty and allows restarting', async ({ page }) => {
  const buffer = Buffer.from(JSON.stringify(buildExportFile(realisticSnapshot())));
  let release;
  const waitForCancel = new Promise(resolve => { release = resolve; });
  let allowCommit = false;
  let commitRequested = false;
  await page.route('**/api/cloud/transfer', async route => {
    if (route.request().postDataJSON().action === 'commit' && !allowCommit) {
      commitRequested = true;
      await waitForCancel;
    }
    await route.continue();
  });
  await register(page, uniqueEmail());
  await createWorkspace(page, 'Отмена переноса');
  const stock = workData(page);
  await expect(stock.getByText('Подключено', { exact: true })).toBeVisible();
  await go(page, 'settings');
  await stock.getByText('Перенос из Solo', { exact: true }).click();
  await stock.getByLabel('Резервная копия Solo').setInputFiles({ name: 'solo.json', mimeType: 'application/json', buffer });
  const confirm = stock.getByRole('button', { name: 'Подтвердить перенос' });
  try {
    await confirm.click();
    await expect.poll(() => commitRequested).toBe(true);
    await stock.getByRole('button', { name: 'Отменить перенос' }).click();
    await expect(stock.getByText('Перенос отменён. Исходная копия сохранена.')).toBeVisible();
  } finally {
    allowCommit = true;
    release();
  }
  await go(page, 'purchase');
  await expect(stock.getByText('Склад пуст.')).toBeVisible();
  await go(page, 'settings');
  await confirm.click();
  await expect(stock.getByText('Сервер подтвердил перенос и сверку данных.')).toBeVisible();
});

test('owner creates and assigns a reusable role, denies sensitive access live and sees an audit entry', async ({ page, browser }) => {
  const staffEmail = uniqueEmail();
  const staffContext = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await register(page, uniqueEmail());
    await createWorkspace(page, 'Команда без управляющего');
    const panel = page.getByRole('region', { name: 'Команда', exact: true });
    const stock = workData(page);
    await go(page, 'finance');
    await stock.getByRole('button', { name: 'Пополнить счёт' }).click();
    await stock.getByLabel('Сумма, ₽').fill('100');
    await stock.getByRole('button', { name: 'Провести операцию' }).click();
    await expect(stock.getByText('Операция подтверждена сервером.')).toBeVisible();
    await go(page, 'purchase');
    await stock.getByRole('button', { name: 'Добавить товар' }).click();
    await stock.getByLabel('Название товара').fill('Телефон для проверки прав');
    await stock.getByLabel('Цена за единицу, ₽').fill('20');
    await stock.getByRole('button', { name: 'Провести операцию' }).click();
    await expect(stock.getByRole('listitem').filter({ hasText: 'Телефон для проверки прав' })).toBeVisible();
    await go(page, 'team');
    await panel.getByText('Роли и права доступа', { exact: true }).click();
    await panel.getByLabel('Название роли').fill('Продавец');
    await panel.getByRole('checkbox', { name: 'Просмотр товаров', exact: true }).check();
    await panel.getByRole('checkbox', { name: 'Оформление продаж', exact: true }).check();
    await panel.getByRole('checkbox', { name: 'Просмотр кассы', exact: true }).check();
    await panel.getByRole('checkbox', { name: 'Собственная статистика', exact: true }).check();
    await panel.getByRole('button', { name: 'Создать роль', exact: true }).click();
    await expect(panel.getByText('Настройки команды сохранены.')).toBeVisible();
    const inviteForm = page.getByRole('heading', { name: 'Приглашения сотрудников' }).locator('..').locator('form');
    await inviteForm.locator('select[name="role"]').selectOption({ label: 'Продавец' });
    await invite(page, staffEmail);

    const staff = await staffContext.newPage();
    await register(staff, staffEmail);
    await staff.getByRole('button', { name: 'Принять приглашение' }).click();
    await expect(staff).toHaveURL(/#\/dashboard$/);
    const staffStock = workData(staff);
    await expect(staff).toHaveURL(/#\/dashboard$/);
    await go(staff, 'team');
    await expect(staff.getByText('Ваша роль — Продавец.')).toBeVisible();
    await go(staff, 'finance');
    await expect(staffStock.getByRole('heading', { name: 'Касса и счета', exact: true })).toBeVisible();
    await go(staff, 'sales');
    await staffStock.getByRole('button', { name: 'Оформить продажу' }).click();
    await expect(staffStock.getByRole('button', { name: 'Провести операцию' })).toBeVisible();
    await staff.route('**/api/cloud/command', route => route.abort('failed'), { times: 1 });
    await staffStock.getByRole('combobox', { name: 'Товар', exact: true }).selectOption({ label: 'Телефон для проверки прав' });
    await staffStock.getByLabel('Цена за единицу, ₽').fill('40');
    await staffStock.getByRole('button', { name: 'Провести операцию' }).click();
    await expect(staffStock.getByRole('button', { name: 'Проверить операцию' })).toBeVisible();

    await panel.getByText(staffEmail + ' · Продавец', { exact: true }).click();
    await panel.getByText('Индивидуальные разрешения', { exact: true }).click();
    await panel.getByRole('combobox', { name: 'Просмотр кассы', exact: true }).selectOption('false');
    await panel.getByRole('combobox', { name: 'Оформление продаж', exact: true }).selectOption('false');
    await panel.getByRole('button', { name: 'Сохранить доступ сотрудника', exact: true }).click();
    await expect(staffStock.getByRole('heading', { name: 'Касса и счета', exact: true })).toHaveCount(0, { timeout: 12_000 });
    await expect(staffStock.getByRole('button', { name: 'Провести операцию' })).toHaveCount(0, { timeout: 12_000 });
    await expect(staffStock.getByRole('button', { name: 'Проверить операцию' })).toHaveCount(0);
    expect(await staff.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('phonebooks.team.pending:')))).toEqual([]);
    await panel.getByText('Журнал действий', { exact: true }).click();
    await panel.getByLabel('Тип действия').selectOption('member.permission');
    await panel.getByRole('button', { name: 'Показать журнал' }).click();
    await expect(panel.locator('summary').filter({ hasText: /^Изменение индивидуального права/ })).toHaveCount(2);
    await panel.getByText('Статистика сотрудников', { exact: true }).click();
    await panel.getByRole('button', { name: 'Показать статистику' }).click();
    await expect(panel.getByText('Текущая касса', { exact: true })).toBeVisible();
  } finally {
    await staffContext.close();
  }
});
