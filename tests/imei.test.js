import test from 'node:test';
import assert from 'node:assert/strict';
import { extractImeis, imeisFromOcr, isValidImei } from '../src/utils/imei.js';
import { cameraError, stopStream } from '../src/scanner/media.js';

const first = '490154203237518';
const second = '356938035643809';
test('known IMEIs pass Luhn; malformed, incomplete and placeholder values fail', () => {
  for (const value of [first, second, '352099001761481']) assert.equal(isValidImei(value), true, value);
  for (const value of ['', null, 490154203237518, '49015420323751', '4901542032375180', '490154203237519', '4901542O3237518', '000000000000000', '111111111111111', ' 490154203237518']) assert.equal(isValidImei(value), false, String(value));
});
test('screen, label and barcode payloads: select multiple numbers and deduplicate', () => {
  assert.deepEqual(extractImeis(`*#06#\nIMEI1: ${first}\nIMEI2: ${second}\nIMEI ${first}`), [first, second]);
  assert.deepEqual(extractImeis(`${first} ${second}`), [first, second]);
  assert.deepEqual(extractImeis(`IMEI: 49015420 323751 8\nIMEI: 35693803-564380-9`), [first, second]);
  assert.deepEqual(extractImeis(`{"imei":"${first}"}`), [first]);
});
test('never cut longer IDs, repair OCR letters or checksum, or join unrelated lines', () => {
  for (const value of [`${first}0`, `1${first}`, `SN${first}`, `${first}ABC`, 'EID: 8904903200000000004901542032375180', '49015420323751', '490154203237519', '4901542O3237518', '49015420\n3237518', '49015420 32375189', '49015420 ? 3237518']) assert.deepEqual(extractImeis(value), [], value);
  for (const label of ['EID', 'ICCID', 'MEID', 'IMEISV', 'S/N', 'SN', 'Serial']) assert.deepEqual(extractImeis(`${label}: ${first}`), []);
});
const data = words => ({ blocks: [{ paragraphs: [{ lines: [{ words }] }] }] });
test('OCR requires high confidence for each numeric word, not average page confidence', () => {
  assert.deepEqual(imeisFromOcr(data([{ text: 'IMEI:', confidence: 20 }, { text: first, confidence: 92 }])), [first]);
  assert.deepEqual(imeisFromOcr(data([{ text: first, confidence: 79 }])), []);
  assert.deepEqual(imeisFromOcr(data([{ text: first }])), []);
  assert.deepEqual(imeisFromOcr({ text: first, confidence: 99 }), []);
  assert.deepEqual(imeisFromOcr(data([{ text: '49015420', confidence: 98 }, { text: '323751', confidence: 50 }, { text: '8', confidence: 99 }])), []);
});
test('all camera tracks stop; unavailable streams are safe; camera errors are actionable', () => {
  let count = 0;
  stopStream({ getTracks: () => [{ stop: () => count++ }, { stop: () => count++ }] });
  stopStream(null);
  assert.equal(count, 2);
  for (const [name, text] of [['NotAllowedError', 'запрещён'], ['NotFoundError', 'не найдена'], ['NotReadableError', 'занята'], ['Unknown', 'Не удалось']]) assert.ok(cameraError({ name }).includes(text));
});
