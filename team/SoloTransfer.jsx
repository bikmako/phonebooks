import React, { useState } from 'react';
import { prepareSoloTransfer, transferSource, TRANSFER_LIMIT } from '../src/domain/soloTransfer.js';
import { MAX_FILE_BYTES } from '../src/storage/backupFormat.js';

const rubles = value => new Intl.NumberFormat('ru', { style: 'currency', currency: 'RUB' }).format(value / 100);

export function SoloTransfer({ scope, online, api, onImported }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [failure, setFailure] = useState('');

  async function inspect(file) {
    setPreview(null);
    setResult('');
    setFailure('');
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('Размер файла превышает предел формата резервной копии.');
      const source = transferSource(await file.text());
      const bytes = new TextEncoder().encode(JSON.stringify({ ...scope, source }));
      if (bytes.length > TRANSFER_LIMIT) throw new Error('Данные превышают предел переноса 4 МиБ. Копия сохранена у вас.');
      setPreview({ source, summary: prepareSoloTransfer(source).summary });
    } catch (error) {
      setFailure(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!online || !preview) return;
    setBusy(true);
    setFailure('');
    try {
      const reply = await api('cloud/import-solo', { ...scope, source: preview.source });
      setPreview(null);
      setResult(reply.replayed ? 'Сервер подтвердил ранее завершённый перенос.' : 'Сервер подтвердил перенос и сверку данных.');
      void onImported();
    } catch (error) {
      setFailure(error.status === 409
        ? 'Перенос остановлен. Пространство должно быть пустым, а остатки и суммы должны совпасть.'
        : error.status && error.status < 500 ? error.message : 'Подтверждение не получено. Проверьте в интернете, повторив перенос этой же копии.');
    } finally {
      setBusy(false);
    }
  }

  return <details>
    <summary>Перенос из Solo</summary>
    <p>Скачайте в Solo полную резервную копию и сохраните файл. Выберите копию для проверки. Перенос возможен в пустое пространство.</p>
    <label>Резервная копия Solo<input type="file" accept=".json,application/json" disabled={busy} onChange={event => void inspect(event.target.files[0])} /></label>
    {preview && <div>
      <p>Карточки: {preview.summary.products}. В наличии: {preview.summary.units}. Резерв: {preview.summary.reserved}.</p>
      <p>Операции: {preview.summary.operations}. Записи истории: {preview.summary.audit}. Счета: {preview.summary.accounts}.</p>
      <p>Остатки счетов {rubles(preview.summary.cashMinor)} · Товарные остатки {rubles(preview.summary.stockCostMinor)}</p>
      <p>Выручка {rubles(preview.summary.revenueMinor)} · Валовая прибыль {rubles(preview.summary.grossProfitMinor)} · Чистая прибыль {rubles(preview.summary.netProfitMinor)}</p>
      <button disabled={!online || busy} onClick={commit}>Подтвердить перенос</button>
    </div>}
    {result && <p aria-live="polite">{result}</p>}
    {failure && <p role="alert">{failure}</p>}
  </details>;
}
