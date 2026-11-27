import { strToU8, Unzip, UnzipInflate, zipSync } from 'fflate';
import { SaxesParser } from 'saxes';

export const sheetLimits = { bytes: 8 * 1024 * 1024, inflated: 32 * 1024 * 1024, rows: 10000, columns: 80, cells: 320000, text: 4000 };
const invalid = message => { throw new Error(message); };
const formula = Object.freeze({ formula: true });

function decodeCsv(bytes, encoding) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  if (['windows-1251','windows-1252','utf-8','utf-16le','utf-16be'].includes(encoding))
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1251').decode(bytes); }
}

function csvRows(text, separator, limit = sheetLimits.rows + 1) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false, number = 1, start = 1;
  function pushField() {
    if (field.length > sheetLimits.text || row.length >= sheetLimits.columns) invalid('В таблице слишком длинная ячейка или слишком много столбцов.');
    row.push(field);
    field = '';
    closed = false;
  }
  function pushRow() {
    pushField();
    if (row.some(cell => cell.trim())) rows.push({ number: start, values: row });
    row = [];
    if (rows.length > limit) invalid('Файл содержит больше 10 000 строк данных.');
  }
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character !== '"') field += character;
      else if (text[index + 1] === '"') { field += '"'; index++; }
      else { quoted = false; closed = true; }
      if (character === '\n' || character === '\r' && text[index + 1] !== '\n') number++;
    } else if (character === separator) pushField();
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index++;
      pushRow();
      start = ++number;
    } else if (character === '"' && !field && !closed) quoted = true;
    else {
      if (character === '"' || closed) invalid('Некорректные кавычки CSV около строки ' + number + '.');
      field += character;
    }
    if (field.length > sheetLimits.text) invalid('В таблице слишком длинная ячейка.');
  }
  if (quoted) invalid('В CSV не закрыта кавычка.');
  if (row.length || field || closed) pushRow();
  return rows;
}

function parseCsv(bytes, encoding) {
  const text = decodeCsv(bytes, encoding);
  if (text.includes('\0')) invalid('CSV содержит двоичные данные.');
  const directive = /^sep=([;,\t|])\r?\n/i.exec(text);
  if (directive) return csvRows(text.slice(directive[0].length), directive[1]).map(row => ({ ...row, number: row.number + 1 }));
  // Read the first logical row, keeping delimiters inside escaped fields out of detection.
  const header = text.match(/^(?:"(?:[^"]|"")*"|[^"\r\n])*/)?.[0] ?? '';
  const counts = header.replace(/"(?:[^"]|"")*"/g, '').match(/[;,\t|]/g) ?? [];
  const separators = [';', ',', '\t', '|'];
  const best = separators.sort((left, right) => counts.filter(value => value === right).length - counts.filter(value => value === left).length)[0];
  return csvRows(text, best);
}

