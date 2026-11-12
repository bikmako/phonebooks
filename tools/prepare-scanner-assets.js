import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Include dependency versions in URLs so service-worker caches never mix OCR runtimes.
const version = name => JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'))).version;
// Only this ignored, generated directory is replaced; never retain outdated runtimes.
rmSync(resolve(root, 'public/scanner-assets'), { recursive: true, force: true });
const dir = resolve(root, `public/scanner-assets/tesseract-${version('tesseract.js')}-core-${version('tesseract.js-core')}-eng-${version('@tesseract.js-data/eng')}-accurate-v2`);
mkdirSync(dir, { recursive: true });
const files = {
  'tesseract.js/dist/worker.min.js': 'worker.min.js',
  'tesseract.js/dist/worker.min.js.LICENSE.txt': 'worker.LICENSE.txt',
  'tesseract.js-core/LICENSE': 'core.LICENSE',
  '@tesseract.js-data/eng/4.0.0/eng.traineddata.gz': 'eng.traineddata.gz',
};
for (const suffix of ['lstm', 'simd-lstm']) {
  // These files embed WASM as base64; separate .wasm files would duplicate ~5.6 MB.
  files[`tesseract.js-core/tesseract-core-${suffix}.wasm.js`] = `tesseract-core-${suffix}.wasm.js`;
}
for (const [source, target] of Object.entries(files)) copyFileSync(resolve(root, 'node_modules', source), resolve(dir, target));
const barcodeDir = resolve(root, `public/scanner-assets/zxing-${version('zxing-wasm')}`);
mkdirSync(barcodeDir, { recursive: true });
copyFileSync(resolve(root, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'), resolve(barcodeDir, 'zxing_reader.wasm'));
copyFileSync(resolve(root, 'node_modules/zxing-wasm/LICENSE'), resolve(barcodeDir, 'LICENSE'));
