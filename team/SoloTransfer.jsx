import React, { useEffect, useRef, useState } from 'react';
import { prepareSoloTransfer, transferSource } from '../src/domain/soloTransfer.js';
import { base64Bytes, sha256Hex, TRANSFER_CHUNK_BYTES, TRANSFER_MAX_BYTES } from '../src/domain/transferWire.js';
import { MAX_FILE_BYTES } from '../src/storage/backupFormat.js';

const rubles = value => new Intl.NumberFormat('ru', { style: 'currency', currency: 'RUB' }).format(value / 100);

export function SoloTransfer({ scope, online, api, onImported }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [failure, setFailure] = useState('');
  const [active, setActive] = useState(null);
  const [progress, setProgress] = useState('');
  const stop = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const send = (action, input = {}) => api('cloud/transfer', { ...scope, action, ...input });

  async function inspect(file) {
    setPreview(null);
    setResult('');
    setFailure('');
    setProgress('');
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('Размер файла превышает предел формата резервной копии.');
      const source = transferSource(await file.text());
      const bytes = new TextEncoder().encode(JSON.stringify(source));
      if (bytes.length > TRANSFER_MAX_BYTES) throw new Error('Данные превышают предел переноса 12 МиБ. Исходная копия сохранена.');
      setPreview({ bytes, digest: await sha256Hex(bytes), summary: prepareSoloTransfer(source).summary });
    } catch (error) {
      setFailure(error.message);
    } finally {
      setBusy(false);
    }
  }

  function finish(reply) {
    setPreview(null);
    setActive(null);
    setProgress('');
    setResult(reply.replayed ? 'Сервер подтвердил ранее завершённый перенос.' : 'Сервер подтвердил перенос и сверку данных.');
    void onImported();
  }

  async function cancel(id) {
    const response = await send('cancel', { id });
    if (response.state === 'complete') finish(response.reply);
    else {
      setActive(null);
      setProgress('');
      setResult('Перенос отменён. Исходная копия сохранена.');
    }
  }

  async function commit() {
    if (!online || !preview) return;
    setBusy(true);
    setFailure('');
    setResult('');
    stop.current = false;
    try {
      const start = await send('start', { size: preview.bytes.length, digest: preview.digest });
      if (!mounted.current) return;
      if (start.state === 'complete') { finish(start.reply); return; }
      setActive(start.id);
      if (stop.current && start.id) { await cancel(start.id); return; }
      if (start.state === 'busy') {
        setFailure('Уже начат другой перенос. Выберите ту же копию или отмените незавершённую загрузку.');
        return;
      }
      const count = Math.ceil(preview.bytes.length / TRANSFER_CHUNK_BYTES);
      const received = new Set(start.received);
      setProgress('Проверено частей: ' + received.size + ' из ' + count + '.');
      for (let position = 0; position < count; position++) {
        if (!mounted.current) return;
        if (stop.current) { await cancel(start.id); return; }
        if (received.has(position)) continue;
        const bytes = preview.bytes.subarray(position * TRANSFER_CHUNK_BYTES, (position + 1) * TRANSFER_CHUNK_BYTES);
        const reply = await send('chunk', { id: start.id, position, data: base64Bytes(bytes), digest: await sha256Hex(bytes) });
        if (reply.state === 'complete') { finish(reply.reply); return; }
        if (reply.state === 'cancelled') { setResult('Загрузка завершилась без переноса. Начните её заново.'); setActive(null); setProgress(''); return; }
        received.add(position);
        setProgress('Проверено частей: ' + received.size + ' из ' + count + '.');
      }
      if (stop.current) { await cancel(start.id); return; }
      setProgress('Сервер сверяет копию и публикует результат одной транзакцией.');
      const reply = await send('commit', { id: start.id });
      if (reply.state === 'complete') finish(reply.reply);
      else { setResult('Загрузка завершилась без переноса. Начните её заново.'); setActive(null); setProgress(''); }
    } catch (error) {
      setFailure(error.status === 409
        ? 'Перенос остановлен. Пространство должно быть пустым, а остатки и суммы должны совпасть.'
        : error.status && error.status < 500 ? error.message : 'Подтверждение не получено. Повторите перенос той же копии после восстановления связи.');
    } finally {
      setBusy(false);
    }
  }

  async function stopTransfer() {
    stop.current = true;
    if (busy) return;
    setBusy(true);
    setFailure('');
    try { await cancel(active); }
    catch { setFailure('Отмена не подтверждена. Повторите её после восстановления связи.'); }
    finally { setBusy(false); }
  }

  return <details>
    <summary>Перенос из Solo</summary>
    <p>Скачайте полную копию в Solo. При разрыве связи выберите тот же файл и продолжите перенос в пустое пространство. Части копии хранятся до 24 часов.</p>
    <label>Резервная копия Solo<input type="file" accept=".json,application/json" disabled={busy} onChange={event => void inspect(event.target.files[0])} /></label>
    {preview && <div>
      <p>Карточки: {preview.summary.products}. В наличии: {preview.summary.units}. Резерв: {preview.summary.reserved}.</p>
      <p>Операции: {preview.summary.operations}. Записи истории: {preview.summary.audit}. Счета: {preview.summary.accounts}.</p>
      <p>Остатки счетов {rubles(preview.summary.cashMinor)} · Товарные остатки {rubles(preview.summary.stockCostMinor)}</p>
      <p>Выручка {rubles(preview.summary.revenueMinor)} · Валовая прибыль {rubles(preview.summary.grossProfitMinor)} · Чистая прибыль {rubles(preview.summary.netProfitMinor)}</p>
      <button disabled={!online || busy} onClick={commit}>Подтвердить перенос</button>
    </div>}
    {active && <button type="button" className="secondary" disabled={!online} onClick={stopTransfer}>Отменить перенос</button>}
    {progress && <p aria-live="polite">{progress}</p>}
    {result && <p aria-live="polite">{result}</p>}
    {failure && <p role="alert">{failure}</p>}
  </details>;
}
