import { createWorker, PSM } from 'tesseract.js';
import { imeisFromOcr } from '../utils/imei.js';
import tesseractPackage from 'tesseract.js/package.json';
import corePackage from 'tesseract.js-core/package.json';
import engPackage from '@tesseract.js-data/eng/package.json';

const assetPath = `scanner-assets/tesseract-${tesseractPackage.version}-core-${corePackage.version}-eng-${engPackage.version}/`;

export function createRecognizer(onProgress) {
  let pendingWorker;
  let worker;
  let disposed = false;
  let barcodeWorker;
  let rejectBarcode;
  function scanBarcodes(canvas) {
    barcodeWorker ??= new Worker(new URL('./barcode-worker.js', import.meta.url), { type: 'module' });
    const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      rejectBarcode = reject;
      barcodeWorker.onmessage = event => {
        rejectBarcode = undefined;
        event.data.error ? reject(new Error('Не удалось обработать штрихкод. Попробуйте другое фото.')) : resolve(event.data.candidates);
      };
      barcodeWorker.onerror = () => { rejectBarcode = undefined; reject(new Error('Не удалось загрузить сканер штрихкодов. Проверьте загрузку ресурсов и попробуйте снова.')); };
      barcodeWorker.postMessage(pixels, [pixels.data.buffer]);
    });
  }
  const check = () => { if (disposed) throw new DOMException('Сканирование закрыто', 'AbortError'); };
  return {
    async recognize(canvas) {
      check();
      onProgress('Проверяем штрихкоды…');
      const barcodes = await scanBarcodes(canvas);
      check();
      let ocr = [];
      let warning = '';
      try {
        if (!pendingWorker) {
          const base = new URL(assetPath, document.baseURI).href;
          onProgress('Загружаем локальный модуль OCR…');
          pendingWorker = createWorker('eng', 1, {
            workerPath: `${base}worker.min.js`, corePath: base, langPath: base,
            workerBlobURL: false, cacheMethod: 'none',
            logger: message => {
              if (!disposed && message.status === 'recognizing text') onProgress(`Распознаём текст… ${Math.round(message.progress * 100)}%`);
            },
            errorHandler: () => {},
          }).then(async result => {
            worker = result;
            if (disposed) { await worker.terminate(); check(); }
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
            return worker;
          });
        }
        const activeWorker = await pendingWorker;
        check();
        const { data } = await activeWorker.recognize(canvas, {}, { blocks: true, text: true });
        ocr = imeisFromOcr(data);
      } catch (error) {
        check();
        pendingWorker = undefined;
        if (worker) { await worker.terminate(); worker = undefined; }
        warning = 'Не удалось распознать текст. Попробуйте более чёткое фото; при первом запуске дождитесь загрузки ресурсов с подключением к сети.';
      }
      check();
      return { candidates: [...new Set([...barcodes, ...ocr])], warning };
    },
    dispose() {
      disposed = true;
      barcodeWorker?.terminate();
      rejectBarcode?.(new DOMException('Сканирование закрыто', 'AbortError'));
      if (worker) void worker.terminate();
      // A worker still initializing is terminated by the continuation above.
    },
  };
}
