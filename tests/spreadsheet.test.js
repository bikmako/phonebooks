import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { guessMapping, previewSpreadsheet, spreadsheetTemplate } from '../src/domain/spreadsheet.js';
import { exportGrid, soloExport } from '../src/domain/spreadsheetExport.js';
import { readSpreadsheet, writeSpreadsheet } from '../src/domain/spreadsheetFile.js';
import { applySoloSpreadsheet } from '../src/domain/spreadsheetSolo.js';
import { createInitialState } from '../src/storage/initialState.js';
import { validateState } from '../src/storage/backupFormat.js';
import { getAccountBalance, getStats } from '../src/utils/calculations.js';
import { getPeriod } from '../src/utils/format.js';
import { projectInventory } from '../src/domain/inventory.js';

const settings = { defaultType: 'opening', accountId: 'ac_default_cash', today: '2026-11-27' };
async function load(entries, format = 'xlsx', extra) {
  const [sheet] = readSpreadsheet('test.' + format, writeSpreadsheet(format, entries));
  return previewSpreadsheet(sheet, guessMapping(sheet.rows[0].values), { ...settings, ...extra });
}
test('XLSX and CSV import retain historical finances without moving money or historical units', async () => {
  for (const file of ['xlsx','csv']) {
    const entries = [...spreadsheetTemplate,
      ['Текущая закупка', 'Тестовый товар', 'Пользовательская категория', 'SKU', '', 'Количественный', 3, 100, '', '', '27.11.2026', '1', 'Красный'],
      ['Исторический расход', 'Аренда', '', '', '', '', '', 20, '', '', '2026-01-03', '2'],
      ['Текущий расход', 'Доставка', '', '', '', '', '', 10, '', '', '2026-01-03', '3']];
    const before = createInitialState();
    before.accounts[0].openingBalance = 500;
    const plan = await load(entries, file);
    assert.deepEqual(plan.errors, []);
    assert.deepEqual([plan.openingUnits, plan.cashMinor, plan.historicalMinor], [4,-11000,140000]);
    const state = applySoloSpreadsheet(before, plan);
    assert.equal(getAccountBalance(state, settings.accountId), 390);
    const stats = getStats(state, getPeriod('all', settings.today));
    assert.deepEqual([stats.revenue, stats.cogs, stats.opex, stats.netProfit], [1400,400,30,970]);
    assert.equal(projectInventory(state).products.reduce((total, row) => total + row.quantity, 0), 4);
    assert.equal(projectInventory(state).products.find(row => row.name === 'Учебный чехол').quantity, 0);
    assert.deepEqual(validateState(state), state);
    assert.throws(() => applySoloSpreadsheet(state, plan), /уже выполнен/);
    assert.equal(getAccountBalance(before, settings.accountId), 500);
    assert.equal(soloExport(state, 'sale', { from: '2026-01-02', to: '2026-01-02' })[0].cashMinor, 0);
    assert.deepEqual(soloExport(state, 'sale', { from: '2026-02-01' }), []);
  }
});

test('CSV handles tabs, semicolons, commas, quotes, UTF-16 and Windows-1251 with physical line numbers', () => {
  for (const delimiter of [';', ',', '\t', '|']) {
    assert.deepEqual(readSpreadsheet('fixture.csv', strToU8(`Имя${delimiter}Число\n\n"a\nb"${delimiter}10`))[0].rows[1],
      { number: 3, values: ['a\nb','10'] });
  }
  const utf16 = Uint8Array.from([255,254,...[...'Имя;1'].flatMap(char => [char.charCodeAt(0) & 255,char.charCodeAt(0) >> 8])]);
  assert.equal(readSpreadsheet('fixture.csv', utf16)[0].rows[0].values[0], 'Имя');
  assert.equal(readSpreadsheet('fixture.csv', Uint8Array.from([0xc8,0xec,0xff,59,49]))[0].rows[0].values[0], 'Имя');
});

test('reads an independent XLSX with two worksheets, shared strings and 1904 dates, then maps unfamiliar columns', async () => {
  const file = await readFile(new URL('./fixtures/spreadsheet-multi.xlsx', import.meta.url));
  const sheets = readSpreadsheet('demo.xlsx', file);
  assert.deepEqual(sheets.map(row => row.name), ['Инструкция','Закупки']);
  const mapped = ['name','quantity','amount','date','','sku'];
  const plan = await previewSpreadsheet(sheets[1], mapped, { ...settings, defaultType: 'purchase' });
  assert.deepEqual(plan.rows.map(row => [row.name,row.quantity,row.date,row.amountMinor]), [['Тестовый станок',3,'2025-02-05',10051]]);
  assert.equal(plan.errors[0].row,3);
  assert.match(plan.errors[0].message,/Формулы/);
});

test('formula cells fail preview, neutralized downloads contain no executable spreadsheet formula', async () => {
  const original = unzipSync(writeSpreadsheet('xlsx', spreadsheetTemplate));
  const sheetName = 'xl/worksheets/sheet1.xml';
  original[sheetName] = strToU8(new TextDecoder().decode(original[sheetName]).replace('<v>12000</v>', '<f>1+1</f><v>12000</v>'));
  const [sheet] = readSpreadsheet('formula.xlsx', zipSync(original));
  assert.match((await previewSpreadsheet(sheet, guessMapping(sheet.rows[0].values), settings)).errors[0].message, /Формулы/);
  const data = exportGrid([{ name: 'Склад', rows: [{ name: '=HYPERLINK("x")' }] }]);
  assert.match(new TextDecoder().decode(writeSpreadsheet('csv', data)), /'=HYPERLINK/);
  assert.equal(readSpreadsheet('text.xlsx', writeSpreadsheet('xlsx', data))[0].rows[1].values[0], '=HYPERLINK("x")');
  assert.throws(() => readSpreadsheet('large.xlsx', new Uint8Array(8 * 1024 * 1024 + 1)), /8 МиБ/);
  const unit = spreadsheetTemplate[1];
  const duplicate = await load([spreadsheetTemplate[0], unit, unit], 'csv');
  assert.equal(duplicate.errors[0].row, 3);
  assert.match(duplicate.errors[0].message, /Дубликат/);
});

test('100, 1000 and 10000 rows round-trip and validate without losing records', async t => {
  for (const size of [100,1000,10000]) {
    const input = [['Товар','Себестоимость, ₽','Количество','Номер записи'],
      ...Array.from({ length: size }, (_, i) => ['Товар ' + i, 17, 2, 'SKU-' + i])];
    const start = performance.now();
    const file = writeSpreadsheet('xlsx', input);
    const [sheet] = readSpreadsheet('load.xlsx', file);
    const parsed = performance.now();
    const plan = await previewSpreadsheet(sheet, guessMapping(sheet.rows[0].values), settings);
    const previewed = performance.now();
    const state = applySoloSpreadsheet(createInitialState(), plan);
    const done = performance.now();
    assert.deepEqual(plan.errors, []);
    assert.equal(state.warehouse.length, size);
    t.diagnostic(JSON.stringify({ size, bytes: file.length, xlsxMs: Math.round(parsed-start),
      previewMs: Math.round(previewed-parsed), soloMs: Math.round(done-previewed) }));
  }
});
