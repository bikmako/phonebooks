import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../hooks/useStore.jsx';
import { flushUpdateDrafts } from '../utils/drafts.js';
import { cleanupAfterBoot, deferUpdate, getSnapshot, installUpdate, subscribe } from './service.js';
import './updates.css';

export function UpdateNotice() {
  const update = React.useSyncExternalStore(subscribe, getSnapshot);
  const { prepareForUpdate } = useStore();
  const [slot, setSlot] = React.useState(null);
  React.useLayoutEffect(() => {
    if (!update.busy) return;
    const nodes = [...document.querySelectorAll('#root, .modal-overlay')];
    const previous = nodes.map(node => node.inert);
    nodes.forEach(node => { node.inert = true; });
    return () => nodes.forEach((node, index) => { node.inert = previous[index]; });
  }, [update.busy]);
  React.useEffect(() => {
    cleanupAfterBoot();
    const locate = () => setSlot([...document.querySelectorAll('[data-update-notice-slot]')].at(-1) || null);
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    locate();
    return () => observer.disconnect();
  }, []);
  if (!update.ready) return null;
  const install = () => {
    const openForm = document.querySelector('[role="dialog"], [data-update-dirty="true"]');
    if (openForm && !window.confirm('Открыта форма с возможными несохранёнными изменениями. Черновики новой покупки и продажи будут сохранены. Остальные несохранённые поля придётся заполнить заново. Обновить приложение?')) return;
    void installUpdate(async () => {
      // Strict synchronous writes: a quota error must prevent the reload.
      flushUpdateDrafts();
      return prepareForUpdate();
    });
  };
  const notice = <section className="update-notice" aria-label="Обновление PhoneBooks" aria-live="polite" aria-busy={update.busy}>
    <div className="update-copy">
      <p className="update-title">Доступно обновление</p>
      <p>Вышла новая версия PhoneBooks. Ваши данные сохранятся.</p>
      {update.error && <p role="alert">{update.error}</p>}
    </div>
    <div className="update-actions">
      <button className="btn-primary btn-sm" disabled={update.busy} onClick={install}>{update.busy ? 'Обновляю…' : 'Обновить'}</button>
      <button className="btn-secondary btn-sm" disabled={update.busy} onClick={deferUpdate}>Позже</button>
    </div>
  </section>;
  return slot ? createPortal(notice, slot) : notice;
}
