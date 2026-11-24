const WORKSPACE = "/workspace/";
const WRITE_STATES = new Set(["trial", "active", "lifetime"]);
const READ_STATES = new Set([...WRITE_STATES, "expired"]);
const AUTH_LIMIT = 16384;
const cookieNames = {
  access: "__Host-pb-access",
  refresh: "__Host-pb-refresh",
  recovery: "__Secure-pb-recovery",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function respond(body, status = 200) {
  return Response.json(body, { status });
}

function noStore(response, cookies) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(response.body, { status: response.status, headers });
}

function redirect(path) {
  return new Response(null, { status: 303, headers: { Location: path } });
}

function readCookie(request, name) {
  const prefix = cookieNames[name] + "=";
  return (request.headers.get("Cookie") || "").split(";").map(value => value.trim())
    .find(value => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function setCookie(cookies, name, value, maxAge) {
  const path = name === "recovery" ? "/api/auth/password" : "/";
  cookies.push(`${cookieNames[name]}=${value}; Path=${path}; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`);
}

function saveSession(cookies, result) {
  if (!result.access_token || !result.refresh_token) throw new HttpError(503, "Не удалось открыть сессию.");
  setCookie(cookies, "access", result.access_token, Math.min(3600, result.expires_in || 600));
  setCookie(cookies, "refresh", result.refresh_token, 30 * 86400);
}

function clearSession(cookies) {
  setCookie(cookies, "access", "", 0);
  setCookie(cookies, "refresh", "", 0);
  setCookie(cookies, "recovery", "", 0);
}

async function provider(env, path, { method = "POST", body, token } = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new HttpError(503, "Сервис аккаунтов пока не настроен.");
  }
  const url = new URL(path, env.SUPABASE_URL);
  const headers = { apikey: env.SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  let response;
  try {
    response = await fetch(url, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(7000), redirect: "error",
    });
  } catch {
    throw new HttpError(503, "Сервис аккаунтов временно недоступен.");
  }
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function auth(env, operation, options) {
  return provider(env, "/auth/v1/" + operation, options);
}

function authError(result, fallback) {
  const { status } = result.response;
  if (status >= 500) return new HttpError(503, "Сервис аккаунтов временно недоступен.");
  if (status === 429) return new HttpError(429, "Слишком много попыток. Повторите позже.");
  if (result.data.error_code === "email_not_confirmed") {
    return new HttpError(403, "Сначала подтвердите почту.");
  }
  if (result.data.error_code === "captcha_failed") {
    return new HttpError(400, "Проверка безопасности не прошла. Попробуйте ещё раз.");
  }
  return new HttpError(400, fallback);
}

async function rpc(env, token, name, body = {}) {
  if (!token) throw new HttpError(401, "Войдите в аккаунт.");
  const { response, data } = await provider(env, "/rest/v1/rpc/phonebooks_" + name, { body, token });
  if (response.ok && data) return data;
  const status = response.status;
  if (status === 401 || (response.ok && !data)) throw new HttpError(401, "Сессия завершена. Войдите снова.");
  if (status === 403) throw new HttpError(403, "Доступ запрещён.");
  if (status === 404 && data.code === "PT404") throw new HttpError(404, "Аккаунт не найден.");
  if (status === 409) throw new HttpError(409, "Действие недоступно в текущем состоянии аккаунта.");
  if (status === 400) throw new HttpError(400, "Проверьте параметры запроса.");
  throw new HttpError(503, "Не удалось проверить доступ.");
}

async function refreshSession(env, request, cookies) {
  const refresh = readCookie(request, "refresh");
  if (!refresh) throw new HttpError(401, "Войдите в аккаунт.");
  const result = await auth(env, "token?grant_type=refresh_token", { body: { refresh_token: refresh } });
  if (!result.response.ok) {
    if (result.response.status >= 500 || result.response.status === 429) {
      throw authError(result, "Не удалось обновить сессию.");
    }
    clearSession(cookies);
    throw new HttpError(401, "Сессия завершена. Войдите снова.");
  }
  const account = await rpc(env, result.data.access_token, "access");
  if (account.status === "blocked") {
    clearSession(cookies);
    return account;
  }
  saveSession(cookies, result.data);
  return account;
}

async function accountSession(env, request, cookies) {
  try {
    return await rpc(env, readCookie(request, "access"), "access");
  } catch (error) {
    if (error.status !== 401) throw error;
    return refreshSession(env, request, cookies);
  }
}

async function readBody(request) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Необходим JSON.");
  }
  if (!request.body || Number(request.headers.get("Content-Length")) > AUTH_LIMIT) {
    throw new HttpError(413, "Запрос слишком большой.");
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let input = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > AUTH_LIMIT) {
      await reader.cancel();
      throw new HttpError(413, "Запрос слишком большой.");
    }
    input += decoder.decode(value, { stream: true });
  }
  try {
    const data = JSON.parse(input + decoder.decode());
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch {}
  throw new HttpError(400, "Некорректный запрос.");
}

