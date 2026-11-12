import tesseract from 'tesseract.js/package.json';
import core from 'tesseract.js-core/package.json';
import eng from '@tesseract.js-data/eng/package.json';
import project from '../../package.json';

export const ocrAssets = `scanner-assets/tesseract-${tesseract.version}-core-${core.version}-eng-${eng.version}-accurate-v2/`;
export const barcodeAssets = `scanner-assets/zxing-${project.dependencies['zxing-wasm']}/`;
