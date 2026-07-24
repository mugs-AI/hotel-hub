// Reusable Malaysian date input with optional calendar-icon picker.
//
// Text entry: keyboard `dd/mm/yyyy` with auto-slash formatting.
// Value in/out: ISO `yyyy-mm-dd`.
// Optional calendar popover (react-day-picker) selects the same ISO value
// without changing storage or API contracts.
"use client";

import { forwardRef, useEffect, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { isValidIsoDate, isoToMyDate, myDateToIso } from "@/lib/malaysia-date";

export type MalaysianDateInputProps = {
  /** ISO `yyyy-mm-dd` or empty string. */
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Accessible label for the calendar icon button, e.g. "Choose arrival date". */
  pickerLabel?: string;
  /** Optional inclusive ISO lower bound — dates before this are disabled in the picker. */
  minIso?: string;
  /** Optional inclusive ISO upper bound — dates after this are disabled in the picker. */
  maxIso?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

function formatWhileTyping(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const parts: string[] = [];
  if (digits.length >= 1) parts.push(digits.slice(0, Math.min(2, digits.length)));
  if (digits.length >= 3) parts.push(digits.slice(2, Math.min(4, digits.length)));
  if (digits.length >= 5) parts.push(digits.slice(4, 8));
  return parts.join("/");
}

/** Local (not UTC) yyyy-mm-dd for a Date. Avoids TZ off-by-one. */
function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoToLocalDate(iso: string): Date | undefined {
  if (!isValidIsoDate(iso)) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const MalaysianDateInput = forwardRef<HTMLInputElement, MalaysianDateInputProps>(
  function MalaysianDateInput(
    { value, onChange, className, disabled, required, id, name, pickerLabel, minIso, maxIso, ...aria },
    ref,
  ) {
    const [display, setDisplay] = useState<string>(() =>
      value && isValidIsoDate(value) ? (isoToMyDate(value) === "—" ? "" : isoToMyDate(value)) : "",
    );
    const [open, setOpen] = useState(false);

    // Sync when the parent-controlled ISO value changes externally.
    useEffect(() => {
      if (!value) {
        setDisplay("");
        return;
      }
      if (isValidIsoDate(value)) {
        const my = isoToMyDate(value);
        if (my !== display) setDisplay(my === "—" ? "" : my);
      }
    }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const next = formatWhileTyping(e.target.value);
      setDisplay(next);
      if (next === "") {
        onChange("");
        return;
      }
      const iso = myDateToIso(next);
      if (iso) onChange(iso);
    }

    function handleBlur() {
      if (display === "") {
        onChange("");
        return;
      }
      const iso = myDateToIso(display);
      if (!iso) {
        onChange("");
      }
    }

    const selected = isoToLocalDate(value);
    const minDate = minIso ? isoToLocalDate(minIso) : undefined;
    const maxDate = maxIso ? isoToLocalDate(maxIso) : undefined;
    const disabledMatchers = [
      ...(minDate ? [{ before: minDate }] : []),
      ...(maxDate ? [{ after: maxDate }] : []),
    ];

    return (
      <div className={cn("relative", className)}>
        <Input
          ref={ref}
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="dd/mm/yyyy"
          value={display}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={disabled}
          required={required}
          className="pr-10"
          maxLength={10}
          {...aria}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={pickerLabel ?? "Open calendar"}
              disabled={disabled}
              className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <CalendarIcon className="h-4 w-4" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              captionLayout="dropdown"
              onSelect={(d) => {
                if (d) {
                  const iso = localIso(d);
                  onChange(iso);
                  setDisplay(isoToMyDate(iso));
                  setOpen(false);
                } else {
                  onChange("");
                  setDisplay("");
                }
              }}
              initialFocus
              disabled={disabledMatchers.length > 0 ? disabledMatchers : undefined}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  },
);