function password(body, minimum = 1) {
  if (typeof body.password !== "string" || body.password.length < minimum || new TextEncoder().encode(body.password).length > 72) {
    throw new HttpError(400, minimum > 1 ? "Пароль должен содержать от 12 символов и занимать не более 72 байт." : "Проверьте пароль.");
  }
  return body.password;
}

function email(body) {
  const value = typeof body.email === "string" ? body.email.trim() : "";
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new HttpError(400, "Укажите действующий email.");
  }
  return value;
}

async function rateLimit(request, env) {
  if (!env.AUTH_RATE) return;
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (!(await env.AUTH_RATE.limit({ key: ip })).success) {
    throw new HttpError(429, "Слишком много попыток. Повторите позже.");
  }
}

async function authRoute(path, body, env, request, cookies) {
  const token = readCookie(request, "access");
  if (path === "logout" || path === "logout-others") {
    const scope = path === "logout" ? "local" : "others";
    const session = token || (scope === "local" ? await tokenForLogout(env, request) : "");
    if (session) {
      const result = await auth(env, "logout?scope=" + scope, { token: session });
      if (!result.response.ok && (scope === "others" || ![401, 403, 404].includes(result.response.status))) {
        throw authError(result, "Не удалось завершить сессию.");
      }
    } else if (scope === "others") {
      throw new HttpError(401, "Войдите в аккаунт снова.");
    }
    if (scope === "local") clearSession(cookies);
    return respond({ ok: true });
  }

  await rateLimit(request, env);
  if (path === "verify") {
    const hash = body.token;
    if (typeof hash !== "string" || !/^[\w-]{16,200}$/.test(hash) || !["email", "recovery"].includes(body.kind)) {
      throw new HttpError(400, "Ссылка недействительна.");
    }
    const result = await auth(env, "verify", { body: { type: body.kind === "email" ? "signup" : "recovery", token_hash: hash } });
    if (!result.response.ok) throw authError(result, "Ссылка недействительна или уже использована.");
    if (body.kind === "recovery") {
      if (!result.data.access_token) throw new HttpError(400, "Ссылка недействительна.");
      setCookie(cookies, "recovery", result.data.access_token, 600);
    } else {
      await finishLogin(env, cookies, result.data);
    }
    return respond({ ok: true });
  }
  if (path === "password") {
    const recovery = readCookie(request, "recovery");
    if (!recovery) throw new HttpError(401, "Откройте свежую ссылку восстановления.");
    const result = await auth(env, "user", { method: "PUT", token: recovery, body: { password: password(body, 12) } });
    if (!result.response.ok) throw authError(result, "Пароль не изменён. Попробуйте другой пароль или запросите новую ссылку.");
    const logout = await auth(env, "logout?scope=global", { token: recovery });
    clearSession(cookies);
    if (!logout.response.ok && ![401, 403, 404].includes(logout.response.status)) {
      throw new HttpError(503, "Пароль обновлён. Завершение других сессий не подтверждено. Войдите и проверьте настройки аккаунта.");
    }
    return respond({ ok: true });
  }

  const captcha = typeof body.captcha === "string" ? body.captcha : "";
  if (env.TURNSTILE_SITE_KEY && !captcha) throw new HttpError(400, "Пройдите проверку безопасности.");
  const challenge = captcha ? { gotrue_meta_security: { captcha_token: captcha } } : {};
  const address = email(body);
  if (path === "login") {
    const result = await auth(env, "token?grant_type=password", { body: { email: address, password: password(body), ...challenge } });
    if (!result.response.ok) throw authError(result, "Неверный email или пароль.");
    return respond(await finishLogin(env, cookies, result.data));
  }
  const operations = {
    register: ["signup", () => ({ password: password(body, 12) })],
    recover: ["recover", () => ({})],
    resend: ["resend", () => ({ type: "signup" })],
  };
  if (!Object.hasOwn(operations, path)) throw new HttpError(404, "Страница не найдена.");
  const [operation, extra] = operations[path];
  const result = await auth(env, operation, { body: { email: address, ...extra(), ...challenge } });
  if (!result.response.ok) {
    // Keep account existence out of public registration and recovery responses.
    if (result.response.status >= 500 || result.response.status === 429 || result.data.error_code === "captcha_failed") {
      throw authError(result, "Не удалось отправить письмо.");
    }
  } else if (path === "register" && result.data.access_token) {
    throw new HttpError(503, "Сервис настроен без обязательного подтверждения почты.");
  }
  return respond({ ok: true });
}

