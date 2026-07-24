// Per-browser display preference for content width.
// Never stores tenant, token or identity data — only a single UI choice.
"use client";

import { useEffect, useState, useCallback } from "react";

export type DisplayWidth = "standard" | "full";
export const DISPLAY_WIDTH_KEY = "hotelhub:display-width";
export const DEFAULT_DISPLAY_WIDTH: DisplayWidth = "standard";

export function isDisplayWidth(v: unknown): v is DisplayWidth {
  return v === "standard" || v === "full";
}

export function readDisplayWidth(): DisplayWidth {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_WIDTH;
  try {
    const v = window.localStorage.getItem(DISPLAY_WIDTH_KEY);
    return isDisplayWidth(v) ? v : DEFAULT_DISPLAY_WIDTH;
  } catch {
    return DEFAULT_DISPLAY_WIDTH;
  }
}

export function writeDisplayWidth(v: DisplayWidth): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISPLAY_WIDTH_KEY, v);
    window.dispatchEvent(new CustomEvent("hotelhub:display-width-change", { detail: v }));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * React hook returning the current display width and a setter that
 * broadcasts across the tab so every mounted consumer re-renders
 * immediately without a page reload.
 */
export function useDisplayWidth(): [DisplayWidth, (v: DisplayWidth) => void] {
  const [width, setWidth] = useState<DisplayWidth>(DEFAULT_DISPLAY_WIDTH);

  useEffect(() => {
    setWidth(readDisplayWidth());
    function onCustom(e: Event) {
      const v = (e as CustomEvent<DisplayWidth>).detail;
      if (isDisplayWidth(v)) setWidth(v);
    }
    function onStorage(e: StorageEvent) {
      if (e.key === DISPLAY_WIDTH_KEY && isDisplayWidth(e.newValue))
        setWidth(e.newValue as DisplayWidth);
    }
    window.addEventListener("hotelhub:display-width-change", onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("hotelhub:display-width-change", onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const set = useCallback((v: DisplayWidth) => {
    writeDisplayWidth(v);
    setWidth(v);
  }, []);

  return [width, set];
}

/** Tailwind class expressing the chosen width for the AppShell container. */
export function widthContainerClass(width: DisplayWidth): string {
  return width === "full" ? "w-full max-w-none px-4 sm:px-6 lg:px-8" : "mx-auto max-w-7xl px-6";
}
