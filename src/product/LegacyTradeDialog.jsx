import React, { useState } from 'react';
import { Modal } from '../components/ui.jsx';
import { applyLegacyTrade, legacyTradeContext } from '../domain/legacyTrade.js';
import { useStore } from '../hooks/useStore.jsx';
import { TradePanel } from './TradePanel.jsx';

const actions = ['reserve', 'extend_reserve', 'cancel_reserve', 'sale', 'customer_return', 'supplier_return',
  'compensation', 'void_sale', 'repair_start'];

export function LegacyTradeDialog({ productId, onClose }) {
  const { data, mutatePersisted } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const context = legacyTradeContext(data, productId);
  if (!context) return null;
  async function submit(command) {
    setBusy(true);
    setError('');
    try {
      const result = await mutatePersisted(state => applyLegacyTrade(state, command));
      if (!result.ok) setError(result.error?.message ?? 'Не удалось сохранить операцию.');
      return result.ok;
    } finally { setBusy(false); }
  }
  return <Modal open title="Операции с товаром" onClose={onClose}>
    {error && <p role="alert" className="pb-empty">{error}</p>}
    <TradePanel {...context} accounts={data.accounts.filter(row => !row.archived)} allowed={actions} busy={busy} submit={submit} />
  </Modal>;
}