async function tokenForLogout(env, request) {
  const refresh = readCookie(request, "refresh");
  if (!refresh) return "";
  const result = await auth(env, "token?grant_type=refresh_token", { body: { refresh_token: refresh } });
  if (result.response.ok) return result.data.access_token;
  if (result.response.status >= 500 || result.response.status === 429) throw authError(result, "Не удалось завершить сессию.");
  return "";
}

async function finishLogin(env, cookies, result) {
  const account = await rpc(env, result.access_token, "access");
  if (account.status === "blocked" || account.status === "pending") {
    await auth(env, "logout?scope=local", { token: result.access_token }).catch(() => {});
    clearSession(cookies);
    throw new HttpError(403, account.status === "blocked" ? "Аккаунт заблокирован." : "Сначала подтвердите почту.");
  }
  saveSession(cookies, result);
  return account;
}

async function api(path, request, env, cookies, origin) {
  if (path === "/api/config" && request.method === "GET") {
    return respond({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || "", paymentContact: env.PAYMENT_CONTACT || "" });
  }
  if (path === "/api/me" && request.method === "GET") {
    return respond(await rpc(env, readCookie(request, "access"), "access"));
  }
  if (request.method !== "POST") throw new HttpError(405, "Метод не поддерживается.");
  if (request.headers.get("Origin") !== origin) throw new HttpError(403, "Запрос с другого сайта отклонён.");
  const body = await readBody(request);
  if (path === "/api/session") return respond(await accountSession(env, request, cookies));
  if (path.startsWith("/api/auth/")) return authRoute(path.slice(10), body, env, request, cookies);
  const admin = { "/api/admin/list": "admin_list", "/api/admin/history": "admin_history", "/api/admin/action": "admin_action" };
  if (Object.hasOwn(admin, path)) return respond(await rpc(env, readCookie(request, "access"), admin[path], body));
  throw new HttpError(404, "Страница не найдена.");
}

function staticFile(request, env, path) {
  return env.ASSETS.fetch(new Request(new URL(path, request.url), { method: request.method }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cookies = [];
    let response;
    try {
      if (path.startsWith("/api/")) {
        response = await api(path, request, env, cookies, url.origin);
      } else if (request.method !== "GET" && request.method !== "HEAD") {
        throw new HttpError(405, "Метод не поддерживается.");
      } else if (path === "/" || path === "/workspace") {
        response = redirect(path === "/" ? "/account" : WORKSPACE);
      } else if (path === "/account") {
        const page = await staticFile(request, env, "/account/index.html");
        const headers = new Headers(page.headers);
        headers.set("Content-Security-Policy", "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
        response = new Response(page.body, { status: page.status, headers });
      } else if (["/account/ui.js", "/account/ui.css", "/account/manrope-cyrillic.woff2", "/account/manrope-latin.woff2"].includes(path)) {
        response = await staticFile(request, env, path);
      } else if (path.startsWith(WORKSPACE)) {
        const account = await rpc(env, readCookie(request, "access"), "access");
        if (!READ_STATES.has(account.status)) throw new HttpError(403, "Рабочее пространство недоступно.");
        response = await staticFile(request, env, path === WORKSPACE ? "/workspace/index.html" : path);
        if ([WORKSPACE, "/workspace/index.html"].includes(path)) {
          const headers = new Headers(response.headers);
          headers.set("Content-Security-Policy", "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
          response = new Response(response.body, { status: response.status, headers });
        }
      } else {
        throw new HttpError(404, "Страница не найдена.");
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      const message = error instanceof HttpError ? error.message : "Сервис временно недоступен.";
      response = (status === 401 || status === 403) && [WORKSPACE, "/workspace/index.html"].includes(path)
        ? redirect(status === 401 ? "/account?view=resume" : "/account") : respond({ error: message }, status);
    }
    return noStore(response, cookies);
  },
};
