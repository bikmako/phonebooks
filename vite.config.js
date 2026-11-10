import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(projectRoot, "dist");
const swTemplatePath = path.resolve(projectRoot, "public/sw.js");

// Прозрачный Service Worker для dev: не кеширует, чистит унаследованные кеши
// старой версии (phonebooks-v8), чтобы HMR и новая сборка не конфликтовали.
const DEV_SERVICE_WORKER = `/* PhoneBooks dev: без кеширования, чтобы не мешать HMR. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('phonebooks-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
`;

/**
 * Исходная готовая сборка лежит в корне репозитория и должна остаться нетронутой,
 * поэтому точка входа для Vite — отдельный файл app.html (копия index.html без
 * ссылок на старые хэшированные ассеты). При сборке он переименовывается в
 * dist/index.html, а '/' в dev-сервере отдаёт app.html.
 */
function entryPointPlugin() {
  return {
    name: "phonebooks-entry-point",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // В dev нельзя отдавать legacy sw.js (кеш phonebooks-v8 со старыми хэшами):
        // старая сборка доступна по /index.html и зарегистрировала бы его на весь scope,
        // что конфликтует с новой версией. Отдаём прозрачный воркер без кеширования.
        if (req.url === "/sw.js" || req.url === "/sw.js?") {
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          res.end(DEV_SERVICE_WORKER);
          return;
        }
        if (req.url === "/" || req.url === "/?") req.url = "/app.html";
        next();
      });
    },
    closeBundle() {
      const built = path.join(distDir, "app.html");
      const target = path.join(distDir, "index.html");
      if (fs.existsSync(built)) fs.renameSync(built, target);
    },
  };
}

/** Список файлов для офлайн-оболочки. В оригинале он был зашит под старые хэши. */
function collectBuiltFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectBuiltFiles(full, base, out);
      continue;
    }
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (rel === "sw.js" || rel === "404.html" || rel === ".nojekyll") continue;
    out.push(`./${rel}`);
  }
  return out;
}

function serviceWorkerPlugin() {
  return {
    name: "phonebooks-service-worker",
    apply: "build",
    closeBundle() {
      const template = fs.readFileSync(swTemplatePath, "utf8");
      const files = collectBuiltFiles(distDir).sort();
      const built = [
        "./",
        "./index.html",
        ...files.filter((f) => f !== "./index.html"),
      ];
      const hash = crypto
        .createHash("sha256")
        .update(built.join("|"))
        .digest("hex")
        .slice(0, 8);
      const cacheName = `phonebooks-v9-${hash}`;
      const sw = template
        .replace(/const CACHE = '[^']*';/, `const CACHE = '${cacheName}';`)
        .replace(/const BUILT = \[[^\]]*\];/, `const BUILT = ${JSON.stringify(built)};`);
      fs.writeFileSync(path.join(distDir, "sw.js"), sw);
      console.log(`[phonebooks] service worker: ${cacheName}, ${built.length} файлов в кеше`);
    },
  };
}

export default defineConfig({
  // Относительные пути: сборка работает и в корне домена, и в /phonebooks/ на GitHub Pages.
  base: "./",
  plugins: [react(), entryPointPlugin(), serviceWorkerPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(projectRoot, "app.html"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Превью проксируется на другой host — разрешаем его явно.
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: true,
  },
});
