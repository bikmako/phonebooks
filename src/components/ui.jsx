/**
 * Базовые UI-компоненты.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { ChevronDown, LoaderCircle, TriangleAlert, X } from "lucide-react";
import React from "react";
import { createPortal } from "react-dom";
import "../styles/modal.css";
import { jsx, jsxs } from "react/jsx-runtime";
export function cx(...s) {
  return s.filter(Boolean).join(" ");
}
export const BUTTON_VARIANTS = {
    primary: "btn-primary",
    secondary: "btn-secondary",
    ghost: "btn-ghost",
    danger: "btn-danger",
    success: "btn-success",
    soft: "btn bg-brand-50 text-brand-700 hover:bg-brand-100",
  },
  BUTTON_SIZES = {
    sm: "btn-sm",
    md: "btn-md",
    lg: "btn-lg",
  };
export function Button({
  variant: s = "primary",
  size: t = "md",
  loading: n,
  icon: a,
  className: c,
  children: r,
  ...i
}) {
  return (
    <button
      {...i}
      disabled={i.disabled || n}
      className={cx(BUTTON_VARIANTS[s], BUTTON_SIZES[t], c)}
    >
      {n ? <LoaderCircle className="h-4 w-4 animate-spin" /> : a}
      {r}
    </button>
  );
}
export function Card({ className: s, children: t }) {
  return <div className={cx("card", s)}>{t}</div>;
}
export function CardHeader({ title: s, subtitle: t, action: n, className: a }) {
  return (
    <div className={cx("flex items-start justify-between gap-3", a)}>
      <div>
        <h2 className="text-[15px] font-semibold text-ink-900">{s}</h2>
        {t && <p className="mt-0.5 text-[12.5px] text-ink-500">{t}</p>}
      </div>
      {n}
    </div>
  );
}
export function Chip({ children: s, tone: t = "neutral", className: n }) {
  const a = {
    neutral: "bg-slate-100 text-ink-700",
    success: "bg-emerald-50 text-emerald-700",
    danger: "bg-red-50 text-red-600",
    warning: "bg-amber-50 text-amber-700",
    info: "bg-brand-50 text-brand-700",
    violet: "bg-violet-50 text-violet-700",
  };
  return <span className={cx("chip whitespace-nowrap", a[t], n)}>{s}</span>;
}
export function EmptyState({ icon: s, title: t, description: n, action: a }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-500 text-white shadow-lg shadow-brand-500/25">
        {s}
      </div>
      <p className="text-[15px] font-semibold text-ink-900">{t}</p>
      {n && (
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-500">
          {n}
        </p>
      )}
      {a && <div className="mt-4">{a}</div>}
    </div>
  );
}
export function Field({
  label: s,
  hint: t,
  error: n,
  required: a,
  children: c,
  className: r,
  htmlFor: i,
}) {
  return (
    <div className={r}>
      {s && (
        <label className="label" htmlFor={i}>
          {s}
          {a && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {c}
      {n ? (
        <p className="mt-1.5 flex items-center gap-1 text-[12px] font-medium text-red-600">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          {n}
        </p>
      ) : (
        t && <p className="mt-1.5 text-[12px] text-ink-400">{t}</p>
      )}
    </div>
  );
}
export function Input({ className: s, invalid: t, ...n }) {
  return (
    <input
      {...n}
      className={cx(
        "input",
        t && "border-red-300 focus:border-red-400 focus:ring-red-500/10",
        s,
      )}
    />
  );
}
export function Textarea({ className: s, ...t }) {
  return <textarea {...t} className={cx("textarea min-h-[84px]", s)} />;
}
export function Select({ className: s, children: t, ...n }) {
  return (
    <div className={cx("relative", s)}>
      <select {...n} className={cx("input appearance-none pr-10", s)}>
        {t}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
    </div>
  );
}
export function SegmentedTabs({
  options: s,
  value: t,
  onChange: n,
  size: a = "md",
  className: c,
  fullWidth: r,
}) {
  return (
    <div
      className={cx(
        "inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1",
        r && "no-scrollbar w-full overflow-x-auto",
        c,
      )}
      role="tablist"
    >
      {s.map((i) => (
        <button
          role="tab"
          aria-selected={t === i.value}
          onClick={() => n(i.value)}
          className={cx(
            "flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150",
            r ? "min-w-0 flex-1" : "shrink-0",
            a === "sm"
              ? "h-8 px-2.5 text-[12.5px]"
              : "h-9 px-2 text-[12px] sm:px-3 sm:text-[13px]",
            t === i.value
              ? "bg-gradient-to-r from-brand-600 to-indigo-500 text-white shadow-md shadow-brand-600/25"
              : "text-ink-500 hover:text-ink-700 active:scale-[.98]",
          )}
          key={i.value}
        >
          {i.icon}
          {i.label}
        </button>
      ))}
    </div>
  );
}
export function Modal({
  open: s,
  onClose: t,
  title: n,
  description: a,
  children: c,
  footer: r,
  size: i = "md",
  mobileSheet: o = !0,
  hideClose: l,
}) {
  const d = React.useRef(null),
    x = React.useId();
  const overlay = React.useRef(null);
  React.useLayoutEffect(() => {
    if (!s) return;
    // Safari's visual viewport also changes when browser chrome / keyboard moves.
    const viewport = window.visualViewport;
    const updateViewport = () => {
      const node = overlay.current;
      if (!node || !viewport) return;
      node.style.setProperty("--modal-height", `${viewport.height}px`);
      node.style.setProperty("--modal-top", `${viewport.offsetTop}px`);
      node.style.setProperty("--modal-left", `${viewport.offsetLeft}px`);
      node.style.setProperty("--modal-width", `${viewport.width}px`);
    };
    updateViewport();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    // overflow:hidden alone does not lock the document on older iOS Safari.
    // Keep the page lock separate from the viewport overlay and its portal.
    const page = document.getElementById("root");
    const previous = page && { position: page.style.position, top: page.style.top, width: page.style.width };
    const scrollX = window.scrollX, scrollY = window.scrollY;
    if (page) {
      page.style.position = "fixed";
      page.style.top = `${-scrollY}px`;
      page.style.width = "100%";
    }
    return () => {
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      if (page) Object.assign(page.style, previous);
      window.scrollTo(scrollX, scrollY);
    };
  }, [s]);
  if (
    (React.useEffect(() => {
      if (!s) return;
      const p = (A) => {
        A.key === "Escape" && t();
      };
      document.addEventListener("keydown", p);
      const w = document.body.style.overflow;
      return (
        (document.body.style.overflow = "hidden"),
        setTimeout(() => {
          // A notification or input update must not steal focus from a user
          // who is already typing inside the dialog.
          if (d.current?.contains(document.activeElement)) return;
          var L;
          const A =
            (L = d.current) == null
              ? void 0
              : L.querySelector("input,select,textarea,button");
          A &&
            window.innerWidth >= 1024 &&
            A.focus({
              preventScroll: !0,
            });
        }, 60),
        () => {
          (document.removeEventListener("keydown", p),
            (document.body.style.overflow = w));
        }
      );
    }, [s, t]),
    !s)
  )
    return null;
  const v =
    i === "sm" ? "sm:max-w-md" : i === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg";
  return createPortal(
    <div ref={overlay} className="modal-overlay">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] animate-fade-in"
        onClick={t}
      />
      <div
        ref={d}
        role="dialog"
        aria-modal="true"
        aria-labelledby={x}
        className={cx(
          "relative w-full bg-white shadow-float animate-slide-up sm:animate-pop",
          v,
          "sm:rounded-2xl",
          o ? "rounded-t-3xl" : "rounded-t-2xl",
          "modal-panel flex flex-col overflow-hidden",
        )}
        style={{
          paddingBottom: "0px",
        }}
      >
        {o && (
          <div className="modal-fixed mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-200/80 sm:hidden" />
        )}
        <div className="modal-fixed flex items-start justify-between gap-4 px-5 pb-3 pt-4 sm:pt-5">
          <div className="min-w-0">
            <h2
              id={x}
              className="text-[17px] font-semibold leading-tight text-ink-900"
            >
              {n}
            </h2>
            {a && (
              <p className="mt-1 text-[13px] leading-snug text-ink-500">{a}</p>
            )}
          </div>
          {!l && (
            <button
              onClick={t}
              aria-label="Закрыть"
              className="btn-icon -mr-1 flex shrink-0 items-center justify-center text-ink-400 transition-colors hover:bg-slate-100 hover:text-ink-700"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="modal-content px-5 pb-4">
          {c}
        </div>
        {r && (
          <div
            className="modal-fixed modal-footer border-t border-slate-100 bg-white px-5 pt-3"
            style={{
              paddingBottom: "max(16px, env(safe-area-inset-bottom))",
            }}
          >
            {r}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
export function ConfirmDialog({
  open: s,
  onClose: t,
  onConfirm: n,
  title: a,
  description: c,
  confirmLabel: r = "Подтвердить",
  tone: i = "danger",
}) {
  return (
    <Modal
      open={s}
      onClose={t}
      title={a}
      description={c}
      size="sm"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={t}>
            Отмена
          </Button>
          <Button
            variant={i === "danger" ? "danger" : "primary"}
            className="flex-1"
            onClick={() => {
              (n(), t());
            }}
          >
            {r}
          </Button>
        </div>
      }
    >
      <div className="py-1" />
    </Modal>
  );
}
export function SearchInput({
  value: s,
  onChange: t,
  placeholder: n,
  className: a,
}) {
  return (
    <div className={cx("relative", a)}>
      <svg
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        value={s}
        onChange={(c) => t(c.target.value)}
        placeholder={n}
        type="search"
        className="input pl-10 pr-10"
        aria-label={n}
      />
      {s && (
        <button
          onClick={() => t("")}
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-400 hover:bg-slate-100"
          aria-label="Очистить поиск"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
export function Switch({ checked: s, onChange: t, label: n }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={s}
      aria-label={n}
      onClick={() => t(!s)}
      className={cx(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
        s ? "bg-brand-600" : "bg-slate-200",
      )}
    >
      <span
        className={cx(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          s ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}
