import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cx } from "../components/ui.jsx";

export const THEME_KEY = "phonebooks.theme";
const themeEvent = "phonebooks:theme";
const preferences = [
  { id: "system", label: "Системная", title: "Как в системе", icon: Monitor },
  { id: "light", label: "Светлая", title: "Светлая тема", icon: Sun },
  { id: "dark", label: "Тёмная", title: "Тёмная тема", icon: Moon },
];

export function PageTransition({ children, className }) {
  return <div className={cx("animate-fade-up", className)}>{children}</div>;
}

export function getTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function isSystemDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(value) {
  return value === "system" ? (isSystemDark() ? "dark" : "light") : value;
}

export function applyTheme(value) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolveTheme(value) === "dark");
  const bg = getComputedStyle(root).getPropertyValue("--pb-bg").trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
}

export function setThemePreference(value) {
  try {
    if (value === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, value);
  } catch {}
  applyTheme(value);
  window.dispatchEvent(new Event(themeEvent));
}

function onThemeStorage(event) {
  if (!event.key || event.key === THEME_KEY) applyTheme(getTheme());
}

export function initTheme() {
  applyTheme(getTheme());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getTheme() === "system") applyTheme("system");
  });
  window.addEventListener("storage", onThemeStorage);
}

function subscribe(callback) {
  window.addEventListener(themeEvent, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(themeEvent, callback);
    window.removeEventListener("storage", callback);
  };
}

export function ThemeToggle({ className }) {
  const value = useSyncExternalStore(subscribe, getTheme);
  const index = preferences.findIndex(option => option.id === value);
  const { icon: Icon, title } = preferences[index];
  return (
    <button type="button" onClick={() => setThemePreference(preferences[(index + 1) % preferences.length].id)}
      aria-label={title + ". Переключить"} title={title} className={cx("pb-icon-button", className)}>
      <Icon size={19} aria-hidden="true" />
    </button>
  );
}

export function ThemePicker() {
  const value = useSyncExternalStore(subscribe, getTheme);
  return (
    <div className="pb-tabs" role="radiogroup" aria-label="Тема оформления">
      {preferences.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => setThemePreference(id)}>
          <Icon size={16} aria-hidden="true" />{label}
        </button>
      ))}
    </div>
  );
}
