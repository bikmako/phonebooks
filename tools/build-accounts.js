import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { OCR_MODEL_PATH, OCR_PART_BYTES, OCR_PARTS_ROOT } from "../server/ocr-assets.js";

await rm("dist-accounts", { recursive: true, force: true });
const build = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--mode", "accounts"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);
await mkdir("dist-accounts/account", { recursive: true });
await cp("server/account-public", "dist-accounts/account", { recursive: true });
for (const subset of ["latin", "cyrillic"]) {
  const file = "manrope-" + subset + ".woff2";
  await cp("src/fonts/" + file, "dist-accounts/account/" + file);
}


const scannerAssets = "dist-accounts/workspace/scanner-assets";
const models = (await readdir(scannerAssets))
  .map(directory => "/workspace/scanner-assets/" + directory + "/eng.traineddata.gz")
  .filter(path => OCR_MODEL_PATH.test(path));
if (models.length !== 1) throw new Error("The accounts build must contain exactly one English OCR model");
const [model] = models;
const original = "dist-accounts" + model;
const bytes = await readFile(original);
const sealed = "dist-accounts" + OCR_PARTS_ROOT;
await mkdir(sealed, { recursive: true });
await writeFile(sealed + "/model.json", JSON.stringify({ path: model, bytes: bytes.length }));
for (let offset = 0, index = 0; offset < bytes.length; offset += OCR_PART_BYTES, index++) {
  await writeFile(sealed + "/" + index + ".part", bytes.subarray(offset, offset + OCR_PART_BYTES));
}
await rm(original);
