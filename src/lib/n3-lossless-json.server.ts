// JSON.parse cannot preserve int64 or detect duplicate keys. Parse actual tokens,
// retaining oversized integer tokens as strings and rejecting rounded exponents.
export function parseN3LosslessJson(text: string): unknown {
  let at = 0;
  const ws = () => {
    while (/[\t\n\r ]/.test(text[at] ?? "x")) at++;
  };
  const fail = (): never => {
    throw new Error("invalid_n3_json");
  };
  function string(): string {
    const start = at++;
    while (at < text.length) {
      const ch = text[at++];
      if (ch === '"') return JSON.parse(text.slice(start, at)) as string;
      if (ch === "\\") at++;
    }
    return fail();
  }
  function value(depth: number): unknown {
    if (depth > 128) fail();
    ws();
    const ch = text[at];
    if (ch === '"') return string();
    if (ch === "{") {
      at++;
      ws();
      const o: Record<string, unknown> = {};
      const keys = new Set<string>();
      if (text[at] === "}") {
        at++;
        return o;
      }
      while (true) {
        ws();
        if (text[at] !== '"') fail();
        const k = string();
        if (keys.has(k)) fail();
        keys.add(k);
        ws();
        if (text[at++] !== ":") fail();
        const v = value(depth + 1);
        Object.defineProperty(o, k, {
          value: v,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        ws();
        const end = text[at++];
        if (end === "}") return o;
        if (end !== ",") fail();
      }
    }
    if (ch === "[") {
      at++;
      ws();
      const a: unknown[] = [];
      if (text[at] === "]") {
        at++;
        return a;
      }
      while (true) {
        a.push(value(depth + 1));
        ws();
        const end = text[at++];
        if (end === "]") return a;
        if (end !== ",") fail();
      }
    }
    for (const [token, v] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(token, at)) {
        at += token.length;
        return v;
      }
    }
    const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at))?.[0];
    if (!token) return fail();
    at += token.length;
    const n = Number(token);
    if (!Number.isFinite(n)) fail();
    if (/^-?\d+$/.test(token) && !Number.isSafeInteger(n)) return token;
    if (Math.abs(n) > Number.MAX_SAFE_INTEGER) fail();
    return n;
  }
  const result = value(0);
  ws();
  if (at !== text.length) fail();
  return result;
}
