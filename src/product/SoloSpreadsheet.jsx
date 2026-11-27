import React from 'react';
import { projectInventory } from '../domain/inventory.js';
import { exportTypes } from '../domain/spreadsheetExport.js';
import { isDemo } from '../demo/mode.js';
import { useStore } from '../hooks/useStore.jsx';
import { readInventoryCatalog } from '../storage/inventoryStore.js';
import { Modal } from '../components/ui.jsx';
import { SpreadsheetPanel } from './SpreadsheetPanel.jsx';

const available = Object.keys(exportTypes).filter(key => !['all','employees'].includes(key));
export function SoloSpreadsheet({ currentFilter }) {
  const { data, mutatePersisted, period } = useStore();
  const categories = projectInventory(data).categories;
  async function options() {
    const inventory = projectInventory(data, data.catalog ?? await readInventoryCatalog());
    return { categories: inventory.categories, known: data.sheetImports,
      imeis: inventory.products.filter(item => item.attributes.imei).map(item => [item.attributes.imei, item.id]) };
  }
  async function save(plan, _id, _snapshot, run) {
    const result = await mutatePersisted(async state => run('soloApply', {
      state: state.catalog ? state : { ...state, catalog: await readInventoryCatalog() }, plan,
    }), 'spreadsheet');
    if (!result.ok) throw result.error ?? new Error('Не удалось сохранить таблицу.');
    return result;
  }
  async function download(kind, filter, format, run) {
    const keys = kind === 'all' ? ['stock','history','reservation','finance'] : [kind];
    const state = data.catalog ? data : { ...data, catalog: await readInventoryCatalog() };
    return run('encode', { format, filter, state, kinds: keys.map(key => [key, exportTypes[key]]) });
  }
  return <SpreadsheetPanel options={options} categories={categories} accounts={data.accounts.filter(row => !row.archived)}
    period={period} currentFilter={currentFilter} allowedExports={available} onImport={save} onExport={download} />;
}

export function SpreadsheetExportDialog({ filter, onClose }) {
  if (isDemo) return null;
  return <Modal open size="lg" title="Экспорт таблицы" onClose={onClose}>
    <SoloSpreadsheet currentFilter={filter} />
  </Modal>;
}

export function FinanceSheetExport({ filter }) {
  const [open, setOpen] = React.useState(false);
  if (isDemo) return null;
  return <><button className="pb-action pb-action-secondary" onClick={() => setOpen(true)}>Экспорт финансов</button>
    {open && <SpreadsheetExportDialog filter={{ kind: 'finance', ...filter }} onClose={() => setOpen(false)} />}
  </>;
}
