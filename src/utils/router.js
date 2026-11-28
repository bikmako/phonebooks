/**
 * Hash-роутинг приложения.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
export const ROUTES = [
  "dashboard",
  "purchase",
  "accessories",
  "catalog",
  "sales",
  "repairs",
  "finance",
  "history",
  "search",
  "settings",
];
export function parseHashRoute() {
  const s = window.location.hash.replace(/^#\/?/, ""),
    [t, n] = s.split("?"),
    a = ROUTES.includes(t) ? t : "dashboard",
    c = new URLSearchParams(n ?? "");
  return {
    route: a,
    action: c.get("action") ?? void 0,
    phoneId: c.get("product") ?? c.get("phone") ?? void 0,
  };
}
export function navigateTo(s, t) {
  const n = t ? "?" + new URLSearchParams({ product: t }) : "";
  window.location.hash = `/${s}${n}`;
}
