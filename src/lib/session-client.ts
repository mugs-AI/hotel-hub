// Browser session client. Talks only to same-origin server endpoints.
// No N3 tokens are stored client-side.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SessionMeResponse } from "@/routes/api/session/me";

export const SESSION_QUERY_KEY = ["session", "me"] as const;

export type SessionMe = SessionMeResponse;

async function fetchSessionMe(): Promise<SessionMe> {
  const res = await fetch("/api/session/me", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (!res.ok && res.status !== 401) {
    throw new Error(`session/me failed (${res.status})`);
  }
  return (await res.json()) as SessionMe;
}

export function useSessionMe() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSessionMe,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
  });
}

export function useDevConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (apiKey: string) => {
      const res = await fetch("/api/auth/connect", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Connect failed (${res.status})`);
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
  });
}

export async function probe(name: string): Promise<{
  status: number;
  durationMs: number;
  body: unknown;
  error?: string;
  httpStatus: number;
}> {
  const res = await fetch(`/api/n3/probe/${encodeURIComponent(name)}`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as {
    status?: number;
    durationMs?: number;
    body?: unknown;
    error?: string;
  };
  return {
    status: body.status ?? 0,
    durationMs: body.durationMs ?? 0,
    body: body.body,
    error: body.error,
    httpStatus: res.status,
  };
}
