/**
 * Форматирование денег, дат, телефонов и периодов.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
export const moneyFormatter = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }),
  moneyFormatterPrecise = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function formatMoney(s, t) {
  const n = Number.isFinite(s) ? s : 0,
    a = Math.abs(n),
    c = moneyFormatter.format(a);
  return `${n < 0 ? "−" : ""}${c} ₽`;
}
export function formatAmount(s) {
  return Number.isFinite(s)
    ? Math.abs(s % 1) < 0.005
      ? moneyFormatter.format(s)
      : moneyFormatterPrecise.format(s)
    : "0";
}
export function formatCompactMoney(s) {
  const t = Math.abs(s);
  return t >= 1e6
    ? `${(s / 1e6).toFixed(t % 1e6 === 0 ? 0 : 1).replace(".", ",")} млн ₽`
    : t >= 1e4
      ? `${Math.round(s / 1e3)} тыс ₽`
      : formatMoney(s);
}
export function formatDate(s) {
  if (!s) return "";
  const t = parseDate(s);
  return t
    ? t
        .toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
        .replace(" г.", "")
    : s;
}
export function formatShortDate(s) {
  const t = parseDate(s);
  return t
    ? t.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
      })
    : s;
}
export function formatDateTime(s) {
  const t = new Date(s);
  return isNaN(t.getTime())
    ? s
    : `${t.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
      })} · ${t.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
}
export function parseDate(s) {
  if (!s) return null;
  const [t, n, a] = s.slice(0, 10).split("-").map(Number);
  return !t || !n || !a ? null : new Date(t, n - 1, a);
}
export function today() {
  return toISODate(new Date());
}
export function toISODate(s) {
  const t = s.getFullYear(),
    n = String(s.getMonth() + 1).padStart(2, "0"),
    a = String(s.getDate()).padStart(2, "0");
  return `${t}-${n}-${a}`;
}
export function addDays(s, t) {
  const n = new Date(s);
  return (n.setDate(n.getDate() + t), n);
}
export function daysBetween(s, t) {
  const n = parseDate(s),
    a = parseDate(t);
  return !n || !a
    ? 0
    : Math.max(0, Math.round((a.getTime() - n.getTime()) / 864e5));
}
export function formatPhoneInput(s) {
  const t = s.replace(/\D/g, ""),
    n = t.startsWith("8") ? `7${t.slice(1)}` : t;
  if (!n) return "";
  const c = (n.startsWith("7") ? n.slice(1) : n).slice(0, 10);
  let r = "+7";
  return (
    c.length > 0 && (r += ` ${c.slice(0, 3)}`),
    c.length > 3 && (r += ` ${c.slice(3, 6)}`),
    c.length > 6 && (r += `-${c.slice(6, 8)}`),
    c.length > 8 && (r += `-${c.slice(8, 10)}`),
    r
  );
}
export function plural(s, t, n, a) {
  const c = s % 10,
    r = s % 100;
  return c === 1 && r !== 11
    ? t
    : c >= 2 && c <= 4 && (r < 12 || r > 14)
      ? n
      : a;
}
export const roundMoney = (s) =>
  Math.round((Number.isFinite(s) ? s : 0) * 100) / 100;
export function getPeriod(s, t = today()) {
  const n = parseDate(t) ?? new Date();
  switch (s) {
    case "day":
      return {
        from: t,
        to: t,
        label: "Сегодня",
      };
    case "week":
      return {
        from: toISODate(addDays(n, -6)),
        to: t,
        label: "Последние 7 дней",
      };
    case "month":
      return {
        from: toISODate(addDays(n, -29)),
        to: t,
        label: "Последние 30 дней",
      };
    case "year":
      return {
        from: toISODate(addDays(n, -364)),
        to: t,
        label: "Последние 12 месяцев",
      };
    default:
      return {
        from: "2000-01-01",
        to: "2100-12-31",
        label: "Всё время",
      };
  }
}
export function getPreviousPeriod(s, t = today()) {
  if (s.from === "2000-01-01") return null;
  const n = parseDate(s.from);
  if (!n) return null;
  const a = daysBetween(s.from, s.to) + 1,
    c = parseDate(t) ?? new Date(),
    r = parseDate(s.to);
  let i = a;
  return (
    r && c < r && (i = Math.max(1, daysBetween(s.from, t) + 1)),
    {
      from: toISODate(addDays(n, -i)),
      to: toISODate(addDays(n, -1)),
      label: "Прошлый период",
    }
  );
}
export function inPeriod(s, t) {
  const n = s.slice(0, 10);
  return n >= t.from && n <= t.to;
}
