import React from 'react';
import { formatPreciseMoney } from '../utils/format.js';

export function FinanceChart({ data, series }) {
  const marks = data.flatMap(row => series.map(({ key }) => row[key] ?? 0));
  if (!marks.some(Boolean)) return <p className="pb-empty">За этот период нет движения по выбранным показателям.</p>;
  const high = Math.max(0, ...marks);
  const low = Math.min(0, ...marks);
  const plot = 160;
  const y = value => 12 + plot * (high - value) / (high - low);
  const slot = 600 / data.length;
  const width = Math.min(22, slot / (series.length + 1));
  const ticks = [...new Set([high, 0, low])].sort((a, b) => b - a);
  return <figure className="pb-chart">
    <svg viewBox="0 0 680 207" role="img" aria-label={series.map(item => item.label).join(' и ') + ' за выбранный период'}>
      {ticks.map(value => <g key={value}>
        <line x1="73" y1={y(value)} x2="673" y2={y(value)} />
        <text x="65" y={y(value) + 4} textAnchor="end">{Intl.NumberFormat('ru', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}</text>
      </g>)}
      {data.map((row, index) => {
        const center = 73 + slot * (index + .5);
        return <g key={row.key}>
          {series.map(({ key }, offset) => {
            const value = row[key] ?? 0;
            return <rect className={'pb-chart-series-' + offset} key={key} x={center + width * (offset - series.length / 2)}
              y={Math.min(y(value), y(0))} width={Math.max(1, width - 2)} height={Math.abs(y(value) - y(0))} rx="2" />;
          })}
          {index % Math.ceil(data.length / 8) === 0 && <text x={center} y="191" textAnchor="middle">{row.label}</text>}
        </g>;
      })}
    </svg>
    <figcaption>{series.map(({ key, label }, i) => <span key={key}><i className={'pb-chart-series-' + i} />{label}</span>)}</figcaption>
    <details className="pb-chart-values">
      <summary>Значения графика</summary>
      <div className="pb-chart-table"><table>
        <thead><tr><th scope="col">Дата</th>{series.map(({ key, label }) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
        <tbody>{data.map(row => <tr key={row.key}><th scope="row">{row.fullLabel ?? row.label}</th>
          {series.map(({ key }) => <td key={key}>{formatPreciseMoney(row[key] ?? 0)}</td>)}</tr>)}</tbody>
      </table></div>
    </details>
  </figure>;
}
