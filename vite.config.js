import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { buildServiceWorker } from "./tools/build-service-worker.js";
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

function serviceWorkerPlugin() {
  return {
    name: "phonebooks-service-worker",
    apply: "build",
    closeBundle() {
      const template = fs.readFileSync(swTemplatePath, "utf8");
      const result = buildServiceWorker(distDir, template);
      console.log(`[phonebooks] service worker: ${result.version}, ${result.files} файлов в кеше`);
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
