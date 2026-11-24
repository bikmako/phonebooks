import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import worker from "../../server/worker.js";
import { accountsDatabase, seedSession, seedUser, signedRpc } from "./accounts-database.js";

const db = await accountsDatabase();
const users = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();
const mailbox = new Map();
const providerPort = 4391;
const origin = "http://localhost:4390";
const json = (data, status = 200) => Response.json(data, { status });
const failure = (error_code, status = 400) => json({ error_code }, status);

async function addUser(address, password, confirmed) {
  const id = await seedUser(db, address, confirmed);
  const user = { id, password, confirmed };
  users.set(address, user);
  return user;
}
await addUser("owner@phonebooks.test", "Owner-testing-123", new Date()).then(user =>
  db.query("insert into phonebooks_private.owners values ($1)", [user.id]));
await addUser("existing@phonebooks.test", "Existing-testing-123", new Date()).then(user =>
  db.query("update phonebooks_private.accounts set lifetime=true where user_id=$1", [user.id]));

function makeTokenPair(claims) {
  const access_token = crypto.randomUUID();
  const refresh_token = crypto.randomUUID();
  accessTokens.set(access_token, claims);
  refreshTokens.set(refresh_token, claims);
  return { access_token, refresh_token, expires_in: 600 };
}

function issueMail(address, kind) {
  const token = crypto.randomUUID().replaceAll("-", "");
  mailbox.set(kind + ":" + address, token);
}

async function providerHandler(request) {
  const url = new URL(request.url);
  const operation = url.pathname.split("/").at(-1);
  const body = await request.json().catch(() => ({}));
  const claims = accessTokens.get(request.headers.get("Authorization")?.slice(7));
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    if (!claims) return failure("invalid_token", 401);
    try { return json(await signedRpc(db, claims, operation.slice("phonebooks_".length), body)); }
    catch (error) { return json({ code: error.code }, Number(error.code?.replace("PT", "")) || 500); }
  }
  if (operation === "signup") {
    if (!users.has(body.email)) await addUser(body.email, body.password, null);
    if (!users.get(body.email).confirmed) issueMail(body.email, "email");
    return json({});
  }
  if (operation === "recover" || operation === "resend") {
    if (users.has(body.email)) issueMail(body.email, operation === "recover" ? "recovery" : "email");
    return json({});
  }
  if (operation === "verify") {
    for (const [address, user] of users) {
      const key = (body.type === "signup" ? "email" : body.type) + ":" + address;
      if (body.token_hash !== mailbox.get(key)) continue;
      mailbox.delete(key);
      if (!user.confirmed) {
        user.confirmed = new Date();
        await db.query("update auth.users set email_confirmed_at=$2 where id=$1", [user.id, user.confirmed]);
      }
      return json(makeTokenPair(await seedSession(db, user.id)));
    }
    return failure("otp_expired");
  }
  if (operation === "token" && url.searchParams.get("grant_type") === "password") {
    const user = users.get(body.email);
    if (!user || user.password !== body.password) return failure("invalid_credentials");
    if (!user.confirmed) return failure("email_not_confirmed");
    return json(makeTokenPair(await seedSession(db, user.id)));
  }
  if (operation === "token" && url.searchParams.get("grant_type") === "refresh_token") {
    const refresh = refreshTokens.get(body.refresh_token);
    if (!refresh || !(await db.query("select from auth.sessions where id=$1", [refresh.session_id])).rows.length) return failure("refresh_token_not_found");
    refreshTokens.delete(body.refresh_token);
    return json(makeTokenPair(refresh));
  }
  if (!claims) return failure("invalid_token", 401);
  if (operation === "logout") {
    const scope = url.searchParams.get("scope");
    if (scope === "local") await db.query("delete from auth.sessions where id=$1", [claims.session_id]);
    else if (scope === "others") await db.query("delete from auth.sessions where user_id=$1 and id<>$2", [claims.sub, claims.session_id]);
    else await db.query("delete from auth.sessions where user_id=$1", [claims.sub]);
    return new Response(null, { status: 204 });
  }
  if (operation === "user") {
    for (const user of users.values()) if (user.id === claims.sub) user.password = body.password;
    return json({});
  }
  return failure("not_found", 404);
}

const assetsRoot = resolve("dist-accounts");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json" };
const environment = {
  SUPABASE_URL: "http://127.0.0.1:" + providerPort,
  SUPABASE_PUBLISHABLE_KEY: "test-provider-key",
  PAYMENT_CONTACT: "https://example.test/phonebooks",
  ASSETS: { async fetch(request) {
    const path = resolve(assetsRoot, "." + new URL(request.url).pathname);
    if (!path.startsWith(assetsRoot + sep)) return new Response(null, { status: 404 });
    try {
      const content = await readFile(path);
      return new Response(request.method === "HEAD" ? null : content, { headers: {
        "Content-Type": types[extname(path)] || "application/octet-stream",
      } });
    } catch { return new Response(null, { status: 404 }); }
  } },
};

async function standHandler(request) {
  const url = new URL(request.url);
  if (url.pathname === "/__test/ready") return json({ ok: true });
  if (url.pathname === "/__test/mail") {
    return json({ token: mailbox.get(url.searchParams.get("kind") + ":" + url.searchParams.get("email")) });
  }
  if (url.pathname === "/__test/expire" && request.method === "POST") {
    const { email, withinSeconds } = await request.json();
    const id = users.get(email)?.id;
    if (!id) return json({}, 404);
    if (withinSeconds) {
      await db.query("update phonebooks_private.accounts set paid_until=now()+($2*interval '1 second'),trial_started_at=now()-interval '73 hours' where user_id=$1", [id, withinSeconds]);
    } else {
      await db.query("update phonebooks_private.accounts set paid_until=now()-interval '1 hour',trial_started_at=now()-interval '73 hours' where user_id=$1", [id]);
    }
    return json({ ok: true });
  }
  return worker.fetch(request, environment);
}

function listen(port, handler) {
  return createServer(async (incoming, outgoing) => {
    try {
      const methodsWithoutBody = ["GET", "HEAD"];
      const request = new Request(new URL(incoming.url, incoming.headers.host === "localhost:" + port ? origin : "http://" + incoming.headers.host), {
        method: incoming.method, headers: incoming.headers,
        ...(methodsWithoutBody.includes(incoming.method) ? {} : { body: Readable.toWeb(incoming), duplex: "half" }),
      });
      const result = await handler(request);
      outgoing.statusCode = result.status;
      for (const [key, value] of result.headers) if (key !== "set-cookie") outgoing.setHeader(key, value);
      const cookies = result.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader("Set-Cookie", cookies);
      if (result.body && incoming.method !== "HEAD") Readable.fromWeb(result.body).pipe(outgoing);
      else outgoing.end();
    } catch (error) {
      console.error(error);
      outgoing.statusCode = 500;
      outgoing.end();
    }
  }).listen(port);
}
listen(providerPort, providerHandler);
listen(4390, standHandler);
console.log("PhoneBooks accounts test stand at " + origin);
