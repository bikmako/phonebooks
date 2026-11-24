import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

const pass = "Current-testing-123";
const origin = "https://127.0.0.1:4390";
const unique = prefix => prefix + "-" + crypto.randomUUID().slice(0, 10) + "@phonebooks.test";
const post = (request, url, data = {}) => request.post(url, { data, headers: { Origin: origin } });

async function enterCredentials(page, email, password) {
  await page.getByLabel("Электронная почта").fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
}

async function login(page, email, password = pass) {
  await page.goto("/account?view=login");
  await enterCredentials(page, email, password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Аккаунт", exact: true })).toBeVisible();
}

async function createAccount(request, email) {
  expect((await post(request, "/api/auth/register", { email, password: pass })).ok()).toBeTruthy();
  const token = await mail(request, email, "email");
  expect((await post(request, "/api/auth/verify", { kind: "email", token })).ok()).toBeTruthy();
  return (await (await request.get("/api/me")).json()).id;
}

async function mail(request, email, kind) {
  const response = await request.get("/__test/mail", { params: { email, kind } });
  const { token } = await response.json();
  expect(token).toMatch(/^[0-9a-f]{32}$/);
  return token;
}

async function openSettings(page) {
  await page.goto("/workspace/?test=" + crypto.randomUUID() + "#/settings");
  await expect(page.getByRole("textbox", { name: "Название бизнеса" })).toBeVisible();
}

test("registration, confirmation, expired session, password recovery and sign-out on other devices", async ({ page, browser }) => {
  const address = unique("registration");
  await page.goto("/account?view=register");
  await enterCredentials(page, address, pass);
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByRole("heading", { name: "Проверьте почту" })).toBeVisible();
  expect((await post(page.request, "/api/auth/login", { email: address, password: pass })).status()).toBe(403);
  const confirmation = await mail(page.request, address, "email");
  await page.goto("/account?view=confirm#" + confirmation);
  await page.getByRole("button", { name: "Подтвердить почту" }).click();
  await expect(page.getByRole("heading", { name: "Пробный период" })).toBeVisible();
  expect(page.url()).not.toContain(confirmation);
  const account = await (await page.request.get("/api/me")).json();
  expect(Date.parse(account.trialUntil) - Date.parse(account.serverNow)).toBeGreaterThan(72 * 3600000 - 10000);
  expect((await page.context().cookies()).filter(cookie => cookie.name.startsWith("__Host-pb")).every(cookie => cookie.secure && cookie.httpOnly)).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain("pb-access");

  const other = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    expect((await post(other.request, "/api/auth/login", { email: address, password: pass })).ok()).toBeTruthy();
    await page.getByRole("button", { name: "Выйти на других устройствах" }).click();
    await expect(page.getByText("Другие сессии завершены.")).toBeVisible();
    expect((await other.request.get("/api/me")).status()).toBe(401);
    expect((await post(other.request, "/api/session")).status()).toBe(401);
    expect((await page.request.get("/api/me")).ok()).toBeTruthy();
  } finally { await other.close(); }
  await page.goto("/account?view=recover");
  await page.getByLabel("Электронная почта").fill(address);
  await page.getByRole("button", { name: "Отправить ссылку" }).click();
  await expect(page.getByRole("heading", { name: "Проверьте почту" })).toBeVisible();
  const reset = await mail(page.request, address, "recovery");
  await page.goto("/account?view=reset#" + reset);
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByLabel("Пароль", { exact: true }).fill("Replaced-testing-123");
  await page.getByLabel("Повторите пароль").fill("Replaced-testing-123");
  await page.getByRole("button", { name: "Сохранить пароль" }).click();
  await expect(page.getByRole("heading", { name: "Вход в PhoneBooks" })).toBeVisible();
  expect((await post(page.request, "/api/auth/login", { email: address, password: pass })).status()).toBe(400);
  await login(page, address, "Replaced-testing-123");
  expect((await post(page.request, "/api/auth/verify", { kind: "recovery", token: reset })).status()).toBe(400);
});

