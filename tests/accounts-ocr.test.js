import { test } from "node:test";
import assert from "node:assert/strict";
import { OCR_MODEL_PATH, OCR_PART_BYTES, OCR_PARTS_ROOT, ocrAsset } from "../server/ocr-assets.js";

const modelPath = "/workspace/scanner-assets/tesseract-6.0.1-accurate-v2/eng.traineddata.gz";
const manifestPath = OCR_PARTS_ROOT + "/model.json";

test("authorized OCR model preserves all bytes when the hosting limit requires parts", async () => {
  assert.equal(OCR_MODEL_PATH.test(modelPath), true);
  assert.equal(OCR_MODEL_PATH.test(OCR_PARTS_ROOT + "/0.part"), false);
  const first = Buffer.alloc(OCR_PART_BYTES, 17);
  const second = Buffer.from([1, 2, 3]);
  const requests = [];
  const assets = async path => {
    requests.push(path);
    if (path === manifestPath) return Response.json({ path: modelPath, bytes: first.length + second.length });
    if (path === OCR_PARTS_ROOT + "/0.part") return new Response(first);
    if (path === OCR_PARTS_ROOT + "/1.part") return new Response(second);
    throw new Error("unexpected asset");
  };
  const head = await ocrAsset(modelPath, "HEAD", assets);
  assert.equal(head.headers.get("Content-Length"), String(first.length + second.length));
  assert.deepEqual(requests, [manifestPath]);
  assert.equal(head.body, null);

  const result = await ocrAsset(modelPath, "GET", assets);
  assert.equal(result.headers.get("Content-Type"), "application/gzip");
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), Buffer.concat([first, second]));
  assert.equal((await ocrAsset(modelPath.replace("6.0.1", "5.0.0"), "GET", assets)).status, 404);
});

test("missing OCR part fails before returning a successful model download", async () => {
  const response = await ocrAsset(modelPath, "GET", async path => path === manifestPath
    ? Response.json({ path: modelPath, bytes: OCR_PART_BYTES + 1 })
    : new Response(null, { status: 404 }));
  assert.equal(response.status, 503);
});
