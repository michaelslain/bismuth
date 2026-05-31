import type { Row, ViewConfig } from "./types";
import { resolveProperty } from "./query";
import { toNumber } from "./values";
import { binKey, binLabel, type Bin } from "../dates";

export type Aggregate = "sum" | "avg" | "count" | "min" | "max";
export type { Bin };

export interface ChartPoint {
  key: string;
  label: string;
  value: number;
  date?: string;
}

export interface ChartData {
  points: ChartPoint[];
  min: number;
  max: number;
  isDate: boolean;
  valueLabel: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function toISODate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "string" && ISO_DATE.test(v)) return v.slice(0, 10);
  return null;
}

function candidateCols(rows: Row[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.note)) set.add(k);
  return [...set];
}

function fractionMatching(rows: Row[], col: string, pred: (v: unknown) => boolean): number {
  let seen = 0, hits = 0;
  for (const r of rows) {
    const v = resolveProperty(col, r);
    if (v === null || v === undefined) continue;
    seen++;
    if (pred(v)) hits++;
  }
  return seen === 0 ? 0 : hits / seen;
}

function autoX(rows: Row[], cols: string[]): string | undefined {
  for (const c of cols) if (fractionMatching(rows, c, (v) => toISODate(v) !== null) >= 0.5) return c;
  return cols[0];
}

function autoY(rows: Row[], cols: string[], x?: string): string | undefined {
  for (const c of cols) {
    if (c === x) continue;
    if (fractionMatching(rows, c, (v) => !Number.isNaN(toNumber(v))) >= 0.5) return c;
  }
  return undefined;
}

function aggregate(agg: Aggregate, vals: number[]): number {
  if (vals.length === 0) return 0;
  switch (agg) {
    case "count": return vals.length;
    case "sum": return vals.reduce((a, b) => a + b, 0);
    case "avg": return vals.reduce((a, b) => a + b, 0) / vals.length;
    case "min": return Math.min(...vals);
    case "max": return Math.max(...vals);
  }
}

export function buildChartData(rows: Row[], view: ViewConfig): ChartData {
  const cols = candidateCols(rows);
  const x = view.x ?? autoX(rows, cols);
  const y = view.y ?? autoY(rows, cols, x);
  const agg: Aggregate = (view.aggregate as Aggregate) ?? (y ? "sum" : "count");
  const bin: Bin = (view.bin as Bin) ?? "day";

  const isDate = x ? fractionMatching(rows, x, (v) => toISODate(v) !== null) >= 0.5 : false;

  const buckets = new Map<string, { label: string; vals: number[]; date?: string }>();
  for (const r of rows) {
    let key: string, label: string, date: string | undefined;
    if (isDate) {
      const iso = toISODate(x ? resolveProperty(x, r) : null);
      if (!iso) continue;
      key = binKey(iso, bin); label = binLabel(key, bin); date = bin === "day" ? key : undefined;
    } else {
      const raw = x ? resolveProperty(x, r) : "";
      key = String(raw ?? ""); label = key;
    }
    if (!buckets.has(key)) buckets.set(key, { label, vals: [], date });
    if (agg === "count" || !y) {
      buckets.get(key)!.vals.push(1);
    } else {
      const n = toNumber(resolveProperty(y, r));
      if (!Number.isNaN(n)) buckets.get(key)!.vals.push(n);
    }
  }

  const points: ChartPoint[] = [...buckets.entries()].map(([key, b]) => ({
    key, label: b.label, date: b.date, value: aggregate(agg, b.vals),
  }));

  if (isDate) points.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  else points.sort((a, b) => b.value - a.value);

  const values = points.map((p) => p.value);
  return {
    points,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    isDate,
    valueLabel: y ?? "count",
  };
}
