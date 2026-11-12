import { BinaryBitmap, HybridBinarizer, RGBLuminanceSource, MultiFormatReader, DecodeHintType, BarcodeFormat, NotFoundException, ChecksumException, FormatException } from '@zxing/library';
import { extractImeis } from '../utils/imei.js';

function decode(pixels) {
  const reader = new MultiFormatReader();
  reader.setHints(new Map([
    [DecodeHintType.TRY_HARDER, true],
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417]],
  ]));
  const gray = new Uint8ClampedArray(pixels.width * pixels.height);
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4;
    gray[i] = (pixels.data[offset] + 2 * pixels.data[offset + 1] + pixels.data[offset + 2]) / 4;
  }
  const rotated = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) rotated[x * pixels.height + pixels.height - y - 1] = gray[y * pixels.width + x];
  }
  const found = new Set();
  try {
    for (const [data, width, height] of [[gray, pixels.width, pixels.height], [rotated, pixels.height, pixels.width]]) {
      const source = new RGBLuminanceSource(data, width, height);
      // Overlapping bands find separate labels on dual-SIM boxes. Rotate for vertical barcodes.
      const regions = [
        [0, 0, width, height],
        ...[0, .25, .5].map(y => [0, Math.floor(height * y), width, Math.ceil(height / 2)]),
        ...[0, .25, .5].map(x => [Math.floor(width * x), 0, Math.ceil(width / 2), height]),
      ];
      for (const [x, y, regionWidth, regionHeight] of regions) {
        try {
          const cropped = source.crop(x, y, Math.min(regionWidth, width - x), Math.min(regionHeight, height - y));
          const result = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(cropped)));
          for (const imei of extractImeis(result.getText())) found.add(imei);
        } catch (error) {
          // instanceof survives minification; constructor.name does not.
          if (!(error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException)) throw error;
        }
      }
    }
    return [...found];
  } finally { reader.reset(); }
}

self.onmessage = event => {
  try { self.postMessage({ candidates: decode(event.data) }); }
  catch { self.postMessage({ error: true }); }
};
