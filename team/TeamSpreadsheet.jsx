import React from 'react';
import { exportTypes } from '../src/domain/spreadsheetExport.js';
import { SpreadsheetPanel } from '../src/product/SpreadsheetPanel.jsx';

const stockTypes = ['stock','reservation'];
const ledgerTypes = ['purchase','sale','returns','repair','expense','history'];
export function TeamSpreadsheet({ data, scope, api, online, period, currentFilter, onChanged }) {
  const rights = new Set(data.permissions);
  const importAllowed = rights.has('data.import');
  const outputs = rights.has('data.export') ? [
    ...(rights.has('stock.read') ? stockTypes : []),
    ...(rights.has('finance.history.read') ? ledgerTypes : []),
    ...(rights.has('analytics.company') ? ['finance'] : []),
    ...(rights.has('analytics.self') || rights.has('analytics.others') && rights.has('team.members.read') ? ['employees'] : []),
  ] : [];
  const receiptKey = 'phonebooks.team.pending:' + scope.p_actor + ':' + scope.p_workspace + ':sheet';
  function previousReceipt() {
    try {
      const id = sessionStorage.getItem(receiptKey);
      return id ? { id } : null;
    } catch { return null; }
  }
  function options() {
    return { revision: data.cursor, categories: data.categories,
      imeis: data.products.filter(row => row.attributes?.imei).map(row => [row.attributes.imei, row.id]) };
  }
  async function check({ rows,products,categories }, snapshot) {
    const result = await api('cloud/sheet-check', { ...scope, p_expected: snapshot.revision, p_plan: { rows,products,categories } });
    return result.duplicates;
  }
  async function save({ rows, products, categories }, request, snapshot) {
    const result = await api('cloud/sheet-import', { ...scope, p_request: request, p_expected: snapshot.revision,
      p_plan: { rows, products, categories } });
    try { sessionStorage.setItem(receiptKey, result.id); } catch { /* The current screen retains the receipt. */ }
    await onChanged();
    return result;
  }
  async function undo(receipt) {
    await api('cloud/sheet-revert', { ...scope, p_request: receipt.id });
    try { sessionStorage.removeItem(receiptKey); } catch { /* No persistent receipt to remove. */ }
    await onChanged({ reset: true });
  }
  async function download(kind, filter, format, run) {
    const kinds = kind === 'all' ? outputs.filter(key => !ledgerTypes.includes(key) || key === 'history') : [kind];
    const tables = [];
    let revision = null;
    const expectedRights = [...rights].sort().join(',');
    for (const key of kinds) {
      let after = null;
      const rows = [];
      do {
        const page = await api('cloud/sheet-export', { ...scope, p_kind: key, p_filter: filter, p_after: after, p_revision: revision });
        if ([...page.permissions].sort().join(',') !== expectedRights) throw new Error('Права изменились. Повторите экспорт.');
        rows.push(...page.rows);
        revision = page.revision;
        after = page.next;
      } while (after);
      tables.push({ name: exportTypes[key], rows });
    }
    return run('encode', { format, tables });
  }
  if (!outputs.length && !importAllowed) return null;
  return <SpreadsheetPanel options={options} accounts={data.accounts.filter(row => !row.archived)} categories={data.categories}
    currentFilter={currentFilter} period={period} importAllowed={importAllowed} allowedExports={outputs}
    disabled={!online} recoverable={importAllowed ? previousReceipt() : null} onCheck={check} onImport={save} onUndo={undo} onExport={download} />;
}
