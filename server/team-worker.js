import { crossModeUrl } from '../src/utils/modeUrl.js';
import { prepareSoloTransfer, TRANSFER_LIMIT } from '../src/domain/soloTransfer.js';

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
      signal: AbortSignal.timeout(7000), redirect: "manual",
    });
  } catch {
    throw new HttpError(503, "Сервис аккаунтов временно недоступен.");
  }
  if (response.status >= 300 && response.status < 400) {
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
  const { response, data } = await provider(env, "/rest/v1/rpc/phonebooks_team_" + name, { body, token });
  if (response.ok) return data;
  const status = response.status;
  if (status === 401) throw new HttpError(401, "Сессия завершена. Войдите снова.");
  if (status === 403) throw new HttpError(403, "Доступ запрещён.");
  if (status === 404 && data.code === "PT404") throw new HttpError(404, "Приглашение не найдено.");
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
  await rpc(env, result.data.access_token, "account");
  saveSession(cookies, result.data);
  return result.data.access_token;
}

async function withSession(env, request, cookies, operation) {
  const token = readCookie(request, "access");
  if (token) {
    try {
      return await operation(token);
    } catch (error) {
      if (error.status !== 401) throw error;
    }
  }
  return operation(await refreshSession(env, request, cookies));
}

async function readBody(request, limit = AUTH_LIMIT) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Необходим JSON.");
  }
  if (!request.body || Number(request.headers.get("Content-Length")) > limit) {
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
    if (size > limit) {
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
  if (path === "logout" || path === "logout-others") {
    const scope = path === "logout" ? "local" : "others";
    if (scope === "others") {
      await withSession(env, request, cookies, async token => {
        await rpc(env, token, "account");
        const result = await auth(env, "logout?scope=others", { token });
        if (!result.response.ok) throw authError(result, "Не удалось завершить другие сессии.");
      });
      return respond({ ok: true });
    }
    const token = readCookie(request, "access");
    const session = token || await tokenForLogout(env, request);
    if (session) {
      let result = await auth(env, "logout?scope=" + scope, { token: session });
      if (scope === "local" && result.response.status === 401 && token && readCookie(request, "refresh")) {
        const renewed = await tokenForLogout(env, request);
        if (renewed) result = await auth(env, "logout?scope=local", { token: renewed });
      }
      if (!result.response.ok && ![401, 403, 404].includes(result.response.status)) {
        throw authError(result, "Не удалось завершить сессию.");
      }
    }
    clearSession(cookies);
    return respond({ ok: true });
  }

  await rateLimit(request, env);
  if (path === "verify") {
    const hash = body.token;
    if (typeof hash !== "string" || !/^[\w-]{16,200}$/.test(hash) || !["email", "recovery"].includes(body.kind)) {
      throw new HttpError(400, "Ссылка недействительна.");
    }
    // The provider's generic "email" type also accepts recovery codes.
    const type = body.kind === "email" ? "signup" : "recovery";
    const result = await auth(env, "verify", { body: { type, token_hash: hash } });
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
  const account = await rpc(env, result.access_token, "account");
  setCookie(cookies, "recovery", "", 0);
  saveSession(cookies, result);
  return account;
}

const workspaceRoutes = {
  "/api/workspaces": ["overview", ["p_preferred"]],
  "/api/workspaces/create": ["create_workspace", ["p_name", "p_request_id"]],
  "/api/invitations/create": ["create_invitation", ["p_workspace_id", "p_email", "p_role"]],
  "/api/invitations/accept": ["accept_invitation", ["p_invitation_id"]],
  "/api/invitations/revoke": ["revoke_invitation", ["p_workspace_id", "p_invitation_id"]],
};

function cloudRoute(path, body) {
  const { p_workspace, p_actor, p_cursor, p_request, p_command } = body;
  if (typeof p_workspace !== "string" || typeof p_actor !== "string") throw new HttpError(400, "Проверьте параметры пространства.");
  if (path === "/api/cloud/feed" && (p_cursor === null || (typeof p_cursor === "string" && /^\d{1,19}$/.test(p_cursor)))) {
    return ["cloud_feed", { p_workspace, p_actor, p_cursor }];
  }
  if (path === "/api/cloud/command" && typeof p_request === "string" && p_command && typeof p_command === "object" && !Array.isArray(p_command)) {
    return ["cloud_command", { p_workspace, p_actor, p_request, p_command }];
  }
  throw new HttpError(400, "Проверьте параметры операции.");
}

function teamRoute(path, body) {
  const { p_workspace, p_actor, p_action, p_input, p_member, p_kind, p_from, p_to, p_offset } = body;
  if (typeof p_workspace !== "string" || typeof p_actor !== "string") throw new HttpError(400, "Проверьте параметры пространства.");
  const scope = { p_workspace, p_actor };
  if (path === "/api/team/members") return ["members", scope];
  if (path === "/api/team/manage" && typeof p_action === "string" && p_input && typeof p_input === "object" && !Array.isArray(p_input)) {
    return ["manage", { ...scope, p_action, p_input }];
  }
  if ([p_member, p_from, p_to].every(value => value === null || typeof value === "string")) {
    const range = { ...scope, p_member, p_from, p_to };
    if (path === "/api/team/stats") return ["stats", range];
    if (path === "/api/team/audit" && (p_kind === null || typeof p_kind === "string") && Number.isSafeInteger(p_offset)) {
      return ["audit", { ...range, p_kind, p_offset }];
    }
  }
  throw new HttpError(400, "Проверьте параметры команды.");
}

async function importSolo(env, token, body) {
  if (typeof body.p_workspace !== "string" || typeof body.p_actor !== "string") {
    throw new HttpError(400, "Проверьте параметры пространства.");
  }
  if (!env.PHONEBOOKS_IMPORT_KEY || env.PHONEBOOKS_IMPORT_KEY.length < 32) {
    throw new HttpError(503, "Перенос ещё не настроен на этом стенде.");
  }
  const account = await rpc(env, token, "account");
  if (account.id !== body.p_actor) throw new HttpError(403, "Аккаунт изменился.");
  let material;
  try { material = prepareSoloTransfer(body.source); }
  catch (error) { throw new HttpError(400, error.message); }
  const bytes = new TextEncoder().encode(JSON.stringify(material));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const fingerprint = Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
  return rpc(env, token, "solo_import", {
    p_workspace: body.p_workspace, p_actor: body.p_actor, p_key: env.PHONEBOOKS_IMPORT_KEY,
    p_fingerprint: fingerprint, p_material: material,
  });
}

async function api(path, request, env, cookies, origin) {
  if (path === "/api/config" && request.method === "GET") {
    return respond({ soloUrl: crossModeUrl(env.PHONEBOOKS_SOLO_URL, origin), turnstileSiteKey: env.TURNSTILE_SITE_KEY || "" });
  }
  if (request.method !== "POST") throw new HttpError(405, "Метод не поддерживается.");
  if (request.headers.get("Origin") !== origin) throw new HttpError(403, "Запрос с другого сайта отклонён.");
  const body = await readBody(request, path === "/api/cloud/import-solo" ? TRANSFER_LIMIT : AUTH_LIMIT);
  if (path === "/api/session") {
    return respond(await withSession(env, request, cookies, token => rpc(env, token, "account")));
  }
  if (path.startsWith("/api/auth/")) return authRoute(path.slice(10), body, env, request, cookies);
  if (path.startsWith("/api/team/")) {
    const [operation, parameters] = teamRoute(path, body);
    return respond(await withSession(env, request, cookies, token => rpc(env, token, operation, parameters)));
  }
  if (path === "/api/cloud/import-solo") {
    return respond(await withSession(env, request, cookies, token => importSolo(env, token, body)));
  }
  if (path === "/api/cloud/feed" || path === "/api/cloud/command") {
    const [operation, parameters] = cloudRoute(path, body);
    return respond(await withSession(env, request, cookies, token => rpc(env, token, operation, parameters)));
  }
  if (Object.hasOwn(workspaceRoutes, path)) {
    const [operation, fields] = workspaceRoutes[path];
    if (fields.some(field => typeof body[field] !== "string" && !(field === "p_preferred" && body[field] === null))) {
      throw new HttpError(400, "Проверьте параметры запроса.");
    }
    const argumentsForRpc = Object.fromEntries(fields.map(field => [field, body[field]]));
    return respond(await withSession(env, request, cookies, token => rpc(env, token, operation, argumentsForRpc)));
  }
  throw new HttpError(404, "Страница не найдена.");
}

const csp = "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cookies = [];
    let response;
    try {
      if (url.pathname.startsWith("/api/")) {
        response = await api(url.pathname, request, env, cookies, url.origin);
      } else if (request.method !== "GET" && request.method !== "HEAD") {
        throw new HttpError(405, "Метод не поддерживается.");
      } else if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname.startsWith("/assets/")) {
        const assetPath = url.pathname === "/" ? "/index.html" : url.pathname;
        response = await env.ASSETS.fetch(new Request(new URL(assetPath, url.origin), { method: request.method }));
        const headers = new Headers(response.headers);
        headers.set("Content-Security-Policy", csp);
        response = new Response(response.body, { status: response.status, headers });
      } else {
        throw new HttpError(404, "Страница не найдена.");
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      response = respond({ error: error instanceof HttpError ? error.message : "Сервис временно недоступен." }, status);
    }
    return noStore(response, cookies);
  },
};
