import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { nodeHandler } from "./node-http.js";
import worker from "./team-worker.js";

const externalUrl = new URL(process.env.RENDER_EXTERNAL_URL);
if (externalUrl.protocol !== "https:") throw new Error("Team staging requires an HTTPS origin.");

const assetRoot = fileURLToPath(new URL("../dist-team", import.meta.url));
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const assets = {
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    const file = resolve(assetRoot, "." + pathname);
    if (!file.startsWith(assetRoot + sep)) return new Response(null, { status: 404 });
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return new Response(null, { status: 404 });

    const headers = {
      "Content-Type": mimeTypes[extname(file)] || "application/octet-stream",
      "Content-Length": String(info.size),
    };
    const body = request.method === "HEAD" ? null : Readable.toWeb(createReadStream(file));
    return new Response(body, { headers });
  },
};

// A shared limit avoids relying on client-supplied forwarding headers.
let minute;
let attempts = 0;
const authRate = {
  limit() {
    const currentMinute = Math.floor(Date.now() / 60_000);
    if (currentMinute !== minute) {
      minute = currentMinute;
      attempts = 0;
    }
    return { success: ++attempts <= 60 };
  },
};

const env = {
  SUPABASE_URL: "https://maenpxxckszeaircuqmr.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  PHONEBOOKS_SOLO_URL: process.env.PHONEBOOKS_SOLO_URL,
  PHONEBOOKS_IMPORT_KEY: process.env.PHONEBOOKS_IMPORT_KEY,
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
  ASSETS: assets,
  AUTH_RATE: authRate,
};

const server = createServer(nodeHandler(externalUrl.origin, request => worker.fetch(request, env)));
server.listen(Number(process.env.PORT || 10_000), "0.0.0.0");
