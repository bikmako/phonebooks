import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

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

async function createWorkspace(page, name) {
  await page.getByLabel('Название нового пространства').fill(name);
  await page.getByRole('button', { name: 'Создать пространство' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function invite(page, email) {
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
    await expect(page.getByText(address, { exact: true })).toBeVisible();
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
  await page.getByRole('link', { name: 'Перейти в Solo' }).click();
  await expect(businessName).toHaveValue('Локальный магазин');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await page.reload();
  await expect(businessName).toHaveValue('Локальный магазин');
  await expect(page.getByText('Облачный магазин', { exact: true })).toHaveCount(0);
});
