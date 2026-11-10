/**
 * Общие доменные помощники, ошибки и аудит.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { getAccountBalance } from "../utils/calculations.js";
import { formatMoney } from "../utils/format.js";
export class DomainError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "DomainError";
    this.field = field;
  }
}
export function makeId(s = "") {
  const t =
    typeof crypto < "u" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return s ? `${s}_${t}` : t;
}
export function nowISO() {
  return new Date().toISOString();
}
export const round2 = (s) =>
  Math.round((Number.isFinite(s) ? s : 0) * 100) / 100;
export function clean(s) {
  return (s ?? "").trim().replace(/\s+/g, " ");
}
export function assert(s, t, n) {
  if (!s) throw new DomainError(t, n);
}
export function assertPositive(s, t, n) {
  assert(Number.isFinite(s) && s > 0, `${t}: сумма должна быть больше нуля`, n);
}
export function assertNonNegative(s, t, n) {
  assert(Number.isFinite(s) && s >= 0, `${t}: некорректная сумма`, n);
}
export function getActiveAccount(state, t) {
  const n = state.accounts.find((a) => a.id === t);
  return (
    assert(n, "Выберите счёт или кассу", "accountId"),
    assert(!n.archived, `Счёт «${n.name}» архивирован`, "accountId"),
    n
  );
}
export function assertSufficientFunds(state, t, n, a) {
  if (!(n > 0)) return;
  const c = getAccountBalance(state, t),
    r = state.accounts.find((i) => i.id === t);
  if (c + 0.001 < n)
    throw new DomainError(
      `${a}: на счёте «${(r == null ? void 0 : r.name) ?? ""}» недостаточно средств (доступно ${formatMoney(c)}). Пополните счёт или выберите другой.`,
      "accountId",
    );
}
export function makeAuditEntry(state, t, n, a, c, r) {
  return {
    id: makeId("a"),
    at: nowISO(),
    action: t,
    entity: n,
    entityId: a,
    summary: c,
    details: r,
  };
}
export function withAudit(state, t) {
  return {
    ...state,
    audit: [t, ...state.audit].slice(0, 2e3),
  };
}
export const toNumber = (s) => {
  if (typeof s == "number") return s;
  const t = Number(
    String(s ?? "")
      .replace(/\s/g, "")
      .replace(",", "."),
  );
  return Number.isFinite(t) ? t : 0;
};
