import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import worker from "../../server/team-worker.js";
import { nodeHandler } from "../../server/node-http.js";
import { asUser, seedSession, seedUser, teamDatabase, testImportKey } from "./team-database.js";

const db = await teamDatabase();
const users = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();
const mailbox = new Map();
const providerPort = 4399;
const origin = "https://127.0.0.1:4398";
const root = await mkdtemp(resolve(tmpdir(), "phonebooks-team-stand-"));
const key = resolve(root, "key.pem");
const cert = resolve(root, "cert.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
  "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  "-keyout", key, "-out", cert], { stdio: "ignore" });
const tls = { key: await readFile(key), cert: await readFile(cert) };
const json = (data, status = 200) => Response.json(data, { status });
const failure = (error_code, status = 400) => json({ error_code }, status);

async function addUser(address, password, confirmed) {
  const id = await seedUser(db, address, Boolean(confirmed));
  const user = { id, password, confirmed };
  users.set(address, user);
  return user;
}

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
    try { return json(await signedRpc(claims, operation, body)); }
    catch (error) { return json({ code: error.code }, /^PT\d{3}$/.test(error.code) ? Number(error.code.slice(2)) : 500); }
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
      if (!mailbox.has(key) || body.token_hash !== mailbox.get(key)) continue;
      mailbox.delete(key);
      if (body.type === "signup" && !user.confirmed) {
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

const rpcArgs = {
  phonebooks_team_account: [],
  phonebooks_team_overview: ["p_preferred"],
  phonebooks_team_create_workspace: ["p_name", "p_request_id"],
  phonebooks_team_create_invitation: ["p_workspace_id", "p_email", "p_role"],
  phonebooks_team_accept_invitation: ["p_invitation_id"],
  phonebooks_team_revoke_invitation: ["p_workspace_id", "p_invitation_id"],
  phonebooks_team_cloud_command: ["p_workspace", "p_actor", "p_request", "p_command"],
  phonebooks_team_cloud_feed: ["p_workspace", "p_actor", "p_cursor"],
  phonebooks_team_cloud_page: ["p_workspace", "p_actor", "p_position"],
  phonebooks_team_solo_import: ["p_workspace", "p_actor", "p_key", "p_fingerprint", "p_material"],
  phonebooks_team_transfer: ["p_workspace", "p_actor", "p_action", "p_input"],
  phonebooks_team_members: ["p_workspace", "p_actor"],
  phonebooks_team_manage: ["p_workspace", "p_actor", "p_action", "p_input"],
  phonebooks_team_audit: ["p_workspace", "p_actor", "p_member", "p_kind", "p_from", "p_to", "p_offset"],
  phonebooks_team_trade_context: ["p_workspace", "p_actor", "p_product"],
  phonebooks_team_search_history: ["p_workspace", "p_actor", "p_product", "p_kind", "p_from", "p_to", "p_offset", "p_query"],
  phonebooks_team_operation_history: ["p_workspace", "p_actor", "p_product", "p_kind", "p_from", "p_to", "p_offset"],
  phonebooks_team_stats: ["p_workspace", "p_actor", "p_member", "p_from", "p_to"],
};
async function signedRpc(claims, operation, body) {
  if (!Object.hasOwn(rpcArgs, operation)) throw new Error("Unexpected RPC");
  const args = rpcArgs[operation].map(key => body[key]);
  const parameters = args.map((_, index) => "$" + (index + 1)).join(", ");
  const call = "public." + operation + "(" + parameters + ")";
  if (operation === "phonebooks_team_create_workspace") return asUser(db, claims, "select * from " + call, args);
  const [row] = await asUser(db, claims, "select " + call + " as value", args);
  return row.value;
}

const assetsRoot = resolve("dist-team");
const assetTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2" };
const environment = {
  SUPABASE_URL: "http://127.0.0.1:" + providerPort,
  SUPABASE_PUBLISHABLE_KEY: "test-provider-key",
  PHONEBOOKS_IMPORT_KEY: await testImportKey(db),
  PHONEBOOKS_SOLO_URL: "http://localhost:4397/#/settings",
  ASSETS: {
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      const path = resolve(assetsRoot, "." + pathname);
      if (!path.startsWith(assetsRoot + sep)) return new Response(null, { status: 404 });
      try {
        return new Response(request.method === "HEAD" ? null : await readFile(path), {
          headers: { "Content-Type": assetTypes[extname(path)] || "application/octet-stream" },
        });
      } catch { return new Response(null, { status: 404 }); }
    },
  },
};

async function standHandler(request) {
  const url = new URL(request.url);
  if (url.pathname === "/__test/ready") return json({ ok: true });
  if (url.pathname === "/__test/mail") {
    return json({ token: mailbox.get(url.searchParams.get("kind") + ":" + url.searchParams.get("email")) });
  }
  return worker.fetch(request, environment);
}

const providerServer = createServer(nodeHandler(environment.SUPABASE_URL, providerHandler)).listen(providerPort, "127.0.0.1");
const teamServer = createHttpsServer(tls, nodeHandler(origin, standHandler)).listen(4398, "127.0.0.1");
console.log("PhoneBooks Team test stand at " + origin);

async function cleanup() {
  providerServer.closeAllConnections();
  teamServer.closeAllConnections();
  providerServer.close();
  teamServer.close();
  await db.close();
  await rm(root, { recursive: true, force: true });
}
process.on("SIGINT", () => void cleanup());
process.on("SIGTERM", () => void cleanup());
