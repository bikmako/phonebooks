/**
 * Черновики форм в localStorage.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { today } from "./format.js";
export const DRAFT_PREFIX = "phonebooks.draft.";
const updateDrafts = new Map();
// Mounted new-purchase/new-sale forms supply their latest React state. Unlike
// the ordinary debounced save, update-time writes must report storage errors.
export function registerUpdateDraft(key, value) {
  updateDrafts.set(key, value);
  return () => updateDrafts.delete(key);
}
export function flushUpdateDrafts() {
  for (const [key, value] of updateDrafts) localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(value));
}
export function saveDraft(s, t) {
  try {
    t === null
      ? localStorage.removeItem(DRAFT_PREFIX + s)
      : localStorage.setItem(DRAFT_PREFIX + s, JSON.stringify(t));
  } catch {}
}
export function readDraft(s) {
  try {
    const t = localStorage.getItem(DRAFT_PREFIX + s);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}
export function clearDraft(s) {
  try {
    localStorage.removeItem(DRAFT_PREFIX + s);
  } catch {}
}
export const emptyPurchaseForm = (s) => ({
    model: "",
    storage: "128 ГБ",
    color: "",
    imei: "",
    condition: "good",
    kit: "Без комплекта",
    purchasePrice: "",
    plannedPrice: "",
    purchaseDate: today(),
    supplierName: "",
    supplierPhone: "",
    purchaseAccountId: s,
    purchasePaymentMethod: "cash",
    purchaseComment: "",
  }),
  PURCHASE_DRAFT_KEY = "phone-new";
