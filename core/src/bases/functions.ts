import type { EvalContext } from "./types";
import { isLink, toNumber, truthy, type Link } from "./values";

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (isLink(v)) return (v as Link).display ?? (v as Link).path;
  return String(v);
}
function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return [];
  return [v];
}

// ---- Global functions ----
export function callFunction(name: string, args: unknown[], ctx: EvalContext): unknown {
  switch (name) {
    case "if": return truthy(args[0]) ? args[1] : args.length > 2 ? args[2] : undefined;
    case "number": return toNumber(args[0]);
    case "list": return args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    case "min": return Math.min(...args.map(toNumber));
    case "max": return Math.max(...args.map(toNumber));
    case "now": return new Date();
    case "today": { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
    case "date": return args[0] instanceof Date ? args[0] : new Date(asString(args[0]));
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
    }
  }

  // Date methods
  if (receiver instanceof Date) {
    switch (name) {
      case "format": return formatDate(receiver, asString(args[0]));
      case "date": { const d = new Date(receiver); d.setHours(0, 0, 0, 0); return d; }
      case "isEmpty": return Number.isNaN(receiver.getTime());
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
