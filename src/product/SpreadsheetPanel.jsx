import React, { useEffect, useRef, useState } from 'react';
import { importColumns, importTypes } from '../domain/spreadsheet.js';
import { exportTypes } from '../domain/spreadsheetExport.js';
import { getPeriod, today } from '../utils/format.js';
import { warehouseMoney } from './WarehouseFields.jsx';
import './spreadsheet.css';

const templateKey = 'phonebooks.sheet.templates.v1';
const loadTemplates = () => {
  try { return JSON.parse(localStorage.getItem(templateKey)) ?? {}; } catch { return {}; }
};

function useSheetWorker() {
  const worker = useRef();
  const pending = useRef();
  const sequence = useRef(0);
  function reset() {
    worker.current?.terminate();
    worker.current = undefined;
    pending.current?.reject(new DOMException('Отменено', 'AbortError'));
    pending.current = undefined;
  }
  useEffect(() => reset, []);
  async function run(operation, input, transfers = []) {
    if (pending.current) throw new Error('Подождите завершения обработки.');
    worker.current ??= new Worker(new URL('./spreadsheet-worker.js', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
      const id = ++sequence.current;
      pending.current = { reject };
      worker.current.onmessage = ({ data }) => {
        if (id !== sequence.current || data.id !== id) return;
        pending.current = undefined;
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
      };
      worker.current.onerror = () => { pending.current = undefined; reject(new Error('Не удалось обработать таблицу.')); };
      worker.current.postMessage({ id, operation, input }, transfers);
    });
  }
  return { run, reset };
}

