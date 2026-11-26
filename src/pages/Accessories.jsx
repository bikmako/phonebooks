/**
 * Склад и продажи аксессуаров.
 *
 * Компактный интерфейс склада; расчёты и операции остаются в domain/accessories.
 */
import { AccessoryPicker } from "../components/accessories/AccessoryPicker.jsx";
import "../styles/accessories.css";
import { AccessoryAdjustModal } from "../components/accessories/AccessoryAdjustModal.jsx";
import { AccessoryItemModal } from "../components/accessories/AccessoryItemModal.jsx";
import { AccessoryPurchaseModal } from "../components/accessories/AccessoryPurchaseModal.jsx";
import { AccessoryBatchHistoryModal } from "../components/accessories/BatchHistoryModal.jsx";
import {
  Button,
  Card,
  EmptyState,
  SearchInput,
  cx,
} from "../components/ui.jsx";
import {
  getAccessoryStats,
  getAccessoryStock,
  getLowStockItems,
  getTopAccessories,
} from "../domain/accessories.js";
import { useStore } from "../hooks/useStore.jsx";
import { PageTransition } from "../hooks/useTheme.jsx";
import {
  ACCESSORY_CATEGORY_ICONS,
  ACCESSORY_CATEGORY_LABELS,
} from "../utils/constants.js";
import {
  formatAmount,
  formatMoney,
  getPeriod,
  plural,
} from "../utils/format.js";
import {
  ArrowDownLeft,
  ArrowDownUp,
  ChevronDown,
  History,
  Package,
  Pencil,
  Plus,
  SlidersHorizontal,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import React from "react";

export function AccessoriesPage({ initialProduct } = {}) {
  const { data: s, period: t } = useStore(),
    [n, a] = React.useState(""),
    [c, r] = React.useState("all"),
    [i, o] = React.useState("all"),
    [l, d] = React.useState("low"),
    [x, v] = React.useState(() => {
      const item = s.accessoryItems.find(item => item.id === initialProduct);
      return { open: Boolean(item), item: item ?? null };
    }),
    [p, w] = React.useState(!1),
    [A, L] = React.useState(void 0),
    [O, m] = React.useState(null),
    [f, C] = React.useState(null),
    S = React.useMemo(() => getAccessoryStats(s, getPeriod(t)), [s, t]),
    g = React.useMemo(() => getTopAccessories(s, getPeriod(t), 3), [s, t]),
    b = React.useMemo(() => new Set(getLowStockItems(s).map((u) => u.id)), [s]),
    B = React.useMemo(() => {
      const u = new Set();
      for (const N of s.accessoryItems)
        N.compatibility && u.add(N.compatibility);
      return Array.from(u).sort();
    }, [s.accessoryItems]),
    y = React.useMemo(() => {
      const u = n.trim().toLowerCase();
      let N = s.accessoryItems.filter(
        (E) =>
          !(
            (u &&
              !E.name.toLowerCase().includes(u) &&
              !E.compatibility.toLowerCase().includes(u)) ||
            (c !== "all" && E.category !== c) ||
            (i !== "all" && E.compatibility !== i)
          ),
      );
      return (
        (N = N.slice().sort((E, R) => {
          if (l === "name") return E.name.localeCompare(R.name, "ru");
          if (l === "price") return R.salePrice - E.salePrice;
          const M = getAccessoryStock(s, E.id),
            G = getAccessoryStock(s, R.id);
          if (l === "stock") return G - M;
          const ee = b.has(E.id) ? 0 : 1,
            W = b.has(R.id) ? 0 : 1;
          return ee - W || M - G;
        })),
        N
      );
    }, [s, n, c, i, l, b]),
    j = (u) => {
      (L(u), w(!0));
    };
  const [statsOpen, setStatsOpen] = React.useState(() =>
    window.matchMedia("(min-width: 1024px)").matches,
  );
  const statsId = React.useId();
  const periodLabel = getPeriod(t).label;
  return (
    <PageTransition className="accessories-page">
      <section className="accessories-summary" aria-label="Краткая статистика аксессуаров">
        <Card className="accessories-stat">
          <p className="accessories-caption">Остатки на складе</p>
          <p className="accessories-stat-value">{formatMoney(S.stockValue)}</p>
          <p className="accessories-note">
            {S.stockQty} шт. · {S.itemsCount} {plural(S.itemsCount, "товар", "товара", "товаров")}
          </p>
        </Card>
        <Card className="accessories-stat">
          <p className="accessories-caption">Выручка</p>
          <p className="accessories-stat-value">{formatMoney(S.revenue)}</p>
          <p className="accessories-note">{periodLabel}</p>
        </Card>
      </section>
      <Card className="accessories-details">
        <button
          type="button"
          id={`${statsId}-toggle`}
          className="accessories-details-toggle"
          aria-expanded={statsOpen}
          aria-controls={statsId}
          onClick={() => setStatsOpen((open) => !open)}
        >
          <span>Подробная статистика</span>
          <ChevronDown aria-hidden="true" className={statsOpen ? "is-open" : ""} />
        </button>
        <div
          id={statsId}
          role="region"
          aria-labelledby={`${statsId}-toggle`}
          aria-hidden={!statsOpen}
          {...(!statsOpen ? { inert: "" } : {})}
          className="accessories-details-region"
          data-open={statsOpen}
        >
          <div className="accessories-details-clip">
            <div className="accessories-details-content">
              <div className="accessories-detail-metrics">
                <div>
                  <p className="accessories-caption">Продано</p>
                  <p className="accessories-detail-value">{S.soldQty} шт.</p>
                  <p className="accessories-note">{S.receipts} {plural(S.receipts, "чек", "чека", "чеков")}</p>
                </div>
                <div>
                  <p className="accessories-caption">Прибыль</p>
                  <p className={cx("accessories-detail-value", S.profit < 0 ? "text-red-500" : "text-emerald-600")}>
                    {formatMoney(S.profit)}
                  </p>
                  <p className="accessories-note">{periodLabel}</p>
                </div>
              </div>
              <div className="accessories-detail-lists">
                <div>
                  <h3 className="accessories-caption">Заканчиваются · {S.lowStockCount}</h3>
                  {S.lowStockCount > 0 ? (
                    <ul className="accessories-ranking accessories-low-stock">
                      {s.accessoryItems.filter((item) => b.has(item.id)).map((item) => (
                        <li key={item.id}>
                          <span>{item.name}</span>
                          <b className="text-amber-600">{getAccessoryStock(s, item.id)} шт.</b>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="accessories-note">Все товары в достатке</p>}
                </div>
                <div>
                  <h3 className="accessories-caption">Топ аксессуаров за период</h3>
                  {g.length > 0 ? (
                    <ol className="accessories-ranking">
                      {g.map((item) => (
                        <li key={item.itemId}>
                          <span>{item.name}</span>
                          <span className="accessories-ranking-totals">
                            <b>{item.qty} шт.</b>
                            <span className={item.profit < 0 ? "text-red-500" : "text-emerald-600"}>
                              {item.profit > 0 ? "+" : ""}{formatAmount(item.profit)} ₽
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="accessories-note">За этот период продаж пока нет</p>}
                </div>
              </div>
              <p className="accessories-period-note">
                <TrendingUp aria-hidden="true" /> Период продаж выбирается на Главной.
              </p>
            </div>
          </div>
        </div>
      </Card>
      <div className="accessories-actions" role="group" aria-label="Управление товарами">
        <Button
          variant="secondary"
          icon={<ArrowDownLeft aria-hidden="true" className="h-4 w-4" />}
          onClick={() => j()}
        >
          Поступление
        </Button>
        <Button
          icon={<Plus aria-hidden="true" className="h-4 w-4" />}
          onClick={() => v({ open: !0, item: null })}
        >
          Добавить товар
        </Button>
      </div>
      <section className="accessories-filters" aria-label="Поиск и фильтры аксессуаров">
        <div className="accessories-search-row">
          <SearchInput value={n} onChange={a} placeholder="Поиск по названию" />
          <AccessoryPicker
            title="Сортировка"
            value={l}
            onChange={d}
            icon={<ArrowDownUp aria-hidden="true" />}
            options={[
              { value: "low", label: "Заканчивающиеся сначала" },
              { value: "name", label: "По названию" },
              { value: "stock", label: "По остатку" },
              { value: "price", label: "По цене" },
            ]}
          />
        </div>
        <div className="accessories-filter-row">
          <AccessoryPicker
            title="Категория"
            value={c}
            onChange={r}
            options={[
              { value: "all", label: "Все категории" },
              ...Object.entries(ACCESSORY_CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <AccessoryPicker
            title="Совместимость"
            value={i}
            onChange={o}
            disabled={B.length === 0}
            options={[
              { value: "all", label: "Совместимость" },
              ...B.map((value) => ({ value, label: value })),
            ]}
          />
        </div>
      </section>
      <div className="accessories-list-heading">
        <h2>Товары на складе</h2>
        <span aria-live="polite">{y.length} из {s.accessoryItems.length}</span>
      </div>
      {y.length === 0 ? (
        <EmptyState
          icon={<Package className="h-6 w-6" />}
          title={
            s.accessoryItems.length === 0
              ? "Аксессуаров пока нет"
              : "Ничего не найдено"
          }
          description={
            s.accessoryItems.length === 0
              ? "Добавьте первый товар или проведите поступление — и он появится на складе."
              : "Измените поиск или фильтры."
          }
          action={
            s.accessoryItems.length === 0 ? (
              <Button
                icon={<Plus className="h-4 w-4" />}
                onClick={() =>
                  v({
                    open: !0,
                    item: null,
                  })
                }
              >
                Добавить товар
              </Button>
            ) : (
              void 0
            )
          }
        />
      ) : (
        <div className="accessories-products">
          {y.map((u) => {
            const N = getAccessoryStock(s, u.id),
              E = ACCESSORY_CATEGORY_ICONS[u.category],
              R = b.has(u.id);
            return (
              <article className="accessories-product card" key={u.id} aria-label={u.name}>
                <div className="accessories-product-info">
                  <div className="accessories-product-icon"><E aria-hidden="true" /></div>
                  <div className="accessories-product-description">
                    <h3>{u.name}</h3>
                    <p className="accessories-product-meta">
                      <span>{ACCESSORY_CATEGORY_LABELS[u.category]}</span>
                      {u.compatibility && <span>{u.compatibility}</span>}
                      {u.color && <span>{u.color}</span>}
                    </p>
                  </div>
                </div>
                <div className="accessories-product-numbers">
                  <div>
                    <p className="accessories-caption">Остаток</p>
                    <p className={cx("accessories-stock", R && (N <= 0 ? "text-red-500" : "text-amber-600"))}>
                      {N} <span>шт.</span>
                      {u.minStock > 0 && <small> / мин. {u.minStock}</small>}
                    </p>
                  </div>
                  <div className="accessories-product-price">
                    <p className="accessories-caption">Цена</p>
                    <p>{formatAmount(u.salePrice)} ₽</p>
                  </div>
                </div>
                {R && (
                  <p className={cx("accessories-stock-warning", N <= 0 ? "text-red-500" : "text-amber-600")}>
                    <TriangleAlert aria-hidden="true" />
                    {N <= 0 ? "Закончились" : "Заканчивается"}
                  </p>
                )}
                <div className="accessories-product-actions" role="group" aria-label={`Действия: ${u.name}`}>
                  <Button size="sm" variant="secondary" icon={<Plus aria-hidden="true" />} onClick={() => j(u.id)}>
                    Поступление
                  </Button>
                  <Button size="sm" variant="secondary" icon={<SlidersHorizontal aria-hidden="true" />} onClick={() => m(u)}>
                    Количество
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="История" title="История" icon={<History aria-hidden="true" />} onClick={() => C(u)}>
                    <span className="accessories-action-label">История</span>
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Изменить" title="Изменить" icon={<Pencil aria-hidden="true" />} onClick={() => v({ open: !0, item: u })}>
                    <span className="accessories-action-label">Изменить</span>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {S.lowStockCount > 0 && (
        <p className="flex items-center gap-1.5 pb-1 text-[12px] text-amber-600">
          <TriangleAlert className="h-3.5 w-3.5" />
          {S.lowStockCount}{" "}
          {plural(
            S.lowStockCount,
            "товар заканчивается",
            "товара заканчиваются",
            "товаров заканчиваются",
          )}
          {" — пополните склад."}
        </p>
      )}
      <AccessoryItemModal
        open={x.open}
        item={x.item}
        onClose={() =>
          v({
            open: !1,
            item: null,
          })
        }
      />
      <AccessoryPurchaseModal open={p} presetItemId={A} onClose={() => w(!1)} />
      <AccessoryAdjustModal open={!!O} item={O} onClose={() => m(null)} />
      <AccessoryBatchHistoryModal open={!!f} item={f} onClose={() => C(null)} />
    </PageTransition>
  );
}