test("anonymous assets and mutation RPC are closed, owner can record manual payment and lifetime access", async ({ page, browser }) => {
  expect((await page.request.get("/workspace/index.html", { maxRedirects: 0 })).status()).toBe(303);
  expect((await page.request.get("/workspace/sw.js")).status()).toBe(401);
  expect((await page.request.get("/workspace/manifest.webmanifest")).status()).toBe(401);
  expect((await page.request.post("/api/auth/login", { data: { email: "nobody@test.com" }, headers: { Origin: "https://elsewhere.test" } })).status()).toBe(403);
  const address = unique("billing");
  const id = await createAccount(page.request, address);
  expect((await post(page.request, "/api/admin/action", { p_target: id, p_action: "lifetime", p_request_id: crypto.randomUUID() })).status()).toBe(403);
  const userPage = page;
  const staff = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const admin = await staff.newPage();
    await login(admin, "owner@phonebooks.test", "Owner-testing-123");
    await admin.getByRole("link", { name: "Панель владельца" }).click();
    await admin.getByLabel("Почта, источник или партнёр").fill(address);
    await admin.getByRole("button", { name: "Найти" }).click();
    const row = admin.getByRole("listitem").filter({ hasText: address });
    await row.getByRole("button", { name: "Управлять" }).click();
    admin.on("dialog", dialog => dialog.accept());
    await admin.getByRole("button", { name: "Подтвердить 399 ₽" }).click();
    await expect(admin.getByText("Действие сохранено.")).toBeVisible();
    expect((await (await userPage.request.get("/api/me")).json()).status).toBe("active");
    await row.getByRole("button", { name: "Управлять" }).click();
    await expect(admin.getByRole("heading", { name: "Действия владельца" })).toBeVisible();
    await admin.getByRole("button", { name: "Выдать бессрочный доступ" }).click();
    await expect(admin.getByText("Действие сохранено.")).toBeVisible();
    expect((await (await userPage.request.get("/api/me")).json()).status).toBe("lifetime");
    await row.getByRole("button", { name: "Управлять" }).click();
    await admin.getByRole("button", { name: "Заблокировать" }).click();
    await expect(admin.getByText("Действие сохранено.")).toBeVisible();
    expect((await userPage.request.get("/api/me")).status()).toBe(401);
  } finally { await staff.close(); }
});

