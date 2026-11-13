import React from 'react';
import { SELLER_CONTACT } from '../config.js';
import { Button, Modal } from './ui.jsx';
import '../styles/demo.css';

export function DemoBanner() {
  const [contactOpen, setContactOpen] = React.useState(false);
  return <>
    <div className="demo-banner" role="region" aria-label="Демонстрационная версия">
      <div className="demo-banner-copy"><strong className="demo-badge">ДЕМО</strong><span>Тестовые данные · для ознакомления</span></div>
      {SELLER_CONTACT
        ? <a className="demo-buy" href={SELLER_CONTACT} target="_blank" rel="noopener noreferrer">Купить полную версию</a>
        : <button className="demo-buy" type="button" onClick={() => setContactOpen(true)}>Купить полную версию</button>}
    </div>
    <Modal open={contactOpen} onClose={() => setContactOpen(false)} title="Полная версия PhoneBooks" footer={<Button onClick={() => setContactOpen(false)}>Понятно</Button>}>
      <p className="text-[13px] leading-relaxed text-ink-500">Для покупки обратитесь к продавцу, который предоставил вам эту демоверсию. Контакт продавца пока не указан.</p>
    </Modal>
  </>;
}
