import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { contrast } from '../support/interface-layout.js';

test('auth screens, feedback, local type and responsive layout', async ({ page }, info) => {
  const mobile = info.project.name === 'team-iphone-webkit';
  if (!mobile) await page.setViewportSize({ width: 1280, height: 900 });
  const output = process.env.PHONEBOOKS_AUTH_SCREENSHOTS;
  const pendingFonts = [];
  page.on('request', request => {
    if (request.resourceType() === 'font') pendingFonts.push(request.url());
  });
  async function screen(title, imageName) {
    const heading = page.getByRole('heading', { name: title, exact: true });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS('font-size', '28px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (output && info.project.name !== 'team-firefox') {
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: resolve(output, imageName + (mobile ? '-iphone.png' : '-desktop.png')), animations: 'disabled' });
    }
  }

  const address = crypto.randomUUID() + '@phonebooks.test';
  await page.goto('/');
  await screen('Вход', 'login');
  const form = page.locator('main form');
  const input = page.getByLabel('Электронная почта');
  const submit = page.getByRole('button', { name: 'Войти', exact: true });
  await expect(form).toHaveCSS('width', mobile ? '370px' : '380px');
  await expect(page.locator('main')).toHaveCSS('background-color', 'rgb(247, 245, 241)');
  await expect(page.locator('.pb-auth-logo')).toHaveCSS('font-size', '34px');
  await expect(input).toHaveCSS('font-size', '15px');
  await expect(submit).toHaveCSS('border-radius', '10px');
  expect(await page.evaluate(async () => (await document.fonts.load('600 13px Manrope', 'Электронная почта')).length > 0)).toBe(true);
  expect(pendingFonts.length).toBeGreaterThan(0);
  expect(pendingFonts.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);

  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await screen('Регистрация', 'register');
  await input.fill(address);
  await page.getByLabel('Пароль', { exact: true }).fill('Auth-visual-test-1!');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('подтвердите адрес');
  await screen('Вход', 'check-email');
  await input.fill(address);
  await page.getByLabel('Пароль', { exact: true }).fill('Auth-visual-test-1!');
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  await page.route('**/api/auth/login', async route => {
    await wait;
    await route.continue();
  }, { times: 1 });
  try {
    await submit.click();
    await expect(submit).toBeDisabled();
    await expect(form).toHaveAttribute('aria-busy', 'true');
  } finally {
    release();
  }
  await expect(page.getByRole('alert')).toHaveText('Сначала подтвердите почту.');
  await screen('Вход', 'login-error');

  async function followMail(kind, target) {
    const response = await page.request.get('/__test/mail?' + new URLSearchParams({ email: address, kind }));
    const { token } = await response.json();
    expect(token).toBeTruthy();
    await page.goto('/?view=' + target + '#' + token);
  }

  await followMail('email', 'confirm');
  await screen('Подтверждение почты', 'confirm');
  await page.getByRole('button', { name: 'Подтвердить адрес' }).click();
  await expect(page.getByRole('heading', { name: 'Рабочие пространства' })).toBeVisible();
  await page.getByRole('button', { name: 'Аккаунт', exact: true }).click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.getByRole('button', { name: 'Забыли пароль?' }).click();
  await screen('Восстановление пароля', 'recover');
  await input.fill(address);
  await page.getByRole('button', { name: 'Отправить ссылку' }).click();
  await expect(page.getByRole('status')).toContainText('ссылка для восстановления');
  await followMail('recovery', 'reset');
  await screen('Восстановление пароля', 'reset-link');
  await page.getByRole('button', { name: 'Продолжить восстановление' }).click();
  await screen('Новый пароль', 'new-password');

  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.locator('main form')).toHaveCSS('width', '300px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Как в системе. Переключить' }).click();
  await page.getByRole('button', { name: 'Светлая тема. Переключить' }).click();
  await expect(page.locator('main')).toHaveCSS('background-color', 'rgb(25, 24, 22)');
  await contrast(page.locator('main'), 'Team / новый пароль / dark / 320');
});