test("same-browser separation, offline and expired read/export, v2 transfer and no cached bypass", async ({ page, context }) => {
  const first = unique("local-first");
  const second = unique("local-second");
  const id = await createAccount(page.request, first);
  await openSettings(page);
  const field = page.getByRole("textbox", { name: "Название бизнеса" });
  await field.fill("Данные первого аккаунта");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Название сохранено")).toBeVisible();
  const stable = page.getByRole("button", { name: "Скачать полную копию" });
  const downloaded = page.waitForEvent("download");
  await stable.click();
  const backup = await readFile(await (await downloaded).path(), "utf8");
  expect(JSON.parse(backup).snapshot.indexedDB.name).toBe("phonebooks");
  expect(backup).toContain("Данные первого аккаунта");
  const legacy = await page.evaluate(async id => {
    const databases = await indexedDB.databases();
    return databases.map(database => database.name).includes("phonebooks:account:" + id)
      && !databases.map(database => database.name).includes("phonebooks");
  }, id);
  expect(legacy).toBe(true);

  await context.setOffline(true);
  await expect(page.getByText("Без связи · просмотр и экспорт")).toBeVisible();
  await field.fill("Запись офлайн");
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
  await expect(stable).toBeEnabled();
  await context.setOffline(false);
  await expect(page.getByText("PhoneBooks Pro", { exact: true })).toBeVisible();
  const otherTab = await context.newPage();
  await openSettings(otherTab);
  await page.bringToFront();
  await page.getByRole("link", { name: "Аккаунт" }).click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Вход в PhoneBooks" })).toBeVisible();
  expect((await page.request.get("/workspace/sw.js")).status()).toBe(401);
  await expect(otherTab.getByRole("heading", { name: "Вход в PhoneBooks" })).toBeVisible();
  await otherTab.close();

  await createAccount(page.request, second);
  await openSettings(page);
  await expect(field).not.toHaveValue("Данные первого аккаунта");
  await page.getByLabel("Файл резервной копии").setInputFiles({
    name: "historical-export.json", mimeType: "application/json", buffer: Buffer.from(backup),
  });
  await expect(page.getByRole("heading", { name: "Предварительный просмотр импорта" })).toBeVisible();
  await page.getByRole("button", { name: "Скачать предварительную полную копию" }).click();
  await page.getByText("Я сохранил предварительную копию").click();
  await page.getByText("Отдельно разрешаю заменить").click();
  await Promise.all([
    page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame() }),
    page.getByRole("button", { name: "Подтвердить импорт" }).click(),
  ]);
  await expect(field).toHaveValue("Данные первого аккаунта");
  await expect(page.getByRole("heading", { name: "Предварительный просмотр импорта" })).toBeHidden();
  expect((await page.request.post("/__test/expire", { data: { email: second } })).ok()).toBeTruthy();
  await openSettings(page);
  await expect(page.getByText("Доступ истёк · просмотр и экспорт")).toBeVisible();
  await expect(field).toHaveValue("Данные первого аккаунта");
  await expect(stable).toBeEnabled();
  await expect(page.getByLabel("Файл резервной копии")).toBeDisabled();
  await field.fill("Попытка изменения");
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
});

test("installed PWA checks online authorization on navigation and preserves saved data after clock changes", async ({ page, context }) => {
  const address = unique("pwa");
  await createAccount(page.request, address);
  await openSettings(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15000 }).toBe(true);
  const check = await page.evaluate(async () => {
    const keys = await caches.keys();
    return keys.find(name => name.startsWith("phonebooks-v9-") && name.endsWith(":/workspace/"));
  });
  expect(check).toBeTruthy();
  await page.request.post("/__test/expire", { data: { email: address, withinSeconds: 2 } });
  await openSettings(page);
  await page.clock.setSystemTime(new Date("2015-01-01"));
  await expect(page.getByText("Доступ истёк · просмотр и экспорт")).toBeVisible({ timeout: 5000 });
  await page.getByRole("link", { name: "Аккаунт" }).click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Вход в PhoneBooks" })).toBeVisible();
  await page.goto("/workspace/#/settings");
  await expect(page.getByRole("heading", { name: "Вход в PhoneBooks" })).toBeVisible();
  await context.setOffline(true);
  try {
    await page.goto("/workspace/");
    await expect(page.getByText("Для открытия PhoneBooks подключитесь к интернету.")).toBeVisible();
  } catch (error) {
    expect(error.message).toMatch(/OFFLINE|INTERNET_DISCONNECTED|network is offline/i);
  }
  await expect(page.getByRole("textbox", { name: "Название бизнеса" })).toHaveCount(0);
});

test("account PWA consents to a verified update without losing its local writes", async ({ page }) => {
  await createAccount(page.request, unique("upgrade"));
  await openSettings(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15000 }).toBe(true);
  const field = page.getByRole("textbox", { name: "Название бизнеса" });
  await field.fill("База до обновления");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Название сохранено")).toBeVisible();
  expect((await page.request.post("/__test/upgrade")).ok()).toBeTruthy();
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
    await registration.update();
  });
  const notice = page.getByRole("region", { name: "Обновление PhoneBooks" });
  await expect(notice).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute("data-test-release");
  await Promise.all([
    page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame() }),
    notice.getByRole("button", { name: "Обновить", exact: true }).click(),
  ]);
  await expect(page.locator("body")).toHaveAttribute("data-test-release", "upgraded");
  await expect(field).toHaveValue("База до обновления");
  await expect(notice).toHaveCount(0);
});
