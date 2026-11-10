/**
 * Начальное состояние базы (schemaVersion 1).
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { nowISO } from "../domain/shared.js";
export function createInitialState() {
  return {
    schemaVersion: 1,
    accounts: [
      {
        id: "ac_default_cash",
        name: "Касса",
        type: "cash",
        openingBalance: 0,
        color: "#10b981",
        archived: !1,
        createdAt: nowISO(),
      },
    ],
    phones: [],
    sales: [],
    expenses: [],
    transfers: [],
    cashOps: [],
    audit: [],
    settings: {
      businessName: "Моя скупка",
      currency: "RUB",
    },
    accessoryItems: [],
    accessoryBatches: [],
    accessorySales: [],
  };
}
