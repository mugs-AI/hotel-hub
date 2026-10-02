import { hasPermission, type HotelRole, type Permission } from "./rbac";
import { housekeepingAuthority } from "./housekeeping";

export type WorkTab = {
  key: string;
  label: string;
  href: string;
  view?: "reservation" | "checkout";
};
export type ViewScroll = { x: number; y: number };
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const RESERVATION = new RegExp(`^/reservations/(${UUID})(?:/(edit|checkout))?$`, "i");
const SECTIONS: Record<string, { label: string; permission: Permission; search?: string[] }> = {
  "/": { label: "Dashboard", permission: "app:view" },
  "/reservations": {
    label: "Reservations",
    permission: "hotel:reservations:view",
    search: [
      "bookingReference",
      "guestName",
      "guestMobile",
      "bookingSource",
      "status",
      "arrivalFrom",
      "arrivalTo",
      "sortKey",
      "sortDir",
      "limit",
      "offset",
    ],
  },
  "/reservations/calendar": {
    label: "Calendar",
    permission: "hotel:reservations:view",
    search: ["startDate", "days"],
  },
  "/reservations/new": { label: "New Reservation", permission: "hotel:reservations:create" },
  "/departures": { label: "Departures", permission: "hotel:checkout:view" },
  "/housekeeping": { label: "Housekeeping", permission: "hotel:housekeeping:view" },
  "/rooms-rates": { label: "Rooms & Rates", permission: "hotel:rooms:view" },
  "/settings": { label: "Settings", permission: "hotel:setup" },
};

/** Navigation metadata only. Tokens, arbitrary paths and print pages never become tabs. */
export function workspaceTab(
  pathname: string,
  search: Record<string, unknown>,
  role: HotelRole | null,
  mode: "simple" | "dedicated",
): WorkTab | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const record = RESERVATION.exec(path);
  const settings =
    /^\/settings\/(property|system|guest-controls|n3-integration|charges-taxes|booking-sources|user-control|n3-financial-verification)$/.test(
      path,
    );
  const section = record
    ? {
        label: "Reservation",
        permission: "hotel:reservations:view" as Permission,
        search: ["from", "calStart", "calDays", "calFloor"],
      }
    : settings
      ? SECTIONS["/settings"]
      : SECTIONS[path];
  if (!section || !hasPermission(role, section.permission)) return null;
  if (path === "/housekeeping" && !housekeepingAuthority(mode, role).canOpenWorkspace) return null;
  const params = new URLSearchParams();
  for (const key of section.search ?? []) {
    const value = search[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).length <= 300)
      params.set(key, String(value));
  }
  const query = params.toString();
  return {
    key: record ? `reservation:${record[1].toLowerCase()}` : settings ? "/settings" : path,
    label: section.label,
    href: path + (query ? `?${query}` : ""),
    ...(record
      ? {
          view:
            record[2]?.toLowerCase() === "checkout"
              ? ("checkout" as const)
              : ("reservation" as const),
        }
      : {}),
  };
}

/** Per-authenticated-session UI memory. Never serialized, stored in QueryClient or sent to a server. */
export class WorkspaceStore {
  constructor(readonly scope = "local") {}
  private snapshot: { tabs: WorkTab[]; revision: number } = { tabs: [], revision: 0 };
  private listeners = new Set<() => void>();
  private drafts = new Map<
    string,
    { value: unknown; dirty: boolean; closeBlock?: string | null }
  >();
  private dirty = new Set<string>();
  private positions = new Map<string, ViewScroll>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private emit(tabs = this.snapshot.tabs) {
    this.snapshot = { tabs, revision: this.snapshot.revision + 1 };
    this.listeners.forEach((listener) => listener());
  }
  open(tab: WorkTab) {
    const old = this.snapshot.tabs.find((t) => t.key === tab.key);
    const next = {
      ...tab,
      label:
        old?.label !== "Reservation" && tab.label === "Reservation"
          ? (old?.label ?? tab.label)
          : tab.label,
    };
    if (old?.href === next.href && old.label === next.label && old.view === next.view) return;
    this.emit(
      old
        ? this.snapshot.tabs.map((t) => (t.key === tab.key ? next : t))
        : [...this.snapshot.tabs, next],
    );
  }
  label(key: string, label: string) {
    const tab = this.snapshot.tabs.find((t) => t.key === key);
    if (tab && label && tab.label !== label)
      this.emit(
        this.snapshot.tabs.map((t) => (t.key === key ? { ...t, label: label.slice(0, 100) } : t)),
      );
  }
  getDraft<T>(tab: string, name: string, initial: T | (() => T)): T {
    const key = `${tab}|${name}`;
    if (!this.drafts.has(key))
      this.drafts.set(key, {
        value: typeof initial === "function" ? (initial as () => T)() : initial,
        dirty: false,
      });
    return this.drafts.get(key)!.value as T;
  }
  setDraft<T>(tab: string, name: string, value: T, dirty = false, closeBlock?: string | null) {
    this.drafts.set(`${tab}|${name}`, { value, dirty, closeBlock });
    this.emit();
  }
  setDirty(tab: string, dirty: boolean) {
    if (dirty) this.dirty.add(tab);
    else this.dirty.delete(tab);
  }
  needsConfirmation(tab: string) {
    return (
      this.dirty.has(tab) ||
      [...this.drafts].some(([key, draft]) => key.startsWith(`${tab}|`) && draft.dirty)
    );
  }
  closeReason(tab: string) {
    return (
      [...this.drafts].find(([key, draft]) => key.startsWith(`${tab}|`) && draft.closeBlock)?.[1]
        .closeBlock ?? null
    );
  }
  close(key: string, confirmed: boolean) {
    if (this.closeReason(key)) return false;
    if (!confirmed && this.needsConfirmation(key)) return false;
    for (const name of this.drafts.keys()) if (name.startsWith(`${key}|`)) this.drafts.delete(name);
    this.dirty.delete(key);
    this.emit(this.snapshot.tabs.filter((t) => t.key !== key));
    return true;
  }
  clearDrafts(key: string, prefix = "") {
    for (const name of this.drafts.keys())
      if (name.startsWith(`${key}|${prefix}`) && !this.drafts.get(name)?.closeBlock)
        this.drafts.delete(name);
    this.dirty.delete(key);
    this.emit();
  }
  rememberScroll(href: string, position: ViewScroll) {
    this.positions.set(href, position);
  }
  scroll(href: string) {
    return this.positions.get(href) ?? { x: 0, y: 0 };
  }
}
