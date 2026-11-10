/**
 * Проверка целостности данных.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { getAccountBalance } from "../utils/calculations.js";
import { formatMoney } from "../utils/format.js";
export function checkDataIntegrity(state) {
  const t = [],
    n = new Map();
  for (const i of state.phones)
    i.imei && n.set(i.imei, (n.get(i.imei) ?? 0) + 1);
  for (const [i, o] of n)
    o > 1 &&
      t.push({
        level: "error",
        message: `IMEI ${i} встречается ${o} раза`,
      });
  const a = new Set();
  for (const i of state.sales) {
    if (i.status !== "completed") continue;
    (a.has(i.phoneId) &&
      t.push({
        level: "error",
        message: `Телефон ${i.phoneId} продан дважды`,
      }),
      a.add(i.phoneId));
    const o = state.phones.find((l) => l.id === i.phoneId);
    o
      ? o.status !== "sold" &&
        t.push({
          level: "warning",
          message: `Телефон ${o.model} продан, но статус «${o.status}»`,
        })
      : t.push({
          level: "error",
          message: `Продажа ${i.id} ссылается на удалённый телефон`,
        });
  }
  for (const i of state.phones)
    (i.status === "sold" &&
      !a.has(i.id) &&
      t.push({
        level: "warning",
        message: `${i.model} помечен проданным без операции продажи`,
      }),
      i.purchasePrice < 0 &&
        t.push({
          level: "error",
          message: `${i.model}: отрицательная закупочная цена`,
        }));
  for (const i of state.accounts.map((o) => ({
    a: o,
    bal: getAccountBalance(state, o.id),
  })))
    i.bal < -0.01 &&
      t.push({
        level: "error",
        message: `Отрицательный остаток на счёте «${i.a.name}»: ${formatMoney(i.bal)}`,
      });
  const c = new Set(state.accessoryItems.map((i) => i.id)),
    r = new Map();
  for (const i of state.accessoryBatches) {
    if (!c.has(i.itemId)) {
      t.push({
        level: "error",
        message: `Партия ${i.id} ссылается на удалённый товар`,
      });
      continue;
    }
    (r.set(i.itemId, (r.get(i.itemId) ?? 0) + i.qtyLeft),
      i.qty <= 0 &&
        t.push({
          level: "error",
          message: `Партия товара: некорректное количество ${i.qty}`,
        }),
      i.qtyLeft < -0.001 &&
        t.push({
          level: "error",
          message: `Партия товара: отрицательный остаток ${i.qtyLeft}`,
        }));
  }
  for (const [i, o] of r)
    if (o < -0.001) {
      const l = state.accessoryItems.find((d) => d.id === i);
      t.push({
        level: "error",
        message: `«${(l == null ? void 0 : l.name) ?? i}»: остаток ушёл в минус (${o})`,
      });
    }
  for (const i of state.accessorySales)
    for (const o of i.items)
      c.has(o.itemId) &&
        o.qty <= 0 &&
        t.push({
          level: "error",
          message: `Продажа ${i.id}: некорректное количество в позиции «${o.name}»`,
        });
  return t;
}
