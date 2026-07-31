import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";

const today = new Date().toISOString().slice(0, 10);

function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00+09:00`);
}

function formatDateValue(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateLabel(value: string) {
  const date = parseDate(value);
  return `${date.getFullYear()}/${`${date.getMonth() + 1}`.padStart(2, "0")}/${`${date.getDate()}`.padStart(2, "0")}`;
}

function addMonths(value: Date, amount: number) {
  const next = new Date(value);
  next.setMonth(next.getMonth() + amount);
  return next;
}

function sameDate(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function calendarDaysFor(value: Date) {
  const first = new Date(value.getFullYear(), value.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function DatePickerField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const rootRef = useRef<HTMLLabelElement>(null);
  const selectedDate = parseDate(value);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => parseDate(monthStart(value)));

  useEffect(() => {
    if (!open) setViewMonth(parseDate(monthStart(value)));
  }, [open, value]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <label className="date-picker-field" ref={rootRef}>
      <span>{label}</span>
      <button
        className="date-field"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <CalendarDays aria-hidden="true" />
        <strong>{formatDateLabel(value)}</strong>
      </button>
      {open ? (
        <div className="calendar-popover">
          <div className="calendar-header">
            <strong>
              {viewMonth.getFullYear()}年{viewMonth.getMonth() + 1}月
            </strong>
            <div>
              <button
                className="icon-button"
                onClick={() => setViewMonth((current) => addMonths(current, -1))}
                type="button"
                aria-label="前の月"
              >
                <span aria-hidden="true">‹</span>
              </button>
              <button
                className="icon-button"
                onClick={() => setViewMonth((current) => addMonths(current, 1))}
                type="button"
                aria-label="次の月"
              >
                <span aria-hidden="true">›</span>
              </button>
            </div>
          </div>
          <div className="calendar-weekdays" aria-hidden="true">
            {["日", "月", "火", "水", "木", "金", "土"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {calendarDaysFor(viewMonth).map((day) => {
              const inMonth = day.getMonth() === viewMonth.getMonth();
              const selected = sameDate(day, selectedDate);
              const isToday = sameDate(day, parseDate(today));
              return (
                <button
                  className={[
                    "calendar-day",
                    inMonth ? "" : "outside",
                    selected ? "selected" : "",
                    isToday ? "today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={formatDateValue(day)}
                  onClick={() => {
                    onChange(formatDateValue(day));
                    setOpen(false);
                  }}
                  type="button"
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          <button
            className="button button-secondary calendar-today"
            onClick={() => {
              onChange(today);
              setViewMonth(parseDate(monthStart(today)));
              setOpen(false);
            }}
            type="button"
          >
            今日
          </button>
        </div>
      ) : null}
    </label>
  );
}
