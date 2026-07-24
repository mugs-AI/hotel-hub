// Accessible searchable Country / Nationality combobox.
//
// - Combobox (input) opens a listbox with filtered ISO 3166-1 countries.
// - Full keyboard support: ArrowDown/Up, Home/End, Enter, Escape, Tab.
// - The keyboard-focused option always scrolls into view.
// - Committed `value` is an ISO alpha-3 code. Partial/unmatched typed text
//   clears any previously-committed hidden code so a stale country can
//   never be submitted while the visible label shows something else.
// - Reopening focuses the currently selected option when present.
//
// Contract: value is uppercase alpha-3 or "" (nothing committed).
"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { COUNTRIES, countryName, normalizeCountryCode, searchCountries } from "@/lib/iso-countries";
import { cn } from "@/lib/utils";

export type CountryComboboxProps = {
  id?: string;
  value: string;
  onChange: (alpha3: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
  className?: string;
};

function commitFromText(text: string): string {
  const t = text.trim().toLowerCase();
  if (!t) return "";
  const exact = COUNTRIES.find(
    (c) => c.name.toLowerCase() === t || c.alpha3.toLowerCase() === t,
  );
  return exact ? exact.alpha3 : "";
}

export function CountryCombobox({
  id,
  value,
  onChange,
  placeholder = "Search country…",
  disabled,
  required,
  ariaLabel,
  className,
}: CountryComboboxProps) {
  const uid = useId();
  const inputId = id ?? `country-${uid}`;
  const listId = `${inputId}-list`;

  const [text, setText] = useState<string>(value ? countryName(value) : "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // External value changes rewrite the visible label.
  useEffect(() => {
    setText(value ? countryName(value) : "");
  }, [value]);

  const options = useMemo(() => {
    // When the box is closed OR text matches the committed label, show the
    // full alphabetical list (Malaysia first). Otherwise filter by query.
    const showAll = !text.trim() || (value && text.trim() === countryName(value));
    return showAll ? COUNTRIES.slice(0, 300) : searchCountries(text, 300);
  }, [text, value]);

  // Keep the keyboard-focused row visible.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const ul = listRef.current;
    if (!ul) return;
    const el = ul.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  // Click outside closes.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        // On close, if typed text doesn't match, clear stale commit.
        const commit = commitFromText(text);
        if (commit !== value) onChange(commit);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [text, value, onChange]);

  function focusSelectedOnOpen() {
    if (!value) {
      setActiveIndex(options.length > 0 ? 0 : -1);
      return;
    }
    const idx = options.findIndex((c) => c.alpha3 === value);
    setActiveIndex(idx >= 0 ? idx : 0);
  }

  function openList() {
    if (disabled) return;
    setOpen(true);
    // Defer so options reflect current text.
    requestAnimationFrame(focusSelectedOnOpen);
  }

  function commit(alpha3: string) {
    onChange(alpha3);
    setText(alpha3 ? countryName(alpha3) : "");
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openList();
      setActiveIndex((i) => Math.min((i < 0 ? -1 : i) + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openList();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      if (open) {
        e.preventDefault();
        setActiveIndex(0);
      }
    } else if (e.key === "End") {
      if (open) {
        e.preventDefault();
        setActiveIndex(options.length - 1);
      }
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0 && activeIndex < options.length) {
        e.preventDefault();
        commit(options[activeIndex].alpha3);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === "Tab") {
      // Do NOT auto-select on Tab. Just close.
      setOpen(false);
    }
  }

  function handleInput(next: string) {
    setText(next);
    if (!open) setOpen(true);
    const commit = commitFromText(next);
    // Only clear/adjust the hidden code when text ceases to match the
    // committed value. An exact match commits immediately.
    if (commit) {
      if (commit !== value) onChange(commit);
    } else if (value) {
      onChange("");
    }
    // Reset active index to first visible option after filter changes.
    setActiveIndex(next.trim() ? 0 : -1);
  }

  const activeId = activeIndex >= 0 ? `${inputId}-opt-${activeIndex}` : undefined;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-controls={listId}
          aria-expanded={open}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label={ariaLabel}
          autoComplete="off"
          disabled={disabled}
          required={required}
          value={text}
          placeholder={placeholder}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={openList}
          onClick={openList}
          onKeyDown={handleKeyDown}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 pr-16 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear country"
            tabIndex={-1}
            onClick={() => {
              onChange("");
              setText("");
              inputRef.current?.focus();
              setOpen(true);
            }}
            className="absolute right-7 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={open ? "Close country list" : "Open country list"}
          tabIndex={-1}
          onClick={() => (open ? setOpen(false) : openList())}
          className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-input bg-popover p-1 text-sm shadow-md"
        >
          {options.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">No match</li>
          ) : (
            options.map((c, i) => {
              const active = i === activeIndex;
              const selected = c.alpha3 === value;
              return (
                <li
                  key={c.alpha3}
                  id={`${inputId}-opt-${i}`}
                  role="option"
                  aria-selected={selected}
                  data-index={i}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    // Prevent input blur before click commits.
                    e.preventDefault();
                    commit(c.alpha3);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center justify-between rounded px-2 py-1.5",
                    active ? "bg-accent text-accent-foreground" : "",
                    selected && !active ? "font-medium" : "",
                  )}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="ml-2 shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                    {c.alpha3}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** Test helper — exposed for unit tests. */
export const __test = { commitFromText, normalizeCountryCode };
