import { ArrowDownLeft, ArrowLeftRight, Receipt, ShoppingBag, TrendingUp } from "lucide-react";
import { Modal } from "./ui.jsx";

export function QuickActionSheet({ open, onClose, onPurchase, onSale, onGo }) {
  const openFinance = () => { onClose(); onGo("finance"); };
  return (
    <Modal open={open} onClose={onClose} title="Новая операция" size="sm" mobileSheet={false}>
      <div className="pb-quick-actions">
        <QuickAction icon={ShoppingBag} title="Закупка телефона" description="Телефон на склад, деньги со счёта" onClick={onPurchase} />
        <QuickAction icon={TrendingUp} title="Продажа телефона" description="Деньги на счёт, прибыль сразу" onClick={onSale} />
        <div className="pb-quick-cash">
          <QuickAction icon={ArrowLeftRight} title="Перевод" description="Между счетами" onClick={openFinance} />
          <QuickAction icon={Receipt} title="Расход" description="Аренда, зарплата" onClick={openFinance} />
        </div>
        <button type="button" className="pb-action pb-action-secondary" onClick={openFinance}>
          <ArrowDownLeft size={16} />Пополнить счёт
        </button>
      </div>
    </Modal>
  );
}

function QuickAction({ icon: Icon, title, description, onClick }) {
  return (
    <button type="button" className="pb-action pb-action-secondary pb-quick-action" onClick={onClick}>
      <Icon size={19} aria-hidden="true" />
      <span><strong>{title}</strong><small>{description}</small></span>
    </button>
  );
}
