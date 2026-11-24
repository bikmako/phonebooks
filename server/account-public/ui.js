const main = document.querySelector("#content");
const query = new URLSearchParams(location.search);
const view = query.get("view");
const emailToken = ["confirm", "reset"].includes(view) ? location.hash.slice(1) : "";
if (emailToken) history.replaceState(null, "", location.pathname + location.search);
const statusNames = {
  pending: "Ожидает подтверждения почты", trial: "Пробный период", active: "Активная подписка",
  expired: "Подписка истекла", lifetime: "Бессрочный доступ", blocked: "Аккаунт заблокирован",
};
const actionNames = {
  payment: "Подтверждена оплата", extend: "Продлена подписка", lifetime: "Выдан бессрочный доступ",
  block: "Аккаунт заблокирован", unblock: "Аккаунт разблокирован", attribution: "Обновлён источник",
};
const date = value => value ? new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const money = value => new Intl.NumberFormat("ru", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value / 100);
let config = {};
let captchaScript;
let widget;

async function api(path, body) {
  const options = { cache: "no-store", signal: AbortSignal.timeout(12000) };
  if (body !== undefined) Object.assign(options, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const request = () => fetch("/api/" + path, options);
  let response;
  try { response = path === "session" && navigator.locks ? await navigator.locks.request("pb-auth-refresh", request) : await request(); }
  catch { throw new Error("Нет связи с сервисом аккаунтов. Повторите попытку."); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Не удалось выполнить действие.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function element(tag, text, attributes = {}) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  return el;
}
function link(text, href, primary = false) {
  return element("a", text, primary ? { href, class: "button" } : { href });
}
function screen(title, intro = "", width = "auth") {
  if (widget !== undefined) window.turnstile?.remove(widget);
  widget = undefined;
  main.replaceChildren();
  main.setAttribute("aria-busy", "false");
  const panel = element("section", "", { class: width });
  panel.append(element("h1", title));
  if (intro) panel.append(element("p", intro, { class: "intro" }));
  main.append(panel);
  document.title = title + " · PhoneBooks";
  return panel;
}
function section(parent, title, className = "section") {
  const area = element("section", "", { class: className });
  area.append(element("h2", title));
  parent.append(area);
  return area;
}
function message(panel) {
  const el = element("p", "", { role: "alert", class: "message" });
  panel.append(el);
  return el;
}
function button(text, run, parent, feedback, secondary = false) {
  const control = element("button", text, { type: "button", class: secondary ? "secondary" : "" });
  parent.append(control);
  control.onclick = async () => {
    control.disabled = true;
    feedback.textContent = "";
    try { await run(); }
    catch (error) { feedback.textContent = error.message; }
    finally { control.disabled = false; }
  };
  return control;
}
function input(form, name, label, attributes) {
  const node = element("label", label);
  const field = element("input", "", { name, ...attributes });
  node.append(field);
  form.append(node);
  return field;
}
function formSubmit(form, buttonText, run, feedback) {
  const submit = element("button", buttonText, { type: "submit" });
  form.append(submit);
  form.onsubmit = async event => {
    event.preventDefault();
    submit.disabled = true;
    feedback.textContent = "";
    try { await run(Object.fromEntries(new FormData(form))); }
    catch (error) {
      if (widget !== undefined) window.turnstile?.reset(widget);
      feedback.textContent = error.message;
    } finally { submit.disabled = false; }
  };
}

const authScreens = {
  login: ["Вход в PhoneBooks", "Управляйте скупкой, продажами и кассой в своём рабочем пространстве.", "Войти"],
  register: ["Создать аккаунт", "Подтвердите почту, чтобы получить 72 часа полного доступа к PhoneBooks Pro.", "Зарегистрироваться"],
  recover: ["Восстановить пароль", "Отправим ссылку для смены пароля на вашу почту.", "Отправить ссылку"],
  resend: ["Подтверждение почты", "Запросите новую ссылку для подтверждения аккаунта.", "Отправить письмо"],
};

function setupCaptcha(place, feedback) {
  if (!config.turnstileSiteKey) return;
  captchaScript ??= new Promise((resolve, reject) => {
    const script = element("script", "", { src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async: "" });
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  captchaScript.then(() => {
    if (place.isConnected) widget = window.turnstile.render(place, { sitekey: config.turnstileSiteKey, language: "ru", "response-field-name": "captcha" });
  }).catch(() => { feedback.textContent = "Проверка безопасности не загрузилась. Обновите страницу."; });
}
function navigation(panel, items) {
  const nav = element("nav");
  for (const [label, href] of items) nav.append(link(label, href));
  panel.append(nav);
}
function authScreen(mode, error = "") {
  const [title, intro, submit] = authScreens[mode];
  const panel = screen(title, intro);
  const form = element("form");
  panel.append(form);
  input(form, "email", "Электронная почта", { type: "email", required: "", autocomplete: "email", maxlength: "254" });
  if (["login", "register"].includes(mode)) input(form, "password", "Пароль", {
    type: "password", required: "", autocomplete: mode === "login" ? "current-password" : "new-password",
    ...(mode === "register" ? { minlength: "12", maxlength: "72" } : {}),
  });
  const captcha = element("div", "", { id: "captcha" });
  form.append(captcha);
  const feedback = message(panel);
  feedback.textContent = error;
  setupCaptcha(captcha, feedback);
  formSubmit(form, submit, async values => {
    const account = await api("auth/" + mode, values);
    if (mode === "login") {
      announceSession();
      history.replaceState(null, "", "/account");
      return accountScreen(account);
    }
    const sent = screen("Проверьте почту", mode === "recover"
      ? "Если этот адрес зарегистрирован, на него придёт ссылка для смены пароля."
      : "Если для этого адреса требуется подтверждение, на него придёт письмо. Проверьте также папку «Спам».");
    navigation(sent, [["Войти", "/account?view=login"], ["Запросить подтверждение", "/account?view=resend"]]);
  }, feedback);
  navigation(panel, mode === "login" ? [
    ["Создать аккаунт", "/account?view=register"], ["Забыли пароль?", "/account?view=recover"], ["Подтвердить почту", "/account?view=resend"],
  ] : [["Ко входу", "/account?view=login"]]);
}
function announceSession() {
  try { localStorage.setItem("pb-account-session-event", crypto.randomUUID()); } catch {}
}

function emailFlow(mode) {
  const recovery = mode === "reset";
  const title = recovery ? "Смена пароля" : "Подтвердить почту";
  const panel = screen(title, recovery ? "Подтвердите запрос, чтобы открыть форму нового пароля." : "Пробный период начнётся после подтверждения почты.");
  const feedback = message(panel);
  if (!emailToken) {
    feedback.textContent = "Откройте актуальную ссылку из письма.";
  } else {
    button(recovery ? "Продолжить" : "Подтвердить почту", async () => {
      await api("auth/verify", { kind: recovery ? "recovery" : "email", token: emailToken });
      if (recovery) return passwordScreen();
      announceSession();
      location.replace("/account?view=welcome");
    }, panel, feedback);
  }
  navigation(panel, [[recovery ? "Запросить новую ссылку" : "Отправить письмо ещё раз", "/account?view=" + (recovery ? "recover" : "resend")]]);
}
function passwordScreen() {
  const panel = screen("Новый пароль", "Используйте минимум 12 символов.");
  const form = element("form");
  panel.append(form);
  for (const [key, label] of [["password", "Пароль"], ["repeat", "Повторите пароль"]]) {
    input(form, key, label, { type: "password", autocomplete: "new-password", required: "", minlength: "12", maxlength: "72" });
  }
  const feedback = message(panel);
  formSubmit(form, "Сохранить пароль", async ({ password, repeat }) => {
    if (password !== repeat) throw new Error("Пароли различаются.");
    await api("auth/password", { password });
    announceSession();
    location.replace("/account?view=login");
  }, feedback);
}

function remaining(end, now) {
  const minutes = Math.max(0, Math.ceil((Date.parse(end) - Date.parse(now)) / 60000));
  if (minutes < 60) return minutes + " мин.";
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return hours + " ч.";
  return Math.floor(hours / 24) + " д. " + hours % 24 + " ч.";
}
function accountScreen(account) {
  const panel = screen("Аккаунт", account.email, "dashboard");
  const state = section(panel, statusNames[account.status]);
  if (account.expiresAt) state.append(element("p", "Доступ до " + date(account.expiresAt) + " · осталось " + remaining(account.expiresAt, account.serverNow)));
  if (account.status === "expired") state.append(element("p", "Можно просматривать бухгалтерию и скачивать резервные копии. Продлите подписку для новых операций и редактирования."));
  if (account.status === "lifetime") state.append(element("p", "Владелец подтвердил для этого аккаунта бессрочный доступ."));
  if (account.status === "pending") state.append(link("Запросить письмо", "/account?view=resend"));
  if (["trial", "active", "expired", "lifetime"].includes(account.status)) {
    const access = element("div", "", { class: "actions" });
    access.append(link(account.status === "expired" ? "Открыть для просмотра" : "Открыть бухгалтерию", "/workspace/", true));
    state.append(access);
  }
  if (["trial", "active", "expired"].includes(account.status)) {
    const plan = section(panel, "PhoneBooks Pro", "callout");
    plan.append(element("p", "399 ₽ на 30 дней. Оплату подтверждает владелец, автоматического списания нет."));
    plan.append(element("p", "Уже покупали PhoneBooks бессрочно? Сообщите владельцу email этого аккаунта для подтверждения."));
    if (config.paymentContact) {
      const url = new URL(config.paymentContact, location.origin);
      if (["https:", "mailto:"].includes(url.protocol)) {
        const actions = element("div", "", { class: "actions" });
        actions.append(link("Связаться для оплаты", url.href, true));
        plan.append(actions);
      }
    } else plan.append(element("p", "Для оплаты напишите владельцу PhoneBooks."));
  }
  const settings = section(panel, "Сессии и безопасность");
  const feedback = message(settings);
  const actions = element("div", "", { class: "actions" });
  settings.append(actions);
  if (account.status !== "blocked") button("Выйти на других устройствах", async () => {
    await api("session", {});
    await api("auth/logout-others", {});
    feedback.textContent = "Другие сессии завершены.";
  }, actions, feedback, true);
  button("Выйти", async () => {
    await api("auth/logout", {});
    announceSession();
    location.replace("/account?view=login");
  }, actions, feedback, true);
  if (account.owner) navigation(panel, [["Панель владельца", "/account?view=admin"]]);
}

async function ownerApi(path, body) {
  try { return await api("admin/" + path, body); }
  catch (error) {
    if (error.status !== 401) throw error;
    await api("session", {});
    return api("admin/" + path, body);
  }
}
function adminScreen() {
  const panel = screen("Пользователи", "", "admin");
  const header = element("div", "", { class: "actions" });
  header.append(link("Мой аккаунт", "/account"));
  panel.append(header);
  const metrics = element("div", "", { class: "metric-grid", "aria-label": "Показатели" });
  const filters = element("form", "", { class: "filters" });
  const search = input(filters, "query", "Почта, источник или партнёр", { type: "search", maxlength: "160" });
  const label = element("label", "Статус");
  const status = element("select", "", { name: "status" });
  for (const [value, text] of [["", "Все"], ...Object.entries(statusNames)]) status.append(element("option", text, { value }));
  label.append(status);
  filters.append(label);
  const listing = element("ul", "", { class: "accounts", "aria-label": "Аккаунты" });
  const paging = element("div", "", { class: "actions" });
  const feedback = message(panel);
  const detail = element("div");
  panel.append(metrics, filters, listing, paging, detail);
  let offset = 0;
  let listRequest = 0;
  let selected;
  let historyOffset = 0;
  async function load() {
    const requestId = ++listRequest;
    const result = await ownerApi("list", { p_query: search.value, p_status: status.value, p_offset: offset });
    if (listRequest !== requestId) return;
    metrics.replaceChildren();
    for (const [label, value] of Object.entries({
      "Активная подписка": result.metrics.active,
      "На пробном периоде": result.metrics.trial,
      "Регистрации за месяц": result.metrics.newThisMonth,
      "Получено за месяц": money(result.metrics.receivedKopecks),
      "Месячная выручка (MRR)": money(result.metrics.monthlyRunRateKopecks),
    })) {
      const metric = element("div", "", { class: "metric" });
      metric.append(element("strong", String(value)), element("span", label));
      metrics.append(metric);
    }
    listing.replaceChildren();
    paging.replaceChildren();
    if (!result.accounts.length) listing.append(element("li", "Аккаунты не найдены."));
    for (const account of result.accounts) {
      const row = element("li");
      const address = element("div");
      address.append(element("strong", account.email), element("p", "Регистрация: " + date(account.created_at), { class: "subtle" }));
      const timing = account.status === "trial" ? "Осталось " + remaining(account.trial_until, result.serverNow) : "Подписка до " + date(account.paid_until);
      const state = element("div");
      state.append(element("p", statusNames[account.status]), element("p", timing, { class: "subtle" }));
      row.append(address, state);
      button("Управлять", async () => {
        selected = account.id;
        historyOffset = 0;
        await showAccount(account);
        detail.querySelector("h2")?.focus();
      }, row, feedback, true);
      listing.append(row);
    }
    if (offset) button("Назад", async () => { offset -= 30; await load(); }, paging, feedback, true);
    if (offset + 30 < result.total) button("Дальше", async () => { offset += 30; await load(); }, paging, feedback, true);
  }

  async function showAccount(account) {
    const history = await ownerApi("history", { p_target: account.id, p_offset: historyOffset });
    if (selected !== account.id) return;
    detail.replaceChildren();
    const card = element("section", "", { class: "record" });
    card.append(element("h2", account.email, { tabindex: "-1" }), element("p", statusNames[account.status]));
    detail.append(card);
    const actionFeedback = message(card);
    async function apply(action, params = {}) {
      const payload = { p_target: account.id, p_action: action, ...params };
      // Keep the same identifier after an uncertain response so a retry cannot add a second payment.
      const key = JSON.stringify(payload);
      let requestId = pendingActions.get(key);
      if (!requestId) pendingActions.set(key, requestId = crypto.randomUUID());
      try { await ownerApi("action", { ...payload, p_request_id: requestId }); }
      catch (error) {
        if (error.status && error.status < 500) pendingActions.delete(key);
        throw error;
      }
      pendingActions.delete(key);
      await load();
      const updated = [...listing.querySelectorAll("li")].some(row => row.querySelector("strong")?.textContent === account.email);
      if (selected === account.id) {
        detail.replaceChildren(element("p", "Действие сохранено.", { role: "status" }));
        if (!updated) selected = undefined;
      }
    }
    const controls = element("div", "", { class: "actions" });
    card.append(controls);
    for (const [action, caption, confirmation] of [
      ["payment", "Подтвердить 399 ₽", "Подтвердить полученную оплату 399 ₽ за 30 дней?"],
      ["lifetime", "Выдать бессрочный доступ", "Подтвердить бессрочный доступ для этого аккаунта?"],
      account.status === "blocked" ? ["unblock", "Разблокировать", "Разблокировать аккаунт?"] : ["block", "Заблокировать", "Заблокировать аккаунт и завершить его сессии?"],
    ]) {
      if (["payment", "lifetime"].includes(action) && ["pending", "blocked", "lifetime"].includes(account.status)) continue;
      button(caption, async () => { if (confirm(confirmation)) await apply(action); }, controls, actionFeedback, true);
    }
    if (!["pending", "blocked", "lifetime"].includes(account.status)) {
      const extend = element("form");
      card.append(extend);
      input(extend, "days", "Продление в днях", { type: "number", min: "1", max: "36500", required: "" });
      formSubmit(extend, "Продлить доступ", values => apply("extend", { p_days: Number(values.days) }), actionFeedback);
    }
    const attribution = element("form");
    card.append(attribution);
    input(attribution, "source", "Источник привлечения", { maxlength: "120", value: account.source });
    input(attribution, "partner", "Партнёр", { maxlength: "120", value: account.partner });
    formSubmit(attribution, "Сохранить источник и партнёра", values => apply("attribution", { p_source: values.source, p_partner: values.partner }), actionFeedback);
    for (const [title, entries] of [
      ["Платежи", history.payments.map(entry => date(entry.paid_at) + " · " + money(entry.amount_kopecks) + " · " + entry.days + " дней")],
      ["Действия владельца", history.actions.map(entry => date(entry.created_at) + " · " + (actionNames[entry.action] || entry.action)
        + " · " + entry.actor_email + historyChanges(entry))],
    ]) {
      const area = section(card, title);
      const list = element("ul");
      for (const entry of entries) list.append(element("li", entry));
      area.append(entries.length ? list : element("p", "Записей пока нет."));
    }
    const pages = element("div", "", { class: "actions" });
    card.append(pages);
    if (historyOffset) button("Новые записи", async () => { historyOffset -= 30; await showAccount(account); }, pages, actionFeedback, true);
    if (history.payments.length === 30 || history.actions.length === 30) button("Старые записи", async () => { historyOffset += 30; await showAccount(account); }, pages, actionFeedback, true);
  }
  const pendingActions = new Map();
  formSubmit(filters, "Найти", async () => { offset = 0; selected = undefined; detail.replaceChildren(); await load(); }, feedback);
  load().catch(error => { feedback.textContent = error.message; });
}

function historyChanges(entry) {
  const { before_values: before, after_values: after } = entry;
  if (entry.action === "attribution") return " · " + [after.source, after.partner].filter(Boolean).join(" / ");
  if (before.paid_until !== after.paid_until) return " · до " + date(after.paid_until);
  return "";
}

window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
window.addEventListener("storage", event => { if (event.key === "pb-account-session-event") location.reload(); });

try {
  config = await api("config");
  if (["confirm", "reset"].includes(view)) {
    emailFlow(view);
  } else if (Object.hasOwn(authScreens, view)) {
    authScreen(view);
  } else {
    try {
      const account = await api("session", {});
      if (view === "resume" && ["trial", "active", "expired", "lifetime"].includes(account.status)) location.replace("/workspace/" + location.hash);
      else if (view === "admin" && account.owner) adminScreen();
      else if (view === "admin") screen("Доступ запрещён", "Панель доступна владельцу PhoneBooks.");
      else accountScreen(account);
    } catch (error) {
      authScreen("login", error.status === 401 ? "" : error.message);
    }
  }
} catch (error) {
  const panel = screen("Сервис недоступен", error.message);
  navigation(panel, [["Повторить", "/account"]]);
}
