import React, { useEffect, useMemo, useState } from 'react';
import { analyticsPeriod } from '../domain/analytics.js';
import { formatMinorMoney, formatShortDate, getPeriod, today } from '../utils/format.js';
import { FinanceChart } from './FinanceChart.jsx';
import './analytics.css';

import { agingColumns, analyticsGrid, categoryColumns, financial, includes, rankingColumns, visibleColumns } from '../domain/analyticsExport.js';

const ageBands = [
  ['До 7 дней', 0, 7], ['8–14 дней', 8, 14], ['15–30 дней', 15, 30],
  ['31–60 дней', 31, 60], ['Более 60 дней', 61, Infinity], ['Дата неизвестна'],
];
const modes = [['finance', 'Показатели'], ['categories', 'Категории'], ['aging', 'Залежавшиеся товары']];
const number = new Intl.NumberFormat('ru', { maximumFractionDigits: 2 });
const valueText = (value, key, unit) => value == null ? '—' : key.endsWith('Minor') ?
  formatMinorMoney(value) : typeof value === 'number' ? number.format(value) + (unit ? ' ' + unit : '') : value;

async function download(grid, format) {
  const { writeSpreadsheet } = await import('../domain/spreadsheetFile.js');
  const href = URL.createObjectURL(new Blob([writeSpreadsheet(format, grid)], { type: format === 'csv' ?
    'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = href;
  link.download = 'phonebooks-analytics.' + format;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 30000);
}

function ReportTable({ rows, columns, label, onProduct }) {
  if (!rows.length) return <p className="pb-empty">Нет данных.</p>;
  const visible = visibleColumns(rows, columns);
  return <div className={'pb-analytics-table' + (onProduct ? ' pb-analytics-table-stock' : '')} tabIndex="0" role="region" aria-label={label}>
    <table><thead><tr>{visible.map(([key, title]) => <th key={key} scope="col">{title}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.productId ? JSON.stringify([row.productId, row.id]) : row.id}>
        {visible.map(([key, title]) => key === 'name' ? <th scope="row" key={key}>
          {onProduct ? <button className="pb-analytics-link" type="button" onClick={() => onProduct(row.productId ?? row.id)}>{row.name}</button> : row.name}
        </th> : <td key={key} data-label={title}>{valueText(row[key], key)}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

function ExportButtons({ grid }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function exportReport(format) {
    setBusy(true);
    setError('');
    try { await download(grid(), format); } catch { setError('Не удалось сохранить отчёт.'); }
    finally { setBusy(false); }
  }
  return <div className="pb-actions">
    {['xlsx', 'csv'].map(format => <button className="pb-action pb-action-secondary" key={format} type="button" disabled={busy}
      onClick={() => void exportReport(format)}>Скачать {format === 'xlsx' ? 'Excel' : 'CSV'}</button>)}
    {error && <p role="alert">{error}</p>}
  </div>;
}

function FinancialDetails({ report, canExport }) {
  const { current, previous, series } = report;
  const chartOptions = financial.filter(([key]) => key !== 'stockMinor' && includes(current, key));
  const [metric, setMetric] = useState('revenueMinor');
  const selected = chartOptions.find(([key]) => key === metric) ?? chartOptions[0];
  const chartRows = selected ? series.map(row => ({ key: row.from, label: formatShortDate(row.from),
    fullLabel: row.from === row.to ? row.from : row.from + ' — ' + row.to,
    value: row[selected[0]] == null ? null : Number(row[selected[0]]) / (selected[0].endsWith('Minor') ? 100 : 1) })) : [];
  return <>
    <dl className="pb-analytics-metrics">
      {visibleColumns([current], financial).map(([key, label, unit]) => {
        const before = previous[key], actual = current[key];
        const delta = before == null || actual == null ? null : key.endsWith('Minor') ? BigInt(actual) - BigInt(before) :
          Math.round((Number(actual) - Number(before)) * 100) / 100;
        return <div key={key}><dt>{label}</dt><dd>{valueText(actual, key, unit)}</dd>
          {includes(previous, key) && <small>Было {valueText(before, key, unit)}{delta != null &&
            <> · {delta > 0 ? '+' : ''}{valueText(delta, key, unit ? 'п. п.' : '')}</>}</small>}</div>;
      })}
    </dl>
    {selected && <section className="pb-analytics-card">
      <div className="pb-analytics-heading"><h3>Динамика</h3>
        <label>Показатель<select aria-label="Показатель" value={selected[0]} onChange={event => setMetric(event.target.value)}>
          {chartOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
      </div>
      <FinanceChart data={chartRows} series={[{ key: 'value', label: selected[1] }]}
        formatValue={selected[0].endsWith('Minor') ? undefined : value => valueText(value, selected[0], selected[2])} />
    </section>}
    {canExport && <ExportButtons grid={() => analyticsGrid(report, 'finance')} />}
  </>;
}

function CategoryDetails({ report, canExport }) {
  return <>
    <section className="pb-analytics-card"><h3>Продажи и запасы по категориям</h3>
      <ReportTable rows={report.categories} columns={categoryColumns} label="Продажи и запасы по категориям" />
    </section>
    {report.models && <div className="pb-analytics-rankings">
      <section className="pb-analytics-card"><h3>Самые прибыльные модели</h3><ReportTable
        rows={report.models} columns={rankingColumns} label="Самые прибыльные модели" /></section>
      <section className="pb-analytics-card"><h3>Самые прибыльные товары</h3><ReportTable
        rows={report.topProducts} columns={rankingColumns} label="Самые прибыльные товары" /></section>
    </div>}
    {canExport && <ExportButtons grid={() => analyticsGrid(report, 'categories')} />}
  </>;
}

const ageBand = days => ageBands.findIndex(([, min, max]) => min == null ? days == null : days >= min && days <= max && days != null);
const pageSize = 30;
function AgingDetails({ report, preferencesKey, onProduct, canExport }) {
  const storageKey = 'phonebooks.analytics.aging.' + preferencesKey;
  const [threshold, setThreshold] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey) ?? 31);
    return Number.isSafeInteger(saved) && saved >= 0 && saved <= 36500 ? saved : 31;
  });
  const [agedOnly, setAgedOnly] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [order, setOrder] = useState('age');
  const [page, setPage] = useState(0);
  const hasCost = report.stock.some(row => includes(row, 'stockMinor')) || report.stockCostVisible === true;
  const categories = useMemo(() => [...new Set(report.stock.map(row => row.category))].sort((a, b) => a.localeCompare(b, 'ru')), [report.stock]);
  const { bands, freeze, count } = useMemo(() => {
    const shown = ageBands.map(() => []);
    const freeze = { threshold, quantity: 0, cost: hasCost ? 0n : null };
    let count = 0;
    for (const row of report.stock) {
      if ((category && row.category !== category) || !row.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))) continue;
      const aged = row.days != null && row.days >= threshold;
      if (aged) {
        freeze.quantity += row.quantity;
        if (hasCost) freeze.cost += BigInt(row.stockMinor);
      }
      if (agedOnly && !aged) continue;
      const group = ageBand(row.days);
      shown[group].push({ ...row, band: ageBands[group][0] });
      count++;
    }
    for (const rows of shown) rows.sort((left, right) => (order === 'name' ? left.name.localeCompare(right.name, 'ru') :
      order === 'cost' ? Number(right.stockMinor) - Number(left.stockMinor) :
        (right.days ?? -1) - (left.days ?? -1)) || left.name.localeCompare(right.name, 'ru'));
    return { bands: shown, freeze, count };
  }, [report.stock, threshold, category, query, agedOnly, order, hasCost]);
  const last = Math.max(0, Math.ceil(count / pageSize) - 1), index = Math.min(page, last);
  let offset = 0;
  return <>
    <div className="pb-analytics-controls">
      <label>Порог, дней<input type="number" min="0" max="36500" value={threshold} onChange={event => {
        const value = Number(event.target.value);
        if (Number.isSafeInteger(value) && value >= 0 && value <= 36500) {
          setThreshold(value);
          localStorage.setItem(storageKey, String(value));
          setPage(0);
        }
      }} /></label>
      <label>Поиск товара<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <label>Категория<select value={category} onChange={event => { setCategory(event.target.value); setPage(0); }}>
        <option value="">Все категории</option>{categories.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <label>Сортировка в группе<select value={order} onChange={event => { setOrder(event.target.value); setPage(0); }}>
        <option value="age">Сначала старые</option><option value="name">По названию</option>{hasCost && <option value="cost">Сначала дорогие</option>}
      </select></label>
      <label className="pb-analytics-checkbox"><input type="checkbox" checked={agedOnly}
        onChange={event => { setAgedOnly(event.target.checked); setPage(0); }} /> Только от порога</label>
    </div>
    <dl className="pb-analytics-metrics">
      <div><dt>Единиц от порога</dt><dd>{number.format(freeze.quantity)}</dd></div>
      {hasCost && <div><dt>Заморожено в товарах</dt><dd>{formatMinorMoney(freeze.cost)}</dd></div>}
    </dl>
    {!count && <p className="pb-empty">По этим фильтрам нет партий.</p>}
    {bands.map((rows, group) => {
      const first = offset;
      offset += rows.length;
      const visible = rows.slice(Math.max(0, index * pageSize - first), Math.max(0, (index + 1) * pageSize - first));
      return visible.length ? <section className="pb-analytics-card" key={group}>
        <h3>{ageBands[group][0]}</h3>
        <ReportTable rows={visible} columns={agingColumns} label={ageBands[group][0]} onProduct={onProduct} />
      </section> : null;
    })}
    {last > 0 && <div className="pb-actions" aria-label="Страницы складских партий">
      <button className="pb-action pb-action-secondary" type="button" disabled={index === 0} onClick={() => setPage(index - 1)}>Назад</button>
      <span>{index + 1} из {last + 1}</span>
      <button className="pb-action pb-action-secondary" type="button" disabled={index === last} onClick={() => setPage(index + 1)}>Далее</button>
    </div>}
    {canExport && <ExportButtons grid={() => analyticsGrid(report, 'aging', bands.flat(), freeze)} />}
  </>;
}

export function AnalyticsPanel({ allowed, preferencesKey, localReport, fetchReport, canExport, onProduct, onClose, revision, online = true }) {
  const [mode, setMode] = useState(allowed[0]);
  const section = allowed.includes(mode) ? mode : allowed[0];
  const [dates, setDates] = useState(() => getPeriod('month'));
  const period = useMemo(() => section === 'aging' ? analyticsPeriod(today(), today()) :
    analyticsPeriod(dates.from, dates.to), [section, dates.from, dates.to]);
  const [loaded, setLoaded] = useState(null);
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify([preferencesKey, revision, section, dates.from, dates.to, retry]);
  useEffect(() => {
    if (!fetchReport || !section || !period || !online) return;
    let active = true;
    fetchReport(section, period).then(report => {
      if (active) setLoaded({ requestKey, report: { ...report, from: period.from, to: period.to } });
    }, error => { if (active) setLoaded({ requestKey, error: error.message }); });
    return () => { active = false; };
  }, [fetchReport, online, period, requestKey, section]);
  const local = useMemo(() => period && localReport?.(period, today()), [localReport, period]);
  const report = local ?? (online && loaded?.requestKey === requestKey ? loaded.report : null);
  const error = online && loaded?.requestKey === requestKey ? loaded.error : null;
  const details = { report, canExport, onProduct, preferencesKey };
  return <section className="pb-analytics" aria-label="Расширенная аналитика">
    <div className="pb-analytics-heading"><h2>Расширенная аналитика</h2>
      <button type="button" className="pb-action pb-action-secondary" onClick={onClose}>К финансам</button></div>
    <div className="pb-tabs" role="group" aria-label="Отчёты аналитики">
      {modes.filter(([id]) => allowed.includes(id)).map(([id, label]) =>
        <button type="button" key={id} aria-pressed={section === id} onClick={() => setMode(id)}>{label}</button>)}
    </div>
    {section !== 'aging' && <div className="pb-analytics-controls pb-analytics-dates">
      <label>С даты<input type="date" min="0001-01-01" max="9999-12-31" value={dates.from}
        onChange={event => setDates({ ...dates, from: event.target.value })} /></label>
      <label>По дату<input type="date" min="0001-01-01" max="9999-12-31" value={dates.to}
        onChange={event => setDates({ ...dates, to: event.target.value })} /></label>
      {period && section === 'finance' && <small>Предыдущий период {period.previousFrom} — {period.previousTo}</small>}
    </div>}
    {!period && section !== 'aging' ? <p className="pb-empty">Укажите корректный период.</p>
      : error ? <div role="alert">{error} <button className="pb-action pb-action-secondary" onClick={() => setRetry(retry + 1)}>Повторить</button></div>
        : !report ? <p role="status" className="pb-empty">{online ? 'Загружаем отчёт…' : 'Отчёт доступен при подключении.'}</p>
          : section === 'finance' ? <FinancialDetails {...details} /> : section === 'categories' ?
            <CategoryDetails {...details} /> : <AgingDetails {...details} />}
  </section>;
}
