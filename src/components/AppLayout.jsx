import React from 'react';
import { Plus, Search } from 'lucide-react';
import { useStore } from '../hooks/useStore.jsx';
import { ThemeToggle } from '../hooks/useTheme.jsx';
import { AppShell, PageTitle, routeName } from '../product/ui.jsx';
import { UpdateNotice } from '../updates/UpdateNotice.jsx';
import { crossModeUrl } from '../utils/modeUrl.js';
import { demoTeamUrl, isDemo } from '../demo/mode.js';
import { DemoBanner } from '../demo/DemoBanner.jsx';

const enabled = ['dashboard', 'purchase', 'sales', 'repairs', 'finance', 'history', 'search', 'settings'];

export function AppLayout({ route, hideTitle, onNavigate, onQuickAction, children }) {
  const { data, saveState, prepareForUpdate, notify } = useStore();
  const teamUrl = isDemo ? demoTeamUrl : crossModeUrl(import.meta.env.VITE_PHONEBOOKS_TEAM_URL, window.location.origin);
  const dashboard = route === 'dashboard';
  async function switchMode(event) {
    event.preventDefault();
    let release;
    try {
      release = await prepareForUpdate();
      window.location.assign(teamUrl);
    } catch (error) {
      notify({ title: 'Не удалось перейти в Team', description: error.message, tone: 'error' });
    } finally {
      release?.();
    }
  }
  return <AppShell route={route} navigate={onNavigate} mode="Solo" identity={data.settings.businessName}
    enabled={enabled} switchUrl={teamUrl} onSwitch={switchMode} onAdd={onQuickAction} tools={<><button className="pb-icon-button" onClick={() => onNavigate('search')} aria-label="Глобальный поиск"><Search size={19} /></button><ThemeToggle /></>}>
    {isDemo ? <DemoBanner /> : <UpdateNotice />}
    {saveState === 'error' && <p className="pb-empty" role="alert">Не удалось сохранить изменения.</p>}
    {!hideTitle && <div className="pb-layout-heading"><PageTitle title={dashboard ? <><span className="pb-overview-wordmark">PhoneBooks</span><span className="pb-overview-label">Обзор</span></> : routeName(route)}
      eyebrow={dashboard ? 'Обзор' : undefined} description={dashboard ? 'Учёт скупки, продаж и ремонтов' : undefined}
      action={<button className="pb-action pb-desktop-add" type="button" onClick={onQuickAction}><Plus size={17} />Новая операция</button>} /></div>}
    <div key={route}>
      {['purchase', 'accessories', 'catalog'].includes(route) && <nav className="pb-tabs pb-stock-sections" aria-label="Разделы склада">
        <button aria-current={route === 'purchase' ? 'page' : undefined} onClick={() => onNavigate('purchase')}>Смартфоны</button>
        <button aria-current={route === 'accessories' ? 'page' : undefined} onClick={() => onNavigate('accessories')}>Аксессуары</button>
        <button aria-current={route === 'catalog' ? 'page' : undefined} onClick={() => onNavigate('catalog')}>Другие товары</button>
      </nav>}
      {children}
    </div>
  </AppShell>;
}
