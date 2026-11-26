import { createWorker, PSM } from 'tesseract.js';
import { extractImeis, ocrLines, ocrReadings, reliableOcr } from '../utils/imei.js';
import { alignText, crispText, cropCanvas, rotateCanvas } from './image.js';
import { ocrAssets, barcodeAssets } from './assets.js';

export function createRecognizer(onProgress = () => {}) {
  let pendingWorker, worker, barcodeWorker, rejectBarcode;
  let disposed = false;
  const check = () => { if (disposed) throw new DOMException('Закрыто', 'AbortError'); };
  async function getWorker() {
    if (!pendingWorker) {
      const base = new URL(ocrAssets, document.baseURI).href;
      onProgress('Подготовка сканера…');
      pendingWorker = createWorker('eng', 1, {
        workerPath: `${base}worker.min.js`, corePath: base, langPath: base,
        workerBlobURL: false, cacheMethod: 'none', errorHandler: () => {},
      }).then(async result => {
        worker = result;
        if (disposed) { await worker.terminate(); check(); }
        await worker.setParameters({ preserve_interword_spaces: '1' });
        return worker;
      });
    }
    return pendingWorker;
  }
  async function scanBarcodes(canvas) {
    check();
    barcodeWorker ??= new Worker(new URL('./barcode-worker.js', import.meta.url), { type: 'module' });
    const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      rejectBarcode = reject;
      barcodeWorker.onmessage = ({ data }) => {
        rejectBarcode = undefined;
        data.error ? reject(new Error('Не удалось загрузить сканер штрихкодов.')) : resolve(data.candidates);
      };
      barcodeWorker.onerror = () => { rejectBarcode = undefined; reject(new Error('Не удалось загрузить сканер штрихкодов.')); };
      barcodeWorker.postMessage({ pixels, wasmPath: new URL(`${barcodeAssets}zxing_reader.wasm`, document.baseURI).href }, [pixels.data.buffer]);
    });
  }
  async function readText(canvas, { live = false } = {}) {
    check();
    const active = await getWorker();
    check();
    onProgress('Ищем IMEI…');
    const readings = [];
    let pass = 0;
    async function read(image, psm, digits = false, corroborated) {
      check();
      await active.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: digits ? '0123456789 -' : '' });
      const { data } = await active.recognize(image, {}, { blocks: true, text: true });
      check();
      readings.push(...ocrReadings(data).filter(value => !corroborated || corroborated.includes(value.imei)).map(value => ({ ...value, pass })));
      pass++;
      return data;
    }
    async function readRows(image, data, recover) {
      // Re-read actual text rows at a useful glyph height instead of dropping an
      // entire IMEI just because one small word received a low OCR confidence.
      const lines = ocrLines(data).filter(line => {
        const text = (line.words ?? []).map(word => word.text).join(' ');
        const digits = text.replace(/\D/g, '').length;
        return digits >= 10 && digits <= 24 && !/\b(?:EID|ICCID|MEID|IMEISV|S\/?N|SERIAL)\b/i.test(text);
      }).slice(0, live ? 3 : 10);
      for (const line of lines) {
        const words = line.words.filter(word => /\d{3}/.test(word.text) || /^[\d\s-]+$/.test(word.text));
        const boxes = words.map(word => word.bbox).filter(Boolean);
        if (!boxes.length) continue;
        const box = { x0: Math.min(...boxes.map(b => b.x0)) - 12, y0: Math.min(...boxes.map(b => b.y0)) - 12,
          x1: Math.max(...boxes.map(b => b.x1)) + 12, y1: Math.max(...boxes.map(b => b.y1)) + 12 };
        await read(cropCanvas(image, box), PSM.SINGLE_LINE);
        if (!reliableOcr(readings).length || !live) {
          const enhanced = cropCanvas(image, box, true);
          await read(enhanced, PSM.SINGLE_LINE, true);
          const corroborated = recover ? extractImeis(line.words.map(word => word.text).join(' ')) : [];
          if (corroborated.length && !reliableOcr(readings).length) {
            const sharp = crispText(cropCanvas(image, box, true));
            for (const angle of [0, -.04, .04]) {
              await read(alignText(enhanced, angle), PSM.SINGLE_LINE, true, corroborated);
              if (reliableOcr(readings).length) break;
              await read(alignText(sharp, angle), PSM.SINGLE_LINE, true, corroborated);
              if (reliableOcr(readings).length) break;
            }
          }
        }
      }
    }
    async function inspect(image, recover = false) {
      await readRows(image, await read(image, PSM.SPARSE_TEXT), recover);
      if (!reliableOcr(readings).length || !live) {
        const enhanced = cropCanvas(image, { x0: 0, y0: 0, x1: image.width, y1: image.height }, true);
        const data = await read(enhanced, PSM.AUTO);
        if (recover && !reliableOcr(readings).length && ocrReadings(data).length) await readRows(enhanced, data, true);
      }
    }
    await inspect(canvas, !live);
    if (!live && !reliableOcr(readings).length) {
      let rotated = canvas;
      for (let i = 0; i < 3 && !reliableOcr(readings).length; i++) { rotated = rotateCanvas(rotated); await inspect(rotated); }
    }
    return reliableOcr(readings);
  }
  return {
    scanBarcodes,
    readText,
    async recognize(canvas, options) {
      let barcodes = [], warning = '';
      try { barcodes = await scanBarcodes(canvas); }
      catch { check(); warning = 'Не удалось загрузить сканер штрихкодов.'; }
      let text = [];
      try { text = await readText(canvas, options); }
      catch {
        check();
        pendingWorker = undefined;
        if (worker) { await worker.terminate(); worker = undefined; }
        warning = 'Не удалось загрузить распознавание текста. Проверьте соединение.';
      }
      check();
      return { candidates: [...new Set([...barcodes, ...text])], barcodes, warning };
    },
    dispose() {
      disposed = true;
      barcodeWorker?.terminate();
      rejectBarcode?.(new DOMException('Закрыто', 'AbortError'));
      if (worker) void worker.terminate();
    },
  };
}
