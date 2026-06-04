import type { EvalContext } from "./types";
import { isLink, toNumber, truthy, type Link } from "./values";

export function asString(v: unknown): string {
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
  if (receiver && typeof receiver === "object" && !Array.isArray(receiver) && "path" in (receiver as object) && "tags" in (receiver as object)) {
    return callFileMethod(receiver as FileMeta, name, args, ctx);
  }
  if (typeof receiver === "number") return callNumberMethod(receiver, name, args);
  if (typeof receiver === "string") return callStringMethod(receiver, name, args);
  if (Array.isArray(receiver)) return callArrayMethod(receiver, name, args);
  if (receiver instanceof Date) return callDateMethod(receiver, name, args);
  return undefined;
}

type FileMeta = { tags: string[]; links: string[]; folder: string; path: string; [k: string]: unknown };

function callFileMethod(f: FileMeta, name: string, args: unknown[], ctx: EvalContext): unknown {
  switch (name) {
    case "hasTag":
      return args.some((a) => f.tags.includes(asString(a)));
    case "hasLink":
      return args.some((a) => f.links.includes(asString(a)));
    case "inFolder":
      return f.folder === asString(args[0]) || f.folder.startsWith(asString(args[0]) + "/");
    case "hasProperty":
      return args.length > 0 ? Object.prototype.hasOwnProperty.call(ctx.note, asString(args[0])) : false;
  }
  return undefined;
}

function callNumberMethod(n: number, name: string, args: unknown[]): unknown {
  switch (name) {
    case "toFixed":
      return n.toFixed(typeof args[0] === "number" ? args[0] : 0);
    case "round": {
      const d = typeof args[0] === "number" ? args[0] : 0;
      const f = 10 ** d;
      return Math.round(n * f) / f;
    }
    case "floor":
      return Math.floor(n);
    case "ceil":
      return Math.ceil(n);
    case "abs":
      return Math.abs(n);
    case "isEmpty":
      return false;
  }
  return undefined;
}

function callStringMethod(s: string, name: string, args: unknown[]): unknown {
  switch (name) {
    case "lower":
      return s.toLowerCase();
    case "upper":
      return s.toUpperCase();
    case "trim":
      return s.trim();
    case "title":
      return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    case "contains":
      return s.includes(asString(args[0]));
    case "startsWith":
      return s.startsWith(asString(args[0]));
    case "endsWith":
      return s.endsWith(asString(args[0]));
    case "replace":
      return s.split(asString(args[0])).join(asString(args[1]));
    case "slice":
      return s.slice(toNumber(args[0]), args[1] != null ? toNumber(args[1]) : undefined);
    case "split":
      return s.split(asString(args[0]));
    case "reverse":
      return s.split("").reverse().join("");
    case "isEmpty":
      return s.length === 0;
    case "matches": {
      try {
        const re = args[0] instanceof RegExp
          ? args[0]
          : new RegExp(asString(args[0]), args[1] != null ? asString(args[1]) : undefined);
        return re.test(s);
      } catch {
        return false;
      }
    }
  }
  return undefined;
}

function callArrayMethod(arr: unknown[], name: string, args: unknown[]): unknown {
  switch (name) {
    case "contains":
      return arr.some((x) => x === args[0] || asString(x) === asString(args[0]));
    case "join":
      return arr.map(asString).join(args[0] != null ? asString(args[0]) : ", ");
    case "unique":
      return [...new Set(arr)];
    case "sort":
      return [...arr].sort();
    case "reverse":
      return [...arr].reverse();
    case "slice":
      return arr.slice(toNumber(args[0]), args[1] != null ? toNumber(args[1]) : undefined);
    case "flat":
      return arr.flat();
    case "isEmpty":
      return arr.length === 0;
    case "map":
      return arr.map(compileItemAccessor(args[0]));
    case "filter": {
      const get = compileItemAccessor(args[0]);
      return arr.filter((x, i) => truthy(get(x, i)));
    }
    case "reduce":
      return callArrayReduce(arr, args);
  }
  return undefined;
}

function callArrayReduce(arr: unknown[], args: unknown[]): unknown {
  const fn0 = args[0] as Function & { __params?: number };
  const arity = typeof fn0 === "function" ? (fn0.__params ?? fn0.length) : -1;
  if (typeof fn0 === "function" && arity >= 2) {
    return arr.reduce(fn0 as (acc: unknown, x: unknown, i: number) => unknown, args[1] as unknown);
  }
  const get = compileItemAccessor(args[0]);
  const seed = args[1] != null ? toNumber(args[1]) : 0;
  return arr.reduce((acc: number, x, i) => acc + toNumber(get(x, i)), seed);
}

function callDateMethod(d: Date, name: string, args: unknown[]): unknown {
  switch (name) {
    case "format":
      return formatDate(d, asString(args[0]));
    case "date": {
      const copy = new Date(d);
      copy.setHours(0, 0, 0, 0);
      return copy;
    }
    case "isEmpty":
      return Number.isNaN(d.getTime());
    case "plus": {
      const ms = parseDurationMs(args[0]);
      return new Date(d.getTime() + (Number.isNaN(ms) ? 0 : ms));
    }
    case "minus": {
      const ms = parseDurationMs(args[0]);
      return new Date(d.getTime() - (Number.isNaN(ms) ? 0 : ms));
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
