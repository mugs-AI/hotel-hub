// HH-AUTH-02 — browser-side helpers for Settings → User Control.
// Same-origin, cookie-authenticated. Never talks to N3 or Supabase directly.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccessChoice, UserControlRow } from "./user-control";

export type UserControlListDTO = {
  rows: UserControlRow[];
  skippedWithoutIdentifier: number;
  actorKeyAlignsWithN3Id: boolean;
};

/** Stable, safe, user-facing text for every code this API can return. */
export function userControlErrorText(code: string | null | undefined): string {
  switch (code) {
    case "n3_users_unavailable":
      return "N3 could not be reached to list users. Nothing was changed — try again shortly.";
    case "n3_users_malformed":
      return "N3 returned a user list HotelHub could not read. Nothing was changed.";
    case "user_control_unavailable":
    case "store_unavailable":
      return "HotelHub could not read or save access right now. Nothing was changed.";
    case "owner_check_failed":
      return "Only the current N3 Owner can change HotelHub access, and that could not be confirmed.";
    case "target_is_owner":
      return "The current N3 Owner is managed in N3 and cannot be changed here.";
    case "target_is_self":
      return "You cannot change your own access.";
    case "owner_not_assignable":
      return "Owner cannot be granted in HotelHub. It follows the N3 Owner.";
    case "unknown_target":
      return "That user is no longer in this property's N3 user list.";
    case "target_inactive":
      return "That N3 user is inactive and cannot be given HotelHub access.";
    case "invalid_target":
    case "invalid_role":
    case "unknown_field":
      return "That request was not valid.";
    case "forbidden":
    case "role_denied":
      return "Your HotelHub role cannot manage user access.";
    case "unauthenticated":
      return "Your session ended. Relaunch HotelHub from N3.";
    default:
      return "Something went wrong. Nothing was changed.";
  }
}

async function callJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body?.error ?? "request_failed");
  return body;
}

export function useUserControl(enabled: boolean) {
  const [data, setData] = useState<UserControlListDTO | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setErrorCode(null);
    try {
      const body = await callJson<UserControlListDTO>("/api/hotel/user-control");
      if (alive.current) setData(body);
    } catch (err) {
      if (alive.current) {
        setErrorCode((err as Error).message);
        setData(null);
      }
    } finally {
      if (alive.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const setAccess = useCallback(
    async (n3UserKey: string, access: AccessChoice) => {
      setSavingKey(n3UserKey);
      setSavedKey(null);
      setRowErrors((p) => {
        const next = { ...p };
        delete next[n3UserKey];
        return next;
      });
      try {
        await callJson("/api/hotel/user-control", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetN3UserKey: n3UserKey, access }),
        });
        if (!alive.current) return;
        setData((prev) =>
          prev
            ? {
                ...prev,
                rows: prev.rows.map((r) => (r.n3UserKey === n3UserKey ? { ...r, access } : r)),
              }
            : prev,
        );
        setSavedKey(n3UserKey);
      } catch (err) {
        if (alive.current) {
          setRowErrors((p) => ({ ...p, [n3UserKey]: (err as Error).message }));
        }
      } finally {
        if (alive.current) setSavingKey(null);
      }
    },
    [],
  );

  return { data, errorCode, isLoading, savingKey, savedKey, rowErrors, refresh, setAccess };
}
