import { STORAGE_PREFIX } from "../config.js";
/**
 * Тема оформления и переключатели темы.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { cx } from "../components/ui.jsx";
import { Monitor, Moon, Sun } from "lucide-react";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export function PageTransition({ children: s, className: t }) {
  return <div className={cx("animate-fade-up", t)}>{s}</div>;
}
export const THEME_KEY = STORAGE_PREFIX + "theme";
export function getTheme() {
  try {
    const s = localStorage.getItem(THEME_KEY);
    return s === "light" || s === "dark" ? s : "system";
  } catch {
    return "system";
  }
}
export function isSystemDark() {
  return (
    typeof window < "u" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}
export function resolveTheme(s) {
  return s === "system" ? (isSystemDark() ? "dark" : "light") : s;
}
export function applyTheme(s) {
  const t = resolveTheme(s),
    n = document.documentElement;
  (n.classList.toggle("dark", t === "dark"), (n.style.colorScheme = t));
  const a = document.querySelector('meta[name="theme-color"]');
  a && a.setAttribute("content", t === "dark" ? "#0b1220" : "#f5f7fb");
}
export function setThemePreference(s) {
  try {
    s === "system"
      ? localStorage.removeItem(THEME_KEY)
      : localStorage.setItem(THEME_KEY, s);
  } catch {}
  applyTheme(s);
}
export function initTheme() {
  (applyTheme(getTheme()),
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        getTheme() === "system" && applyTheme("system");
      }));
}
export function ThemeToggle({ className: s }) {
  const [t, n] = React.useState(() => getTheme());
  React.useEffect(() => {
    applyTheme(t);
    const i = window.matchMedia("(prefers-color-scheme: dark)"),
      o = () => {
        t === "system" && applyTheme("system");
      };
    return (
      i.addEventListener("change", o),
      () => i.removeEventListener("change", o)
    );
  }, [t]);
  const a = t === "light" ? "dark" : t === "dark" ? "system" : "light",
    c = t === "light" ? Sun : t === "dark" ? Moon : Monitor,
    r =
      t === "light"
        ? "Светлая тема"
        : t === "dark"
          ? "Тёмная тема"
          : "Как в системе";
  return (
    <button
      type="button"
      onClick={() => {
        (setThemePreference(a), n(a));
      }}
      aria-label={`${r}. Переключить`}
      title={r}
      className={cx(
        "btn-icon relative flex items-center justify-center text-ink-500 transition-colors active:bg-slate-100",
        s,
      )}
    >
      {jsx(c, {
        className: "h-[19px] w-[19px]",
      })}
    </button>
  );
}
export function ThemePicker() {
  const [s, t] = React.useState(() => getTheme()),
    n = [
      {
        id: "light",
        label: "Светлая",
        icon: Sun,
      },
      {
        id: "dark",
        label: "Тёмная",
        icon: Moon,
      },
      {
        id: "system",
        label: "Системная",
        icon: Monitor,
      },
    ];
  return (
    <div
      className="grid grid-cols-3 gap-2"
      role="radiogroup"
      aria-label="Тема оформления"
    >
      {n.map((a) => {
        const c = a.icon,
          r = s === a.id;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={r}
            onClick={() => {
              (setThemePreference(a.id), t(a.id));
            }}
            className={cx(
              "flex min-h-[52px] flex-col items-center justify-center gap-1.5 rounded-xl border text-[12px] font-medium transition-all",
              r
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-slate-200 bg-white text-ink-500 active:bg-slate-50",
            )}
            key={a.id}
          >
            {jsx(c, {
              className: cx("h-4.5 w-4.5", r && "text-brand-600"),
            })}
            {a.label}
          </button>
        );
      })}
    </div>
  );
}
