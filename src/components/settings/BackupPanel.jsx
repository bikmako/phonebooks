import React from 'react';
import { Button, Card, CardHeader, Modal } from '../ui.jsx';
import { useStore } from '../../hooks/useStore.jsx';
import { downloadJson, readBackup } from '../../storage/db.js';
import { parseImportFile, MAX_FILE_BYTES, COLLECTIONS } from '../../storage/backupFormat.js';
import { listRecoveryCopies } from '../../storage/fullBackup.js';
import { checkDataIntegrity } from '../../domain/integrity.js';

const LABELS = ['Счета', 'Телефоны', 'Продажи', 'Расходы', 'Переводы', 'Кассовые операции', 'Журнал', 'Товары', 'Партии', 'Продажи аксессуаров'];
export function BackupPanel() {
  const store = useStore();
  const [plan, setPlan] = React.useState(null), [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false), [overwrite, setOverwrite] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false), [downloaded, setDownloaded] = React.useState(false);
  const [recoveries, setRecoveries] = React.useState([]);
  const currentPlan = React.useRef(null);
  React.useEffect(() => { listRecoveryCopies().then(setRecoveries).catch(e => setError(e.message)); }, [store.data]);
  React.useEffect(() => () => { if (currentPlan.current) store.cancelImport(currentPlan.current); }, [store.cancelImport]);
  const close = () => {
    if (busy) return;
    store.cancelImport(plan); currentPlan.current = null; setPlan(null); setError('');
  };
  const prepare = async parsed => {
    setBusy(true); setError('');
    try {
      const next = await store.beginImport(parsed);
      currentPlan.current = next; setPlan(next);
      setOverwrite(false); setAcknowledged(false); setDownloaded(false);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const read = async file => {
    if (!file) return;
    setError('');
    if (file.size > MAX_FILE_BYTES) { setError('Файл больше 32 МБ'); return; }
    setBusy(true);
    try {
      const parsed = parseImportFile(await file.text());
      if (parsed.error) throw new Error(parsed.error);
      await prepare(parsed);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const exportFile = async () => {
    setBusy(true); setError('');
    try { downloadJson(`phonebooks-full-${Date.now()}.json`, await store.exportBackup()); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const state = plan?.snapshot.indexedDB.state.find(x => x.key === 'current').value;
  const issues = state ? [
    ...checkDataIntegrity(state),
    ...state.sales.filter(sale => sale.status === 'cancelled' && !state.phones.some(phone => phone.id === sale.phoneId)).map(sale => ({ message: `Отменённая продажа ${sale.id}: телефон уже удалён; запись истории сохранится` })),
  ] : [];
  return <><Card className="card-pad">
    <CardHeader title="Резервные копии" subtitle="Полная локальная копия · формат 2 · без облака" />
    <p className="mt-2 text-[12px] text-ink-500">На другом адресе сайта база будет отдельной. Сохраните файл на Netlify, проверьте перенос и оставьте старую установку до завершения проверки. Копия содержит финансовые и личные данные; храните её в защищённом месте.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy || !!plan} onClick={exportFile}>Скачать полную копию</Button>
      <label className="btn-secondary btn-md">Загрузить из файла<input className="hidden" aria-label="Файл резервной копии" type="file" accept=".json,application/json" disabled={busy || !!plan} onChange={event => { void read(event.target.files?.[0]); event.target.value = ''; }} /></label>
      <Button variant="secondary" disabled={busy || !!plan} onClick={() => store.makeBackup('manual')}>Сделать точку восстановления</Button>
    </div>
    {error && <p role="alert" className="mt-2 text-red-500">{error}</p>}
    <details className="mt-3"><summary>Точки восстановления ({store.backups.length})</summary>
      {store.backups.map(backup => <div key={backup.id} className="mt-2 flex gap-2"><span>{backup.at} · {backup.phones} телефонов</span><Button size="sm" disabled={busy || !!plan} onClick={async () => {
        try { const data = await readBackup(backup.id); if (!data) throw new Error('Точка восстановления повреждена'); await prepare({ data, legacy: true }); }
        catch (e) { setError(e.message); }
      }}>Просмотреть</Button></div>)}
    </details>
    <details className="mt-3"><summary>Полные копии перед импортом ({recoveries.length})</summary>
      {recoveries.map(copy => <div key={copy.id} className="mt-2 flex gap-2"><span>{copy.at}</span><Button size="sm" disabled={busy || !!plan} onClick={() => prepare({ snapshot: copy.snapshot })}>Просмотреть</Button></div>)}
    </details>
    </Card>
    <Modal open={!!plan} title="Предварительный просмотр импорта" onClose={close} footer={<div className="flex flex-col gap-2 sm:flex-row">
      <Button variant="secondary" disabled={busy} onClick={close}>Отмена без записи</Button>
      <Button disabled={busy || !overwrite || !acknowledged || !downloaded} onClick={async () => {
        setBusy(true); setError('');
        try {
          await store.finishImport(plan, { confirmed: acknowledged, overwriteConfirmed: overwrite, saveBackup: async backup => downloadJson(`phonebooks-before-import-${Date.now()}.json`, backup) });
          currentPlan.current = null; setPlan(null);
          // Reload to apply theme and discard any mounted form drafts.
          location.reload();
        } catch (e) {
          store.cancelImport(plan); currentPlan.current = null; setPlan(null);
          setError(e.message);
        } finally { setBusy(false); }
      }}>{busy ? 'Записываю…' : 'Подтвердить импорт'}</Button>
    </div>}>
      {plan && <div className="space-y-3">
        <p>{plan.legacy ? 'Старая копия: только состояние базы. Тема останется текущей, черновики будут очищены; прежние черновики сохранятся в предварительной полной копии.' : 'Полная копия: состояние, точки восстановления, метаданные, тема и черновики.'}</p>
        <table><thead><tr><th>Раздел</th><th>Сейчас</th><th>В файле</th></tr></thead><tbody>{COLLECTIONS.map((name, i) => <tr key={name}><td>{LABELS[i]}</td><td>{store.data[name].length}</td><td>{state[name].length}</td></tr>)}</tbody></table>
        <p>Точек в файле: {plan.snapshot.indexedDB.backups.length}; ключей localStorage: {plan.snapshot.localStorage.length}. Бизнес: {state.settings.businessName}; валюта: {state.settings.currency}.</p>
        {issues.length > 0 && <div role="status"><p>Замечания к учёту ({issues.length}); импорт сохранит их без исправления:</p><ul>{issues.slice(0, 10).map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></div>}
        <Button variant="secondary" disabled={busy} onClick={async () => {
          try {
            downloadJson(`phonebooks-before-import-${Date.now()}.json`, await store.exportBackup()); setDownloaded(true);
          } catch (e) { setError(e.message); }
        }}>Скачать предварительную полную копию</Button>
        <label className="flex gap-2"><input type="checkbox" checked={acknowledged} disabled={!downloaded || busy} onChange={e => setAcknowledged(e.target.checked)} />Я сохранил предварительную копию и подтверждаю импорт</label>
        <label className="flex gap-2"><input type="checkbox" checked={overwrite} disabled={busy} onChange={e => setOverwrite(e.target.checked)} />Отдельно разрешаю заменить существующие данные, тему и черновики</label>
        <p>До подтверждения можно отменить импорт без записи. Перед заменой полная копия дополнительно сохранится внутри приложения.</p>
      </div>}
    </Modal>
  </>;
}
