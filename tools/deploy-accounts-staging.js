import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!/^sb_publishable_[\w-]+$/.test(key ?? "")) {
  throw new Error("Set SUPABASE_PUBLISHABLE_KEY from the phonebooks-staging Supabase project.");
}

const options = process.argv.slice(2);
if (options.length > 1 || (options.length === 1 && options[0] !== "--dry-run")) {
  throw new Error("Usage: npm run deploy:staging -- [--dry-run]");
}

const root = fileURLToPath(new URL("../", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const result = spawnSync(process.execPath, [wrangler, "deploy", "--config", "wrangler.phonebooks.toml",
  "--keep-vars", "--var", `SUPABASE_PUBLISHABLE_KEY:${key}`, ...options], { cwd: root, stdio: "inherit" });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
