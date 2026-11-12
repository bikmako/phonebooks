import { prepareZXingModule, readBarcodesFromImageData } from 'zxing-wasm/reader';
import { extractImeis } from '../utils/imei.js';

let ready;
self.onmessage = async ({ data }) => {
  try {
    ready ??= prepareZXingModule({ overrides: { locateFile: () => data.wasmPath }, fireImmediately: true });
    await ready;
    const results = await readBarcodesFromImageData(data.pixels, {
      formats: ['Code128', 'Code39', 'ITF', 'QRCode', 'DataMatrix', 'PDF417'],
      tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true,
      maxNumberOfSymbols: 16,
    });
    self.postMessage({ candidates: [...new Set(results.flatMap(result => extractImeis(result.text)))] });
  } catch {
    ready = undefined;
    self.postMessage({ error: true });
  }
};
