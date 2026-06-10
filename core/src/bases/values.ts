export interface Link { __link: true; path: string; display?: string; }

export function isLink(v: unknown): v is Link { return !!v && typeof v === "object" && (v as Link).__link === true; }

export function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  return true;
}

export function looseEquals(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (isLink(a) && isLink(b)) return a.path === b.path;
  if (isLink(a)) return a.path === b || (a.display !== undefined && a.display === b);
  if (isLink(b)) return b.path === a || (b.display !== undefined && b.display === a);
  return a === b;
}

export function compare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  return String(a).localeCompare(String(b));
}

export function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isNaN(n) ? NaN : n; }
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  return NaN;
}
