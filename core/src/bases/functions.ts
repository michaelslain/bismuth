import type { EvalContext } from "./types";
import { isLink, toNumber, truthy, type Link } from "./values";

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (isLink(v)) return (v as Link).display ?? (v as Link).path;
  return String(v);
}

// ---- Duration parsing (used by date arithmetic + the `duration` helper) ----
// Accepts "1d", "-2h", "30m", "1.5w", "1y", "1mo", "500ms". "M"/"mo" = months,
// "m" = minutes. Returns milliseconds, or NaN if not a duration literal.
const UNIT_MS: Record<string, number> = {
  ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000,
  w: 7 * 86_400_000, mo: 30 * 86_400_000, M: 30 * 86_400_000, y: 365 * 86_400_000,
};
export function parseDurationMs(s: unknown): number {
  if (typeof s !== "string") return NaN;
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)(ms|mo|M|[smhdwy])$/);
  if (!m) return NaN;
  return Number(m[1]) * UNIT_MS[m[2]];
}

// Lambda-style method args land here from the parser as plain strings (the
// engine doesn't have first-class function values yet — we keep a property
// path or a tiny embedded expression instead). `_.x`, `it.x`, `$.x`, and
// "bare" forms all resolve against the item; an item that's an object lets
// you reach into it, an item that's primitive only responds to `_`/`it`/`$`.
function compileItemAccessor(arg: unknown): (item: unknown, index: number) => unknown {
  if (typeof arg === "function") return arg as (i: unknown, n: number) => unknown;
  if (typeof arg !== "string") return (item) => item;
  const path = arg.trim();
  // Bare placeholders just return the item.
  if (path === "_" || path === "it" || path === "$") return (item) => item;
  // Stripped leading placeholder + dot = property path on the item.
  const stripped = path.replace(/^(_|it|\$)\./, "");
  const parts = stripped.split(".").filter(Boolean);
  return (item) => {
    let v: unknown = item;
    for (const k of parts) {
      if (v === null || v === undefined) return undefined;
      v = (v as Record<string, unknown>)[k];
    }
    return v;
  };
}
// ---- Global functions ----
export function callFunction(name: string, args: unknown[], _ctx: EvalContext): unknown {
  switch (name) {
    case "if": return truthy(args[0]) ? args[1] : args.length > 2 ? args[2] : undefined;
    case "number": return toNumber(args[0]);
    case "list": return args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    case "min": return Math.min(...args.map(toNumber));
    case "max": return Math.max(...args.map(toNumber));
    case "now": return new Date();
    case "today": { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
    case "date": return args[0] instanceof Date ? args[0] : new Date(asString(args[0]));
    case "duration": return parseDurationMs(args[0]);
    case "link": return { __link: true, path: asString(args[0]), display: args[1] != null ? asString(args[1]) : undefined } as Link;
    case "random": return Math.random();
    default: return undefined;
  }
}

// ---- Method dispatch by receiver type ----
export function callMethod(receiver: unknown, name: string, args: unknown[], ctx: EvalContext): unknown {
  // File methods (receiver is a FileMeta-shaped object with .tags/.links/.folder)
  if (receiver && typeof receiver === "object" && !Array.isArray(receiver) && "path" in (receiver as object) && "tags" in (receiver as object)) {
    const f = receiver as { tags: string[]; links: string[]; folder: string; path: string; [k: string]: unknown };
    switch (name) {
      case "hasTag": return args.some((a) => f.tags.includes(asString(a)));
      case "hasLink": return args.some((a) => f.links.includes(asString(a)));
      case "inFolder": return f.folder === asString(args[0]) || f.folder.startsWith(asString(args[0]) + "/");
      case "hasProperty": return args.length > 0 ? Object.prototype.hasOwnProperty.call(ctx.note, asString(args[0])) : false;
    }
  }

  // Number methods
  if (typeof receiver === "number") {
    switch (name) {
      case "toFixed": return receiver.toFixed(typeof args[0] === "number" ? args[0] : 0);
      case "round": { const d = typeof args[0] === "number" ? args[0] : 0; const f = 10 ** d; return Math.round(receiver * f) / f; }
      case "floor": return Math.floor(receiver);
      case "ceil": return Math.ceil(receiver);
      case "abs": return Math.abs(receiver);
      case "isEmpty": return false;
    }
  }

  // String methods
  if (typeof receiver === "string") {
    switch (name) {
      case "lower": return receiver.toLowerCase();
      case "upper": return receiver.toUpperCase();
      case "trim": return receiver.trim();
      case "title": return receiver.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
      case "contains": return receiver.includes(asString(args[0]));
      case "startsWith": return receiver.startsWith(asString(args[0]));
      case "endsWith": return receiver.endsWith(asString(args[0]));
      case "replace": return receiver.split(asString(args[0])).join(asString(args[1]));
      case "slice": return receiver.slice(toNumber(args[0]), args[1] != null ? toNumber(args[1]) : undefined);
      case "split": return receiver.split(asString(args[0]));
      case "reverse": return receiver.split("").reverse().join("");
      case "isEmpty": return receiver.length === 0;
      // Regex via a string pattern: `name.matches("^Hello", "i")`. We can't accept a
      // /…/ literal yet (lexer has no regex token), so this is the textual form.
      case "matches": {
        try {
          const re = new RegExp(asString(args[0]), args[1] != null ? asString(args[1]) : undefined);
          return re.test(receiver);
        } catch { return false; }
      }
    }
  }

  // List methods
  if (Array.isArray(receiver)) {
    switch (name) {
      case "contains": return receiver.some((x) => x === args[0] || asString(x) === asString(args[0]));
      case "join": return receiver.map(asString).join(args[0] != null ? asString(args[0]) : ", ");
      case "unique": return [...new Set(receiver)];
      case "sort": return [...receiver].sort();
      case "reverse": return [...receiver].reverse();
      case "slice": return receiver.slice(toNumber(args[0]), args[1] != null ? toNumber(args[1]) : undefined);
      case "flat": return receiver.flat();
      case "isEmpty": return receiver.length === 0;
      // Lambda-lite: instead of `x => x.title` we accept the property-path string
      // `"title"` (or `"_.title"` / `"$.title"` / `"it.title"`). True closures
      // would need new AST + parser support; this covers the common shape.
      case "map": return receiver.map(compileItemAccessor(args[0]));
      case "filter": {
        const get = compileItemAccessor(args[0]);
        return receiver.filter((x, i) => truthy(get(x, i)));
      }
      case "reduce": {
        // .reduce("_.price", 0) — pulls the accessor's value and sums via toNumber.
        // For now we only do numeric sum; richer reducers would need real lambdas.
        const get = compileItemAccessor(args[0]);
        const seed = args[1] != null ? toNumber(args[1]) : 0;
        return receiver.reduce((acc: number, x, i) => acc + toNumber(get(x, i)), seed);
      }
    }
  }

  // Date methods
  if (receiver instanceof Date) {
    switch (name) {
      case "format": return formatDate(receiver, asString(args[0]));
      case "date": { const d = new Date(receiver); d.setHours(0, 0, 0, 0); return d; }
      case "isEmpty": return Number.isNaN(receiver.getTime());
      // Explicit duration arithmetic. `date(mtime).plus("1d")` adds a day.
      // The same shape works on the `+` / `-` operators (see evaluate.ts).
      case "plus": { const ms = parseDurationMs(args[0]); return new Date(receiver.getTime() + (Number.isNaN(ms) ? 0 : ms)); }
      case "minus": { const ms = parseDurationMs(args[0]); return new Date(receiver.getTime() - (Number.isNaN(ms) ? 0 : ms)); }
    }
  }

  return undefined;
}

function formatDate(d: Date, fmt: string): string {
  if (!fmt) return d.toISOString().slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return fmt
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/MM/g, pad(d.getMonth() + 1))
    .replace(/DD/g, pad(d.getDate()))
    .replace(/HH/g, pad(d.getHours()))
    .replace(/mm/g, pad(d.getMinutes()))
    .replace(/ss/g, pad(d.getSeconds()));
}
