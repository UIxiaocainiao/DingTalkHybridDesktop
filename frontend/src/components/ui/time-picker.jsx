import { Check, ChevronDown, Clock3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "./button";
import { cn } from "../../lib/utils";

const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES = Array.from({ length: 60 }, (_, index) => index);
const SECONDS = Array.from({ length: 60 }, (_, index) => index);

function pad(value) {
  return String(value).padStart(2, "0");
}

function parseTime(value) {
  const matched = String(value ?? "")
    .trim()
    .match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);

  if (!matched) {
    return {
      hour: 0,
      minute: 0,
      second: 0,
    };
  }

  return {
    hour: Number(matched[1]),
    minute: Number(matched[2]),
    second: Number(matched[3] ?? 0),
  };
}

function formatTime(parts, precision) {
  const base = `${pad(parts.hour)}:${pad(parts.minute)}`;
  return precision === "second" ? `${base}:${pad(parts.second)}` : base;
}

function TimeSelect({ label, value, onChange, options }) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <select
        value={String(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="flex h-10 w-full rounded-lg border border-input bg-background px-4 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {pad(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function TimePicker({
  value,
  onChange,
  precision = "minute",
  className,
  invalid = false,
  disabled = false,
}) {
  const rootRef = useRef(null);
  const normalizedValue = useMemo(() => parseTime(value), [value]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(normalizedValue);

  useEffect(() => {
    setDraft(normalizedValue);
  }, [normalizedValue]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!(event.target instanceof Node)) return;
      if (!rootRef.current?.contains(event.target)) {
        setDraft(normalizedValue);
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      setDraft(normalizedValue);
      setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [normalizedValue, open]);

  const displayValue = formatTime(normalizedValue, precision);

  const applyValue = () => {
    onChange?.(formatTime(draft, precision));
    setOpen(false);
  };

  const closeWithoutSaving = () => {
    setDraft(normalizedValue);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        className={cn(
          "h-10 w-full justify-between rounded-lg bg-muted/30 px-4 py-2 font-medium tabular-nums",
          invalid && "border-red-400 focus-visible:ring-red-300 dark:border-red-500 dark:focus-visible:ring-red-900",
        )}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Clock3 className="size-4 text-muted-foreground" />
          <span>{displayValue}</span>
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </Button>

      {open ? (
        <div className="absolute left-0 top-full z-[12000] mt-2 w-full min-w-[18rem] rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg">
          <div className={cn("grid gap-3", precision === "second" ? "grid-cols-3" : "grid-cols-2")}>
            <TimeSelect
              label="时"
              value={draft.hour}
              onChange={(nextHour) => setDraft((current) => ({ ...current, hour: nextHour }))}
              options={HOURS}
            />
            <TimeSelect
              label="分"
              value={draft.minute}
              onChange={(nextMinute) => setDraft((current) => ({ ...current, minute: nextMinute }))}
              options={MINUTES}
            />
            {precision === "second" ? (
              <TimeSelect
                label="秒"
                value={draft.second}
                onChange={(nextSecond) => setDraft((current) => ({ ...current, second: nextSecond }))}
                options={SECONDS}
              />
            ) : null}
          </div>

          <div className="mt-4 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            当前选择：<span className="font-medium text-foreground">{formatTime(draft, precision)}</span>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={closeWithoutSaving}>
              取消
            </Button>
            <Button type="button" size="sm" onClick={applyValue}>
              <Check className="size-4" />
              应用
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { TimePicker };
