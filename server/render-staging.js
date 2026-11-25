import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { nodeHandler } from "./node-http.js";
import worker from "./worker.js";

const origin = new URL(process.env.RENDER_EXTERNAL_URL);
if (origin.protocol !== "https:") throw new Error("Render staging requires an HTTPS external URL.");

const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!/^sb_publishable_[\w-]+$/.test(key ?? "")) {
  throw new Error("Set SUPABASE_PUBLISHABLE_KEY from phonebooks-staging.");
}

const root = fileURLToPath(new URL("../dist-accounts", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm", ".gz": "application/gzip",
  ".txt": "text/plain; charset=utf-8",
};

const missing = () => new Response(null, { status: 404 });
const assets = { async fetch(request) {
  const path = resolve(root, "." + new URL(request.url).pathname);
  if (!path.startsWith(root + sep)) return missing();
  const file = await stat(path).catch(() => null);
  if (!file?.isFile()) return missing();
  const headers = {
    "Content-Type": types[extname(path)] || "application/octet-stream", "Content-Length": String(file.size),
  };
  return new Response(request.method === "HEAD" ? null : Readable.toWeb(createReadStream(path)), { headers });
} };

// Rate limit the staging instance without trusting IP headers supplied by clients.
let minute = -1;
let attempts = 0;
const environment = {
  SUPABASE_URL: "https://maenpxxckszeaircuqmr.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: key,
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
  PAYMENT_CONTACT: process.env.PAYMENT_CONTACT,
  ASSETS: assets,
  AUTH_RATE: { limit() {
    const current = Math.floor(Date.now() / 60000);
    if (current !== minute) {
      minute = current;
      attempts = 0;
    }
    return { success: ++attempts <= 60 };
  } },
};

createServer(nodeHandler(origin.origin, request => worker.fetch(request, environment)))
  .listen(Number(process.env.PORT ?? 10000), "0.0.0.0");
