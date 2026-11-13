import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

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
function entryPointPlugin(demo, distDir) {
  return {
    name: "phonebooks-entry-point",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (demo && (req.url?.split("?")[0] === "/index.html")) req.url = "/app.html";
        // В dev нельзя отдавать legacy sw.js (кеш phonebooks-v8 со старыми хэшами):
        // старая сборка доступна по /index.html и зарегистрировала бы его на весь scope,
        // что конфликтует с новой версией. Отдаём прозрачный воркер без кеширования.
        if (["/sw.js", "/sw-demo.js"].includes(req.url?.split("?")[0])) {
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          res.end(demo ? DEV_SERVICE_WORKER.replace("k.startsWith('phonebooks-')", "k.startsWith('phonebooks-demo-')") : DEV_SERVICE_WORKER);
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

function serviceWorkerPlugin(demo, distDir) {
  return {
    name: "phonebooks-service-worker",
    apply: "build",
    closeBundle() {
      let template = fs.readFileSync(swTemplatePath, "utf8");
      if (demo) {
        fs.rmSync(path.join(distDir, "sw.js"), { force: true });
        template = template.replace("k.startsWith('phonebooks-')", "k.startsWith('phonebooks-demo-')");
        template = template.replaceAll('caches.match(', 'matchDemo(');
        template = "const matchDemo = (...args) => caches.open(CACHE).then(cache => cache.match(...args));\n" + template;
        const manifestPath = path.join(distDir, "manifest.webmanifest");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        Object.assign(manifest, { name: "PhoneBooks ДЕМО", short_name: "PhoneBooks ДЕМО", description: "Тестовые данные · для ознакомления", id: "./?app=phonebooks-demo" });
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      }
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
      const cacheName = `${demo ? "phonebooks-demo" : "phonebooks"}-v9-${hash}`;
      const sw = template
        .replace(/const CACHE = '[^']*';/, `const CACHE = '${cacheName}';`)
        .replace(/const BUILT = \[[^\]]*\];/, `const BUILT = ${JSON.stringify(built)};`);
      fs.writeFileSync(path.join(distDir, demo ? "sw-demo.js" : "sw.js"), sw);
      console.log(`[phonebooks] service worker: ${cacheName}, ${built.length} файлов в кеше`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  const env = loadEnv(mode, projectRoot, "VITE_DEMO_");
  const distDir = path.resolve(projectRoot, demo ? "dist-demo" : "dist");
  return {
    resolve: {
      alias: demo ? [] : [{ find: "../demo/seed.js", replacement: path.resolve(projectRoot, "src/demo/paidSeed.js") }],
    },
    // Относительные пути: сборка работает и в корне домена, и в /phonebooks/ на GitHub Pages.
    base: "./",
    plugins: [{
      name: "phonebooks-build-mode",
      enforce: "pre",
      transform(source, id) {
        if (id !== path.resolve(projectRoot, "src/config.js")) return;
        // Freeze distribution mode at compile time; URL/storage cannot enable it.
        // The source module keeps safe defaults for non-Vite Node consumers.
        return source
          .replace(/^export const IS_DEMO = .*;$/m, `export const IS_DEMO = ${demo};`)
          .replace(/^export const SELLER_CONTACT = .*;$/m, `export const SELLER_CONTACT = sellerContact(${JSON.stringify(demo ? env.VITE_DEMO_SELLER_CONTACT || "" : "")});`);
      },
    }, react(), entryPointPlugin(demo, distDir), serviceWorkerPlugin(demo, distDir), ...(demo ? [{
      name: "phonebooks-demo-html",
      transformIndexHtml(html) { return html.replace(/<title>.*?<\/title>/, "<title>PhoneBooks ДЕМО</title>").replace('content="PhoneBooks"', 'content="PhoneBooks ДЕМО"').replace(/<meta name="description"[^>]*>/, '<meta name="description" content="PhoneBooks ДЕМО · Тестовые данные · для ознакомления" />').replace(/<script>\s*\/\/ Просим браузер[^]*?<\/script>/, ""); },
    }] : [])],
    build: {
      outDir: demo ? "dist-demo" : "dist",
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
  };
});
