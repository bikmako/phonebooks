/**
 * Склад и продажи аксессуаров.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { AccessoryAdjustModal } from "../components/accessories/AccessoryAdjustModal.jsx";
import { AccessoryItemModal } from "../components/accessories/AccessoryItemModal.jsx";
import { AccessoryPurchaseModal } from "../components/accessories/AccessoryPurchaseModal.jsx";
import { AccessoryBatchHistoryModal } from "../components/accessories/BatchHistoryModal.jsx";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  SearchInput,
  Select,
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
  History,
  Package,
  Pencil,
  Plus,
  SlidersHorizontal,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export function AccessoriesPage() {
  const { data: s, period: t } = useStore(),
    [n, a] = React.useState(""),
    [c, r] = React.useState("all"),
    [i, o] = React.useState("all"),
    [l, d] = React.useState("low"),
    [x, v] = React.useState({
      open: !1,
      item: null,
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
  return (
    <PageTransition>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardHeader
          title="Товары на складе"
          subtitle="Остатки, цены и быстрые действия"
        />
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            variant="secondary"
            className="flex-1 sm:flex-none"
            icon={<ArrowDownLeft className="h-4 w-4" />}
            onClick={() => j()}
          >
            Поступление
          </Button>
          <Button
            className="flex-1 sm:flex-none"
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
        </div>
      </div>
      <div className="stagger grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Card className="card-pad">
          <p className="text-[11.5px] text-ink-500">Выручка</p>
          <p className="mt-0.5 text-[18px] font-bold tabular-nums text-ink-900">
            {formatMoney(S.revenue)}
          </p>
          <p className="text-[11px] text-ink-400">
            {"прибыль "}
            {formatMoney(S.profit)}
          </p>
        </Card>
        <Card className="card-pad">
          <p className="text-[11.5px] text-ink-500">Продано</p>
          <p className="mt-0.5 text-[18px] font-bold tabular-nums text-ink-900">
            {S.soldQty} {plural(S.soldQty, "штука", "штуки", "штук")}
          </p>
          <p className="text-[11px] text-ink-400">
            {S.receipts} {plural(S.receipts, "чек", "чека", "чеков")}
          </p>
        </Card>
        <Card className="card-pad">
          <p className="text-[11.5px] text-ink-500">Остатки на складе</p>
          <p className="mt-0.5 text-[18px] font-bold tabular-nums text-ink-900">
            {formatMoney(S.stockValue)}
          </p>
          <p className="text-[11px] text-ink-400">
            {S.stockQty}
            {" шт. · "}
            {S.itemsCount} {plural(S.itemsCount, "товар", "товара", "товаров")}
          </p>
        </Card>
        <Card className="card-pad">
          <p className="text-[11.5px] text-ink-500">Заканчиваются</p>
          <p
            className={cx(
              "mt-0.5 text-[18px] font-bold tabular-nums",
              S.lowStockCount ? "text-amber-600" : "text-ink-900",
            )}
          >
            {S.lowStockCount}
          </p>
          <p className="text-[11px] text-ink-400">ниже минимального остатка</p>
        </Card>
      </div>
      {g.length > 0 && (
        <Card className="card-pad">
          <p className="text-[12px] font-semibold text-ink-500">
            Топ аксессуаров за период
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {g.map((u) => (
              <Chip tone={u.profit >= 0 ? "success" : "danger"} key={u.itemId}>
                {u.name}
                {" · "}
                {u.qty}
                {" шт. · +"}
                {formatAmount(u.profit)}
                {" ₽"}
              </Chip>
            ))}
          </div>
        </Card>
      )}
      <div className="space-y-2.5">
        <SearchInput value={n} onChange={a} placeholder="Поиск по названию" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Select value={c} onChange={(u) => r(u.target.value)}>
            <option value="all">Все категории</option>
            {Object.keys(ACCESSORY_CATEGORY_LABELS).map((u) => (
              <option value={u} key={u}>
                {ACCESSORY_CATEGORY_LABELS[u]}
              </option>
            ))}
          </Select>
          <Select
            value={i}
            onChange={(u) => o(u.target.value)}
            disabled={B.length === 0}
          >
            <option value="all">Совместимость</option>
            {B.map((u) => (
              <option value={u} key={u}>
                {u}
              </option>
            ))}
          </Select>
          <Select
            value={l}
            onChange={(u) => d(u.target.value)}
            className="col-span-2 sm:col-span-1"
          >
            <option value="low">Заканчивающиеся сначала</option>
            <option value="name">По названию</option>
            <option value="stock">По остатку</option>
            <option value="price">По цене</option>
          </Select>
        </div>
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
        <div className="stagger space-y-2.5">
          {y.map((u) => {
            const N = getAccessoryStock(s, u.id),
              E = ACCESSORY_CATEGORY_ICONS[u.category],
              R = b.has(u.id);
            return (
              <Card className="card-pad" key={u.id}>
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <E className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-[14px] font-semibold text-ink-900">
                        {u.name}
                      </p>
                      {R && (
                        <Chip tone={N <= 0 ? "danger" : "warning"}>
                          <TriangleAlert className="mr-0.5 h-3 w-3" />
                          {N <= 0 ? "Закончились" : "Заканчивается"}
                        </Chip>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Chip tone="neutral">
                        {ACCESSORY_CATEGORY_LABELS[u.category]}
                      </Chip>
                      {u.compatibility && (
                        <Chip tone="info">{u.compatibility}</Chip>
                      )}
                      {u.color && <Chip tone="neutral">{u.color}</Chip>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-500">
                      <span>
                        {"Остаток: "}
                        <b
                          className={cx(
                            "tabular-nums",
                            R
                              ? N <= 0
                                ? "text-red-500"
                                : "text-amber-600"
                              : "text-ink-900",
                          )}
                        >
                          {N}
                          {" шт."}
                        </b>
                      </span>
                      <span>
                        {"Цена: "}
                        <b className="tabular-nums text-ink-900">
                          {formatAmount(u.salePrice)}
                          {" ₽"}
                        </b>
                      </span>
                      {u.minStock > 0 && (
                        <span className="text-ink-400">
                          {"мин. "}
                          {u.minStock}
                          {" шт."}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <Button
                    size="sm"
                    variant="success"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => j(u.id)}
                  >
                    Поступление
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
                    onClick={() => m(u)}
                  >
                    Количество
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<History className="h-3.5 w-3.5" />}
                    onClick={() => C(u)}
                  >
                    История
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() =>
                      v({
                        open: !0,
                        item: u,
                      })
                    }
                  >
                    Изменить
                  </Button>
                </div>
              </Card>
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
      {g.length > 0 && (
        <p className="flex items-center gap-1.5 pb-2 text-[11px] text-ink-400">
          <TrendingUp className="h-3 w-3" />
          {" Статистика за выбранный на Главной период."}
        </p>
      )}
    </PageTransition>
  );
}
