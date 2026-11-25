import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = "746d80a214a272316ca8fc0ec40a12b582e1930e"; // Reviewed isolated demo in PR #6.
const target = new URL(process.argv[2]);
if (target.protocol !== "https:" || target.username || target.password || target.hostname === "phonebooks-demo.pages.dev") {
  throw new Error("Укажите отдельный HTTPS-адрес страницы регистрации.");
}
target.pathname = "/account";
target.search = "?view=register";
target.hash = "";
const scratch = await mkdtemp(join(tmpdir(), "phonebooks-demo-"));

function run(program, args, cwd = process.cwd()) {
  const result = spawnSync(program, args, { cwd, stdio: "inherit", env: {
    ...process.env, VITE_DEMO_SELLER_CONTACT: target.href,
  } });
  if (result.status !== 0) throw new Error(program + " завершился с ошибкой");
}
try {
  const archive = join(scratch, "source.tar");
  run("git", ["archive", "-o", archive, base]);
  run("tar", ["-xf", archive], scratch);
  const banner = join(scratch, "src/components/DemoBanner.jsx");
  await writeFile(banner, (await readFile(banner, "utf8")).replace(
    'rel="noopener noreferrer">Купить полную версию</a>',
    'rel="noopener noreferrer">Создать аккаунт</a>',
  ));
  run("npm", ["ci"], scratch);
  run("npm", ["run", "build:demo"], scratch);
  await rm("dist-demo", { recursive: true, force: true });
  await cp(join(scratch, "dist-demo"), "dist-demo", { recursive: true });
} finally {
  await rm(scratch, { recursive: true, force: true });
}
