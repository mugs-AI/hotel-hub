import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useSessionMe } from "./session-client";
import { WorkspaceStore, workspaceTab, type WorkTab } from "./workspace-tabs";

const Context = createContext<{
  store: WorkspaceStore;
  active: WorkTab | null;
  isCurrent: () => boolean;
} | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const session = useSessionMe().data;
  const actor = session?.authenticated ? session : null;
  const scope = actor
    ? `${actor.tenant.tenantId}:${actor.user.n3UserKey}:${actor.role}:${actor.housekeepingMode}`
    : "anonymous";
  const store = useMemo(() => new WorkspaceStore(scope), [scope]);
  const liveStore = useRef(store);
  liveStore.current = store;
  const isCurrent = useCallback(() => liveStore.current === store, [store]);
  const router = useRouter();
  const location = useLocation();
  const active = workspaceTab(
    location.pathname,
    location.search as Record<string, unknown>,
    actor?.role ?? null,
    actor?.housekeepingMode ?? "simple",
  );
  const href = active?.href;
  const key = active?.key;
  const label = active?.label;
  useEffect(() => {
    if (key && label && href) store.open({ key, label, href });
  }, [store, key, label, href]);
  useEffect(
    () =>
      router.subscribe("onBeforeNavigate", () => {
        if (href) store.rememberScroll(href, { x: window.scrollX, y: window.scrollY });
      }),
    [router, store, href],
  );
  useEffect(() => {
    if (!href) return;
    const position = store.scroll(href);
    let frame = 0;
    const restore = () => {
      frame = requestAnimationFrame(() => window.scrollTo(position.x, position.y));
    };
    restore();
    // A cached view may mount before its query finishes; stop when enough page height exists.
    if (typeof ResizeObserver === "undefined") return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(() => {
      if (document.documentElement.scrollHeight - window.innerHeight >= position.y) {
        restore();
        observer.disconnect();
      }
    });
    observer.observe(document.body);
    const stop = window.setTimeout(() => observer.disconnect(), 2000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(stop);
      observer.disconnect();
    };
  }, [store, href]);
  return (
    <Context.Provider key={scope} value={{ store, active, isCurrent }}>
      {children}
    </Context.Provider>
  );
}

export function useWorkspace() {
  return useContext(Context);
}

/** Normal React state semantics, retained only until its work tab/session is closed. */
export function useWorkspaceDraft<T>(
  name: string,
  initial: T | (() => T),
  dirty?: (value: T) => boolean,
  tabOverride?: string,
  closeBlock?: (value: T) => string | null,
): [T, (value: SetStateAction<T>) => void] {
  const context = useWorkspace();
  const local = useRef<WorkspaceStore | null>(null);
  if (!local.current) local.current = new WorkspaceStore();
  const store = context?.store ?? local.current;
  const tab = tabOverride ?? context?.active?.key ?? "local";
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const options = useRef({ initial, dirty, closeBlock });
  options.current = { initial, dirty, closeBlock };
  const value = store.getDraft(tab, name, initial);
  const setValue = useCallback(
    (next: SetStateAction<T>) => {
      const { initial, dirty, closeBlock } = options.current;
      const result =
        typeof next === "function"
          ? (next as (v: T) => T)(store.getDraft(tab, name, initial))
          : next;
      store.setDraft(tab, name, result, dirty?.(result) ?? false, closeBlock?.(result));
    },
    [store, tab, name],
  );
  return [value, setValue];
}

export function useReservationTabLabel(id: string, reference: string | undefined) {
  const context = useWorkspace();
  const key = `reservation:${id.toLowerCase()}`;
  useEffect(() => {
    if (reference && context?.active?.key === key)
      context.store.open({ ...context.active, label: reference });
  }, [context?.store, context?.active, key, reference]);
}
