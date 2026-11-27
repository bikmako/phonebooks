export const financial = [
  ['revenueMinor', 'Выручка'], ['grossMinor', 'Валовая прибыль'], ['netMinor', 'Чистая прибыль'],
  ['costMinor', 'Себестоимость'], ['expensesMinor', 'Расходы'], ['averageMinor', 'Средний чек'],
  ['margin', 'Валовая маржинальность', '%'], ['purchasedUnits', 'Закуплено, шт.'], ['soldUnits', 'Продано за вычетом возвратов, шт.'],
  ['stockMinor', 'Текущая стоимость остатков'],
];
export const categoryColumns = [
  ['name', 'Категория'], ['sales', 'Чеки'], ['soldUnits', 'Продано, шт.'], ['revenueMinor', 'Выручка'],
  ['grossMinor', 'Валовая прибыль'], ['averageMinor', 'Прибыль на товар'], ['sellDays', 'Срок продажи, дн.'],
  ['turnover', 'Оборачиваемость, раз'], ['stockMinor', 'Стоимость остатков'],
];
export const agingColumns = [
  ['name', 'Товар'], ['category', 'Категория'], ['days', 'Дней на складе'], ['quantity', 'Количество'],
  ['stockMinor', 'Стоимость партии'], ['plannedMinor', 'Плановая цена за шт.'],
];
export const rankingColumns = [['name', 'Название'], ['grossMinor', 'Валовая прибыль']];
export const includes = (row, key) => Object.hasOwn(row, key);
function exportMoney(value) {
  const minor = BigInt(value);
  const absolute = minor < 0n ? -minor : minor;
  if (absolute <= 999999999999999n) return Number(minor) / 100;
  return (minor < 0n ? '-' : '') + (absolute / 100n) + ',' + String(absolute % 100n).padStart(2, '0');
}
const exportValue = (row, key) => row[key] == null ? '' : key.endsWith('Minor') ? exportMoney(row[key]) : row[key];
const exportLabel = ([key, label, unit]) => key.endsWith('Minor') ? label + ', ₽' : unit ? label + ', ' + unit : label;
export const visibleColumns = (rows, columns) => columns.filter(([key]) => rows.some(row => includes(row, key)));
const sectionRows = (section, rows, columns) => {
  const visible = visibleColumns(rows, columns);
  return visible.length ? [[section, ...visible.map(exportLabel)], ...rows.map(row => ['', ...visible.map(([key]) => exportValue(row, key))])] : [];
};

export function analyticsGrid(report, mode, stock = [], freeze = null) {
  if (mode === 'finance') {
    const columns = visibleColumns([report.current], financial);
    return [
      ['Показатель', report.current.from + ' — ' + report.current.to, report.previous.from + ' — ' + report.previous.to],
      ...columns.map(column => [exportLabel(column), exportValue(report.current, column[0]), exportValue(report.previous, column[0])]),
      [], ...sectionRows('Динамика', report.series, [['from', 'С даты'], ['to', 'По дату'], ...columns]),
    ];
  }
  if (mode === 'categories') return [
    ['С даты', report.from, 'По дату', report.to],
    ...sectionRows('Категории', report.categories, categoryColumns),
    [], ...sectionRows('Модели', report.models ?? [], rankingColumns),
    [], ...sectionRows('Товары', report.topProducts ?? [], rankingColumns),
  ];
  return [
    ['Залежавшиеся товары', 'Порог, дней', freeze.threshold, 'Единиц', freeze.quantity,
      ...(freeze.cost == null ? [] : ['Заморожено, ₽', exportMoney(freeze.cost)])],
    ...sectionRows('Партии', stock, [['band', 'Группа'], ...agingColumns, ['date', 'Дата поступления']]),
  ];
}
