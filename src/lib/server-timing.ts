// Safe server-side duration instrumentation.
//
// Emits a standard `Server-Timing` header with COARSE, hard-coded stage names
// and durations only. It can never carry SQL, tokens, PII, raw N3 bodies or
// any other secret: names are supplied by call sites as fixed literals and are
// sanitised to a conservative token charset before being written.
export type TimingEntry = { name: string; durationMs: number };

const NAME_SAFE = /[^a-zA-Z0-9_]/g;

export function sanitizeTimingName(name: string): string {
  const safe = name.replace(NAME_SAFE, "_").slice(0, 32);
  return safe || "stage";
}

export function formatServerTiming(entries: readonly TimingEntry[]): string {
  return entries
    .map((e) => `${sanitizeTimingName(e.name)};dur=${Math.max(0, Math.round(e.durationMs))}`)
    .join(", ");
}

export class ServerTimings {
  private readonly entries: TimingEntry[] = [];
  private readonly startedAt = Date.now();

  /** Time one awaited stage. The stage name must be a fixed literal. */
  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      this.entries.push({ name, durationMs: Date.now() - t0 });
    }
  }

  add(name: string, durationMs: number): void {
    this.entries.push({ name, durationMs });
  }

  list(): TimingEntry[] {
    return [...this.entries, { name: "total", durationMs: Date.now() - this.startedAt }];
  }

  header(): string {
    return formatServerTiming(this.list());
  }

  /** Response headers with `Server-Timing` merged in. */
  headers(base: Record<string, string> = {}): Record<string, string> {
    return { ...base, "server-timing": this.header() };
  }
}