function unpackWorkbook(bytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = new Map();
  let inflated = 0, entries = 0;
  const unzip = new Unzip(file => {
    if (++entries > 256 || (file.originalSize ?? 0) > sheetLimits.inflated) invalid('Книга Excel слишком велика после распаковки.');
    if (!/^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(file.name)) return;
    if (files.has(file.name)) invalid('Повторяющаяся часть книги Excel.');
    const chunks = [];
    files.set(file.name, chunks);
    file.ondata = (error, part, final) => {
      if (error) throw error;
      inflated += part.length;
      if (inflated > sheetLimits.inflated) invalid('Книга Excel слишком велика после распаковки.');
      chunks.push(part);
      if (final) files.set(file.name, chunks.map((chunk, i) => decoder.decode(chunk, { stream: i < chunks.length - 1 })).join(''));
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let start = 0; start < bytes.length; start += 4096) unzip.push(bytes.subarray(start, start + 4096), start + 4096 >= bytes.length);
  return files;
}

function xml(data, handlers) {
  if (typeof data !== 'string') invalid('В книге Excel отсутствует нужная часть.');
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', () => invalid('Объявления DTD в таблицах не поддерживаются.'));
  parser.on('error', () => invalid('Повреждён XML книги Excel.'));
  for (const [event, listener] of Object.entries(handlers)) if (listener) parser.on(event, listener);
  parser.write(data).close();
}

const local = name => name.split(':').at(-1);
function workbookStrings(data) {
  const strings = [];
  if (data === undefined) return strings;
  let value = '', text = false, phonetic = false;
  xml(data, {
    opentag(tag) {
      if (local(tag.name) === 'si') value = '';
      if (local(tag.name) === 'rPh') phonetic = true;
      if (local(tag.name) === 't' && !phonetic) text = true;
    },
    text(part) { if (text) value += part; },
    closetag(tag) {
      if (local(tag.name) === 't') text = false;
      if (local(tag.name) === 'rPh') phonetic = false;
      if (local(tag.name) === 'si') {
        if (value.length > sheetLimits.text || strings.length >= sheetLimits.cells) invalid('Книга Excel содержит слишком много текста.');
        strings.push(value);
      }
    },
  });
  return strings;
}

function sheetRows(data, strings, budget, date1904) {
  const rows = [];
  let row, cell, collecting = false, number = 0;
  xml(data, {
    opentag({ name, attributes }) {
      switch (local(name)) {
        case 'row': number = Number(attributes.r ?? number + 1); row = []; break;
        case 'c': {
          if (!row) invalid('В книге Excel нарушен порядок строк.');
          const letters = /^([A-Z]+)\d+$/.exec(attributes.r ?? '')?.[1];
          const column = letters ? [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1 : row.length;
          if (column >= sheetLimits.columns || ++budget.cells > sheetLimits.cells) invalid('В книге Excel слишком много ячеек.');
          cell = { column, type: attributes.t, value: '', formula: false };
          break;
        }
        case 'f': if (cell) cell.formula = true; break;
        case 'v':
        case 't': if (cell) collecting = true; break;
      }
    },
    text(text) { if (cell && collecting) cell.value += text; },
    closetag(tag) {
      const name = local(tag.name);
      if (name === 'v' || name === 't') collecting = false;
      if (name === 'c' && cell) {
        const { column, type, value } = cell;
        if (value.length > sheetLimits.text) invalid('В таблице слишком длинная ячейка.');
        const item = cell.formula ? formula : type === 's' ? strings[Number(value)] :
          type === 'b' ? value === '1' : type === 'e' ? { error: true } :
          type === 'inlineStr' || type === 'str' || type === 'd' || value === '' ? value : Number(value);
        if (item === undefined || typeof item === 'number' && !Number.isFinite(item)) invalid('В книге Excel повреждена ячейка строки ' + number + '.');
        while (row.length < column) row.push('');
        row[column] = item;
        cell = null;
      }
      if (name === 'row' && row.some(item => item !== '')) {
        rows.push({ number, values: row });
        if (rows.length > sheetLimits.rows + 1) invalid('Лист содержит больше 10 000 строк данных.');
      }
    },
  });
  return { rows, date1904 };
}

export function readSpreadsheet(name, data, encoding) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!bytes.length || bytes.length > sheetLimits.bytes) invalid('Выберите файл размером до 8 МиБ.');
  if (/\.csv$/i.test(name)) return [{ name: 'CSV', rows: parseCsv(bytes, encoding) }];
  if (!/\.xlsx$/i.test(name) || bytes[0] !== 80 || bytes[1] !== 75) invalid('Выберите книгу XLSX или файл CSV.');
  const files = unpackWorkbook(bytes);
  const targets = new Map();
  xml(files.get('xl/_rels/workbook.xml.rels'), { opentag({ name, attributes }) {
    if (local(name) !== 'Relationship' || attributes.TargetMode === 'External' || !attributes.Type?.endsWith('/worksheet')) return;
    const target = attributes.Target?.replace(/^\/?(?:xl\/)?/, 'xl/');
    if (target && /^xl\/worksheets\/[^/]+\.xml$/.test(target)) targets.set(attributes.Id, target);
  } });
  const strings = workbookStrings(files.get('xl/sharedStrings.xml'));
  const sheets = [], budget = { cells: 0 };
  let date1904 = false;
  const sheetInfo = [];
  xml(files.get('xl/workbook.xml'), { opentag({ name, attributes }) {
    if (local(name) === 'workbookPr') date1904 = ['1', 'true'].includes(attributes.date1904);
    if (local(name) !== 'sheet') return;
    const relationship = Object.entries(attributes).find(([key]) => key.endsWith(':id'))?.[1];
    const target = targets.get(relationship);
    if (target) sheetInfo.push({ name: attributes.name, target });
  } });
  for (const { name, target } of sheetInfo) sheets.push({ name, ...sheetRows(files.get(target), strings, budget, date1904) });
  if (!sheets.length) invalid('В книге нет доступных листов.');
  return sheets;
}

const escapeXml = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[<>&"']/g,
  character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character]));
const SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const ZIPREL = 'http://schemas.openxmlformats.org/package/2006/relationships';
function columnName(index) {
  let label = '';
  for (let number = index + 1; number; number = Math.floor((number - 1) / 26)) label = String.fromCharCode(65 + (number - 1) % 26) + label;
  return label;
}
export function writeSpreadsheet(kind, rows) {
  if (kind === 'csv') return strToU8('\uFEFF' + rows.map(row => row.map(value => {
    let content = String(value ?? '');
    if (typeof value !== 'number' && /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(content)) content = "'" + content;
    return '"' + content.replaceAll('"', '""') + '"';
  }).join(';')).join('\r\n'));
  const grid = rows.map((row, i) => '<row r="' + (i + 1) + '">' + row.map((value, j) => {
    if (value == null || value === '') return '';
    const ref = columnName(j) + (i + 1);
    return typeof value === 'number' && Number.isFinite(value) ? `<c r="${ref}"><v>${value}</v></c>` :
      `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }).join('') + '</row>').join('');
  return zipSync(Object.fromEntries(Object.entries({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="${ZIPREL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${SHEET}" xmlns:r="${REL}"><sheets><sheet name="PhoneBooks" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${ZIPREL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${SHEET}"><sheetData>${grid}</sheetData></worksheet>`,
  }).map(([path, value]) => [path, strToU8(value)])), { level: 6 });
}
