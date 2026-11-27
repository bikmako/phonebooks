import { guessMapping, previewSpreadsheet, spreadsheetTemplate } from '../domain/spreadsheet.js';
import { exportGrid, soloExport } from '../domain/spreadsheetExport.js';
import { readSpreadsheet, writeSpreadsheet } from '../domain/spreadsheetFile.js';
import { applySoloSpreadsheet } from '../domain/spreadsheetSolo.js';

let sheets = [];
self.onmessage = async ({ data }) => {
  const { id, operation, input } = data;
  try {
    let result;
    if (operation === 'read') {
      sheets = readSpreadsheet(input.name, input.bytes, input.encoding);
      result = sheets.map(sheet => ({ name: sheet.name, headers: sheet.rows[0]?.values ?? [],
        mapping: guessMapping(sheet.rows[0]?.values ?? []), rows: Math.max(0, sheet.rows.length - 1) }));
    } else if (operation === 'preview') {
      result = await previewSpreadsheet(sheets[input.sheet], input.mapping, input.options);
    } else if (operation === 'soloApply') result = applySoloSpreadsheet(input.state, input.plan);
    else if (operation === 'template' || operation === 'encode') {
      const tables = input.state ? input.kinds.map(([key, name]) => ({ name, rows: soloExport(input.state, key, input.filter) })) : input.tables;
      result = writeSpreadsheet(input.format, operation === 'template' ? spreadsheetTemplate : exportGrid(tables));
      self.postMessage({ id, result }, [result.buffer]);
      return;
    } else throw new Error('Неизвестное действие таблицы.');
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
