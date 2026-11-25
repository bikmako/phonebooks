export const OCR_MODEL_PATH = /^\/workspace\/scanner-assets\/tesseract-[\w.-]+\/eng\.traineddata\.gz$/;
export const OCR_PARTS_ROOT = "/_sealed/ocr";
export const OCR_PART_BYTES = 4 * 1024 * 1024;

const missing = () => new Response(null, { status: 404 });

export async function ocrAsset(path, method, asset) {
  const manifest = await asset(OCR_PARTS_ROOT + "/model.json");
  if (!manifest.ok) return missing();
  const model = await manifest.json();
  if (model.path !== path || !Number.isSafeInteger(model.bytes) || model.bytes < 1 || model.bytes > 32 * 1024 * 1024) {
    return missing();
  }
  const headers = {
    "Content-Type": "application/gzip",
    "Content-Length": String(model.bytes),
  };
  if (method === "HEAD") return new Response(null, { headers });

  const count = Math.ceil(model.bytes / OCR_PART_BYTES);
  const parts = await Promise.all(Array.from({ length: count }, (_, index) => asset(OCR_PARTS_ROOT + "/" + index + ".part")));
  if (parts.some(part => !part.ok || !part.body)) return new Response(null, { status: 503 });
  let index = 0;
  let reader = parts[index].body.getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      while (reader) {
        const chunk = await reader.read();
        if (!chunk.done) {
          controller.enqueue(chunk.value);
          return;
        }
        reader.releaseLock();
        reader = parts[++index]?.body.getReader();
      }
      controller.close();
    },
    async cancel(reason) {
      if (reader) await reader.cancel(reason);
      await Promise.allSettled(parts.slice(index + 1).map(part => part.body.cancel(reason)));
    },
  });
  return new Response(stream, { headers });
}
