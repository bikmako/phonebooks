import React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Modal, cx } from "../ui.jsx";

// Native filters retain the iOS picker and keyboard behavior. The visible label
// wraps independently of the native select, which otherwise clips long values.
// Sorting uses the existing modal's viewport handling and scroll lock.
export function AccessoryPicker({ title, value, options, onChange, disabled, icon }) {
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef(null);
  const selected = options.find((option) => option.value === value);
  const close = React.useCallback(() => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }, []);

  if (!icon) return (
    <label className={cx("accessories-picker accessories-native-picker", disabled && "is-disabled")}>
      <span>{selected?.label}</span>
      <ChevronDown aria-hidden="true" />
      <select
        aria-label={title}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="accessories-picker accessories-sort"
        aria-label={`${title}: ${selected?.label ?? ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${title}: ${selected?.label ?? ""}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {icon}
      </button>
      <Modal open={open} onClose={close} title={title} size="sm">
        <div className="accessories-options">
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              aria-pressed={option.value === value}
              onClick={() => { onChange(option.value); close(); }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check aria-hidden="true" />}
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
