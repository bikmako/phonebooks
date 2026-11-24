import { cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";

await rm("dist-accounts", { recursive: true, force: true });
const build = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--mode", "accounts"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);
await mkdir("dist-accounts/account", { recursive: true });
await cp("server/account-public", "dist-accounts/account", { recursive: true });
for (const subset of ["latin", "cyrillic"]) {
  const file = "manrope-" + subset + ".woff2";
  await cp("src/fonts/" + file, "dist-accounts/account/" + file);
}
