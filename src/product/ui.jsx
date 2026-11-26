import React, { useEffect, useState } from 'react';
import {
  Asterisk, CalendarDays, ChartNoAxesCombined, ChevronDown, ChevronRight, Clock3,
  LayoutGrid, Plus, Settings, ShoppingBag, TrendingUp, UsersRound, Wrench,
} from 'lucide-react';
import { PERIOD_OPTIONS } from '../utils/constants.js';

const routes = [
  ['dashboard', 'Обзор', LayoutGrid],
  ['purchase', 'Скупка', ShoppingBag],
  ['sales', 'Продажи', TrendingUp],
  ['repairs', 'Ремонт', Wrench],
  ['finance', 'Финансы', ChartNoAxesCombined],
  ['history', 'История', Clock3],
  ['team', 'Команда', UsersRound],
  ['settings', 'Настройки', Settings],
];
export const routeName = id => routes.find(([key]) => key === id)?.[1] ?? 'Скупка';

export function Wordmark() {
  return <span className="pb-wordmark"><Asterisk aria-hidden="true" />PhoneBooks</span>;
}

export function PageTitle({ title, eyebrow, description, action }) {
  return <div className="pb-heading">
    <div>
      {eyebrow && <p className="pb-eyebrow">{eyebrow}</p>}
      <h1 className="pb-title">{title}</h1>
      {description && <p className="pb-description">{description}</p>}
    </div>
    {action}
  </div>;
}

export function AppShell({ route, navigate, mode, switchUrl, onSwitch, identity, enabled, onAdd, tools, children }) {
  const [more, setMore] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    function resize() {
      const editing = document.activeElement?.matches('input, textarea, [contenteditable=true]');
      setKeyboard(Boolean(editing && viewport.scale === 1 && window.innerHeight - viewport.height > 120));
    }
    viewport.addEventListener('resize', resize);
    return () => viewport.removeEventListener('resize', resize);
  }, []);
  const items = routes.filter(([id]) => enabled.includes(id));
  const current = route === 'accessories' ? 'purchase' : route;
  const mainRoutes = ['dashboard', 'purchase', 'finance'];
  const moreActive = !mainRoutes.includes(current);
  const modeLink = switchUrl && <a className="pb-mode-link" href={switchUrl} rel="noreferrer" onClick={onSwitch}>Перейти в {mode === 'Solo' ? 'Team' : 'Solo'}<ChevronRight size={15} /></a>;
  useEffect(() => {
    if (!more) return;
    function close(event) { if (event.key === 'Escape') setMore(false); }
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [more]);
  function button([id, label, Icon]) {
    return <button type="button" key={id} aria-current={current === id ? 'page' : undefined} onClick={() => {
      navigate(id);
      setMore(false);
    }}><Icon size={19} aria-hidden="true" /><span>{label}</span></button>;
  }
  return <div className={keyboard ? 'pb-shell pb-keyboard-open' : 'pb-shell'}>
    <aside className="pb-sidebar">
      <Wordmark />
      <nav className="pb-side-nav" aria-label="Основная навигация">{items.map(button)}</nav>
      <div className="pb-identity"><strong>{mode}</strong>{identity && <span>{identity}</span>}{modeLink}</div>
    </aside>
    <div className="pb-main">
      <header className="pb-topbar">
        <div className="pb-mobile-brand"><Wordmark /></div>
        <div className="pb-top-tools">{tools}<span className="pb-mode">{mode}</span></div>
      </header>
      <main className="pb-content" id="main-content">{children}</main>
    </div>
    {more && <div className="pb-more-layer">
      <button type="button" className="pb-more-backdrop" aria-label="Закрыть меню" onClick={() => setMore(false)} />
      <nav className="pb-more" id="pb-more" aria-label="Дополнительные разделы">
        {items.filter(([id]) => !mainRoutes.includes(id)).map(button)}{modeLink}
      </nav>
    </div>}
    <nav className="pb-bottom-nav" aria-label="Основная навигация">
      {items.filter(([id]) => ['dashboard', 'purchase'].includes(id)).map(button)}
      {onAdd && <button type="button" className="pb-add" onClick={() => { setMore(false); onAdd(); }} aria-label="Создать операцию"><Plus size={25} aria-hidden="true" /></button>}
      {items.filter(([id]) => id === 'finance').map(button)}
      <button type="button" className={moreActive ? 'pb-current' : ''} aria-expanded={more} aria-controls={more ? 'pb-more' : undefined} onClick={() => setMore(!more)}>
        <LayoutGrid size={19} aria-hidden="true" /><span>Ещё</span>
      </button>
    </nav>
  </div>;
}

export function PeriodSelect({ value, onChange }) {
  return <label className="pb-period">
    <CalendarDays size={16} aria-hidden="true" />
    <select aria-label="Период" value={value} onChange={event => onChange(event.target.value)}>
      {PERIOD_OPTIONS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
    </select>
    <ChevronDown size={14} aria-hidden="true" />
  </label>;
}

export function Metrics({ items }) {
  if (!items.length) return null;
  return <div className="pb-metrics">
    {items.map(({ label, value, detail, Icon, onClick }) => {
      const Element = onClick ? 'button' : 'div';
      return <Element className="pb-metric" key={label} {...(onClick ? { type: 'button', onClick } : {})}>
        {Icon && <Icon size={20} strokeWidth={1.7} aria-hidden="true" />}
        <span>{label}</span>
        <strong>{value}</strong>
        {detail}
      </Element>;
    })}
  </div>;
}

export function SectionTitle({ children, action }) {
  return <div className="pb-section-title"><h2>{children}</h2>{action}</div>;
}

export function Status({ children, tone = 'neutral' }) {
  return <span className={`pb-status pb-status-${tone}`}>{children}</span>;
}