function download(bytes, name, format) {
  const url = URL.createObjectURL(new Blob([bytes], { type: format === 'csv' ? 'text/csv;charset=utf-8' :
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'phonebooks-' + name + '.' + format;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function SpreadsheetPanel({ options, accounts, categories, currentFilter, period, importAllowed = true, allowedExports,
  disabled, recoverable, onCheck, onImport, onUndo, onExport }) {
  const worker = useSheetWorker();
  const [mode, setMode] = useState(importAllowed && !currentFilter ? 'import' : 'export');
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [sheet, setSheet] = useState(0);
  const [mapping, setMapping] = useState([]);
  const [defaultType, setDefaultType] = useState('opening');
  const [accountId, setAccountId] = useState('');
  const [format, setFormat] = useState('xlsx');
  const [kind, setKind] = useState(currentFilter?.kind ?? 'all');
  const [encoding, setEncoding] = useState('');
  const [plan, setPlan] = useState(null);
  const [confirmation, setConfirmation] = useState(false);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const [receipt, setReceipt] = useState(recoverable ?? null);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState(loadTemplates);
  const [templateName, setTemplateName] = useState('');
  const [filtered, setFiltered] = useState(Boolean(currentFilter));
  const [query, setQuery] = useState(currentFilter?.query ?? '');
  const [category, setCategory] = useState(currentFilter?.category ?? '');
  const [status, setStatus] = useState(currentFilter?.status ?? 'all');
  const [from, setFrom] = useState(currentFilter?.from ?? (period && period !== 'all' ? getPeriod(period).from : ''));
  const [to, setTo] = useState(currentFilter?.to ?? (period && period !== 'all' ? getPeriod(period).to : ''));
  const attempt = useRef();
  const generation = useRef(0);
  const optionsAtPreview = useRef();

  function invalidate() {
    generation.current++;
    setPlan(null);
    setConfirmation(false);
    setResult('');
    setError('');
    attempt.current = undefined;
  }
  async function task(label, action) {
    setBusy(label);
    setError('');
    try { await action(); }
    catch (failure) { if (failure.name !== 'AbortError') setError(failure.message); }
    finally { setBusy(''); }
  }
  async function read(nextFile, codec = encoding) {
    invalidate();
    const reading = generation.current;
    setFile(nextFile);
    setSheets([]);
    if (!nextFile) return;
    await task('read', async () => {
      if (nextFile.size > 8 * 1024 * 1024) throw new Error('Выберите файл размером до 8 МиБ.');
      const bytes = await nextFile.arrayBuffer();
      if (reading !== generation.current) return;
      const workbook = await worker.run('read', { name: nextFile.name, bytes, encoding: codec }, [bytes]);
      if (reading !== generation.current) return;
      setSheets(workbook);
      setSheet(0);
      setMapping(workbook[0].mapping);
    });
  }
  function selectSheet(index) {
    invalidate();
    setSheet(index);
    setMapping(sheets[index].mapping);
  }
  function storeTemplate() {
    const name = templateName.trim();
    if (!name) return;
    const latest = { ...templates, [name]: { mapping, defaultType } };
    try { localStorage.setItem(templateKey, JSON.stringify(latest)); setTemplates(latest); }
    catch { setError('Не удалось сохранить шаблон на устройстве.'); return; }
    setTemplateName('');
  }
  function preview() {
    invalidate();
    const preparing = generation.current;
    void task('preview', async () => {
      const snapshot = await options();
      if (preparing !== generation.current) return;
      optionsAtPreview.current = snapshot;
      const preview = await worker.run('preview', { sheet, mapping, options: {
        categories: snapshot.categories, known: snapshot.known, imeis: snapshot.imeis, defaultType, accountId, today: today(),
      } });
      if (onCheck && preview.rows.length && !preview.errors.length) {
        if (preparing !== generation.current) return;
        const duplicates = await onCheck(preview, snapshot);
        preview.errors.push(...duplicates.map(row => ({ row, message: 'Эта строка уже была импортирована.' })));
      }
      if (preparing !== generation.current) return;
      setPlan(preview);
      attempt.current = crypto.randomUUID();
    });
  }
  function submit() {
    if (!confirmation || !plan || plan.errors.length || !plan.rows.length || disabled || busy || !attempt.current) return;
    void task('commit', async () => {
      const completed = await onImport(plan, attempt.current, optionsAtPreview.current, worker.run);
      setReceipt(completed);
      setResult('Импорт завершён. Строк: ' + plan.rows.length + '.');
      setPlan(null);
      setSheets([]);
      setFile(null);
      setConfirmation(false);
    });
  }
  function cancel() {
    worker.reset();
    invalidate();
    setFile(null);
    setSheets([]);
  }
  function exportTable() {
    const selection = allowedExports.includes(kind) || kind === 'all' ? kind : allowedExports[0];
    void task('export', async () => {
      const filter = filtered ? { query, category, status, from: from || null, to: to || null,
        ids: query === (currentFilter?.query ?? '') ? currentFilter?.ids : undefined,
        operationStatus: currentFilter?.operationStatus } : {};
      if (filter.from && filter.to && filter.from > filter.to) throw new Error('Дата начала должна быть раньше даты окончания.');
      download(await onExport(selection, filter, format, worker.run), selection, format);
      setResult('Таблица готова.');
    });
  }
  const sheetInfo = sheets[sheet];
  return <section className="pb-sheet" aria-label="Таблицы Excel и CSV">
    <div className="pb-tabs" aria-label="Работа с таблицами">
      {importAllowed && <button type="button" aria-pressed={mode === 'import'} disabled={!!busy} onClick={() => { setMode('import'); setResult(''); }}>Импорт</button>}
      {allowedExports.length > 0 && <button type="button" aria-pressed={mode === 'export'} disabled={!!busy} onClick={() => { setMode('export'); setResult(''); }}>Экспорт</button>}
    </div>
    {error && <p role="alert" className="pb-sheet-error">{error}</p>}
    {result && <p role="status" className="pb-sheet-result">{result}</p>}
    {mode === 'import' && <>
      <label>Файл Excel или CSV<input key={file ? 'chosen' : 'empty'} type="file" accept=".xlsx,.csv" disabled={!!busy || disabled}
        onChange={event => void read(event.target.files?.[0])} /></label>
      {file && <p className="pb-sheet-hint">{file.name}</p>}
      {file && /\.csv$/i.test(file.name) && <label>Кодировка CSV<select value={encoding} disabled={!!busy}
        onChange={event => { const value = event.target.value; setEncoding(value); void read(file, value); }}>
        <option value="">Определить автоматически</option><option value="utf-8">UTF‑8</option><option value="windows-1251">Windows‑1251</option>
        <option value="windows-1252">Windows‑1252</option><option value="utf-16le">UTF‑16 LE</option><option value="utf-16be">UTF‑16 BE</option>
      </select></label>}
      {sheetInfo && <>
        {sheets.length > 1 && <label>Лист Excel<select disabled={!!busy} value={sheet} onChange={event => selectSheet(Number(event.target.value))}>
          {sheets.map((item, index) => <option value={index} key={index}>{item.name}</option>)}</select></label>}
        <h3>Сопоставьте столбцы</h3>
        <div className="pb-sheet-fields">
          <label>Если тип не указан<select disabled={!!busy} value={defaultType} onChange={event => { invalidate(); setDefaultType(event.target.value); }}>
            {Object.entries(importTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Счёт текущих операций<select disabled={!!busy} value={accountId} onChange={event => { invalidate(); setAccountId(event.target.value); }}>
            <option value="">Выберите счёт</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        </div>
        <div className="pb-sheet-mapping">
          {sheetInfo.headers.map((header, index) => <label key={index}>{typeof header === 'object' ? 'Столбец ' + (index + 1) : String(header || 'Столбец ' + (index + 1))}
            <select value={mapping[index] ?? ''} disabled={!!busy} onChange={event => {
              const value = event.target.value; invalidate(); setMapping(before => before.map((field, i) => i === index ? value : field));
            }}><option value="">Пропустить</option>{Object.entries(importColumns).map(([value, [label]]) => <option key={value} value={value}>{label}</option>)}
              <option value="attribute">Характеристика товара</option>
            </select></label>)}
        </div>
        {Object.keys(templates).length > 0 && <label>Шаблон сопоставления<select value="" disabled={!!busy} onChange={event => {
          const value = templates[event.target.value]; if (!value) return;
          invalidate(); setMapping(sheetInfo.headers.map((_, index) => value.mapping[index] ?? '')); setDefaultType(value.defaultType);
        }}><option value="">Выбрать сохранённый</option>{Object.keys(templates).map(name => <option key={name}>{name}</option>)}</select></label>}
        <div className="pb-sheet-fields">
          <label>Название шаблона<input value={templateName} maxLength={60} disabled={!!busy} onChange={event => setTemplateName(event.target.value)} /></label>
          <button type="button" className="pb-action pb-action-secondary secondary" disabled={!templateName.trim() || !!busy} onClick={storeTemplate}>Сохранить шаблон</button>
        </div>
        <button type="button" className="pb-action" disabled={!!busy || disabled || !sheetInfo.rows} onClick={preview}>Проверить и показать сводку</button>
      </>}
      {plan && <div className="pb-sheet-review">
        <h3>Предпросмотр импорта</h3>
        <p>Строк готово {plan.rows.length} · ошибок {plan.errors.length}</p>
        <p>Добавится остаток {plan.openingUnits} шт. · списание {warehouseMoney(-plan.cashMinor)} · историческая выручка {warehouseMoney(plan.historicalMinor)}</p>
        <ul>{Object.entries(plan.summary).filter(([, count]) => count > 0).map(([key, count]) => <li key={key}>{importTypes[key]} · {count}</li>)}</ul>
        {!!plan.errors.length && <ul aria-label="Ошибки строк">{plan.errors.slice(0, 30).map(({ row, message }, index) => <li key={index}>Строка {row} · {message}</li>)}</ul>}
        {plan.errors.length > 30 && <p>Показаны первые 30 ошибок.</p>}
        {!!plan.rows.length && <ul aria-label="Примеры строк">{plan.rows.slice(0, 8).map(row => <li key={row.sourceRow}>
          Строка {row.sourceRow} · {row.name} · {row.date} · {warehouseMoney(row.amountMinor)}
        </li>)}</ul>}
        {!plan.errors.length && !!plan.rows.length && <>
          <label className="pb-sheet-check"><input type="checkbox" checked={confirmation} disabled={!!busy}
            onChange={event => setConfirmation(event.target.checked)} /> Подтверждаю добавление строк и показанные изменения остатков и кассы</label>
          <button type="button" className="pb-action" disabled={!confirmation || !!busy || disabled} onClick={submit}>Подтвердить импорт</button>
        </>}
      </div>}
      {file && busy !== 'commit' && <button className="pb-action pb-action-secondary secondary" type="button" onClick={cancel}>Отменить импорт</button>}
      {receipt && onUndo && <button className="pb-action pb-action-secondary secondary" disabled={!!busy || disabled} type="button"
        onClick={() => {
          if (window.confirm('Восстановить склад, кассу и историю до последнего импорта?'))
            void task('commit', async () => { await onUndo(receipt); setReceipt(null); setResult('Состояние до импорта восстановлено.'); });
        }}>Отменить последний импорт</button>}
    </>}
    {mode === 'export' && allowedExports.length > 0 && <>
      <label>Данные<select aria-label="Данные" value={allowedExports.includes(kind) || kind === 'all' ? kind : allowedExports[0]} disabled={!!busy}
        onChange={event => setKind(event.target.value)}>
        <option value="all">{exportTypes.all}</option>{allowedExports.map(value => <option key={value} value={value}>{exportTypes[value]}</option>)}
      </select></label>
      <label className="pb-sheet-check"><input type="checkbox" checked={filtered} onChange={event => setFiltered(event.target.checked)} disabled={!!busy} />
        Применить фильтры</label>
      {filtered && <div className="pb-sheet-fields">
        {kind !== 'finance' && <label>Поиск<input value={query} maxLength={100} onChange={event => setQuery(event.target.value)} disabled={!!busy} /></label>}
        {['all','stock'].includes(kind) && <>
          <label>Категория<select value={category} onChange={event => setCategory(event.target.value)} disabled={!!busy}>
            <option value="">Все категории</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label>Статус товара<select value={status} onChange={event => setStatus(event.target.value)} disabled={!!busy}>
            <option value="all">Все</option><option value="stock">На складе</option><option value="reserved">В резерве</option>
            <option value="repair">В ремонте</option><option value="empty">Нет в наличии</option></select></label>
        </>}
        {kind !== 'stock' && <><label>С даты<input type="date" value={from} onChange={event => setFrom(event.target.value)} disabled={!!busy} /></label>
          <label>По дату<input type="date" value={to} onChange={event => setTo(event.target.value)} disabled={!!busy} /></label></>}
      </div>}
      <button type="button" className="pb-action" disabled={!!busy || disabled} onClick={exportTable}>Скачать экспорт</button>
    </>}
    <div className="pb-sheet-fields pb-sheet-actions">
      <label>Формат файла<select aria-label="Формат файла" value={format} disabled={!!busy} onChange={event => setFormat(event.target.value)}>
        <option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option>
      </select></label>
      {importAllowed && <button type="button" className="pb-action pb-action-secondary secondary" disabled={!!busy}
        onClick={() => void task('export', async () => download(await worker.run('template', { format }), 'template', format))}>Скачать шаблон</button>}
    </div>
    {busy && <p role="status">{busy === 'commit' ? 'Ждём подтверждения записи…' : 'Обрабатываем таблицу…'}</p>}
  </section>;
}
