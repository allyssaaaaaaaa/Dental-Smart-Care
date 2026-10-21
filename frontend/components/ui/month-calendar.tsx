"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type MonthCalendarProps = {
  month: string;
  selectedDate: string;
  dayData: Record<string, {
    availableSlots?: number;
    appointmentCount?: number;
    markers?: Array<{ color: string; key: string; noShow?: boolean }>;
    noShowCount?: number;
  }>;
  mode: "availability" | "appointments";
  maxDate?: string;
  legendItems?: Array<{ color: string; label: string }>;
  onMonthChange: (month: string) => void;
  onSelectDate: (date: string) => void;
};

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthCalendar({
  month,
  selectedDate,
  dayData,
  mode,
  maxDate,
  legendItems,
  onMonthChange,
  onSelectDate,
}: MonthCalendarProps) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const monthName = new Date(year, monthNumber - 1, 1).toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
  });
  const cells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) return null;
    return `${month}-${String(day).padStart(2, "0")}`;
  });

  return (
    <section className="rounded-card border border-border bg-white p-4 shadow-card sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          className="rounded-btn p-2 text-slate hover:bg-page disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="font-heading text-[16px] font-semibold text-heading">{monthName}</h2>
        <button
          type="button"
          disabled={Boolean(maxDate && shiftMonth(month, 1) > maxDate.slice(0, 7))}
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          className="rounded-btn p-2 text-slate hover:bg-page disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {weekdays.map((weekday) => (
          <span key={weekday} className="py-2 text-[11px] font-semibold text-muted">
            {weekday}
          </span>
        ))}
        {cells.map((date, index) => {
          if (!date) return <span key={`blank-${index}`} />;
          const data = dayData[date];
          const hasAppointments = (data?.appointmentCount ?? 0) > 0;
          const withinDateRange = !maxDate || date <= maxDate;
          const available = withinDateRange && (mode === "appointments" || (data?.availableSlots ?? 0) > 0);
          const isSelected = date === selectedDate;
          return (
            <button
              key={date}
              type="button"
              disabled={!available}
              onClick={() => onSelectDate(date)}
              aria-pressed={isSelected}
              aria-label={mode === "appointments"
                ? `${date}, ${data?.appointmentCount ?? 0} appointments${data?.noShowCount ? `, ${data.noShowCount} no-show` : ""}`
                : date}
              className={`relative min-h-11 rounded-lg text-[13px] transition-colors ${
                isSelected
                  ? "bg-primary font-semibold text-white"
                  : available
                    ? "text-heading hover:bg-tint-2"
                    : "cursor-not-allowed text-slate/35"
              }`}
            >
              {Number(date.slice(-2))}
              {mode === "availability" && data?.availableSlots ? (
                <span className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${isSelected ? "bg-white" : "bg-success"}`} />
              ) : null}
              {mode === "appointments" && hasAppointments ? (
                <>
                  <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[9px] font-bold ${isSelected ? "text-white" : "text-primary"}`}>
                    {data.appointmentCount}
                  </span>
                  <span className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-0.5" aria-hidden="true">
                    {(data.markers ?? []).slice(0, 4).map((marker) => (
                      <span
                        key={marker.key}
                        className={`h-1.5 w-1.5 rounded-full ${marker.noShow ? "ring-1 ring-white" : ""}`}
                        style={{ backgroundColor: marker.color }}
                      />
                    ))}
                  </span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
      {mode === "availability" ? (
        <div className="mt-4 flex items-center gap-2 text-[11px] text-muted">
          <span className="h-2 w-2 rounded-full bg-success" />
          Available times
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-muted">
          {(legendItems ?? [
            { color: "#0f9f75", label: "Service" },
            { color: "#e11d48", label: "No-show" },
          ]).map((item) => (
            <span key={item.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
