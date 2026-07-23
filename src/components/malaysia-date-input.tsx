// Reusable Malaysian date input.
//
// Accepts keyboard input only (no <input type="date">), placeholder
// `dd/mm/yyyy`. Value in/out is ISO `yyyy-mm-dd`; the input tracks its own
// display string and only reports up on valid input or clear.
"use client";

import { forwardRef, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
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

export const MalaysianDateInput = forwardRef<HTMLInputElement, MalaysianDateInputProps>(
  function MalaysianDateInput(
    { value, onChange, className, disabled, required, id, name, ...aria },
    ref,
  ) {
    const [display, setDisplay] = useState<string>(() =>
      value && isValidIsoDate(value) ? (isoToMyDate(value) === "—" ? "" : isoToMyDate(value)) : "",
    );

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
        // Invalid — surface as empty ISO but keep display so user can fix.
        onChange("");
      }
    }

    return (
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
        className={cn(className)}
        maxLength={10}
        {...aria}
      />
    );
  },
);
