import { parse as parseYaml } from "yaml";
import type { BaseConfig, ViewConfig, SortSpec } from "./types";

function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  return [];
}

function normalizeSort(raw: unknown): SortSpec[] | undefined {
  if (!raw) return undefined;
  const items = Array.isArray(raw) ? raw : [raw];
  const out: SortSpec[] = [];
  for (const it of items) {
    if (typeof it === "string") out.push({ property: it, direction: "ASC" });
    else if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      const property = typeof o.property === "string" ? o.property : typeof o.column === "string" ? (o.column as string) : undefined;
      if (property) {
        const dir = String(o.direction ?? "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
        out.push({ property, direction: dir });
      }
    }
  }
  return out.length ? out : undefined;
}

function normalizeGroupBy(raw: unknown): ViewConfig["groupBy"] {
  if (!raw) return undefined;
  if (typeof raw === "string") return { property: raw, direction: "ASC" };
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.property === "string") {
      const dir = String(o.direction ?? "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
      return { property: o.property, direction: dir };
    }
  }
  return undefined;
}

function normalizeView(raw: unknown): ViewConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const type = o.type === "cards" || o.type === "list" ? o.type : "table";
  return {
    type,
    name: typeof o.name === "string" && o.name.length ? o.name : "Untitled view",
    limit: typeof o.limit === "number" ? o.limit : undefined,
    filters: o.filters as ViewConfig["filters"],
    order: Array.isArray(o.order) ? (o.order as unknown[]).map(String) : undefined,
    sort: normalizeSort(o.sort),
    groupBy: normalizeGroupBy(o.groupBy),
    summaries:
      o.summaries && typeof o.summaries === "object"
        ? Object.fromEntries(Object.entries(o.summaries as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
        : undefined,
  };
}

const EMPTY_BASE: BaseConfig = { views: [{ type: "table", name: "Table" }] };

export function parseBase(text: string): BaseConfig {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return { ...EMPTY_BASE };
  }
  if (!doc || typeof doc !== "object") return { ...EMPTY_BASE };
  const o = doc as Record<string, unknown>;

  const rawViews = asArray<unknown>(o.views);
  const views: ViewConfig[] = rawViews.map(normalizeView);
  if (views.length === 0) views.push({ type: "table", name: "Table" });

  const properties =
    o.properties && typeof o.properties === "object"
      ? Object.fromEntries(
          Object.entries(o.properties as Record<string, unknown>).map(([k, v]) => {
            const pv = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
            return [k, { displayName: typeof pv.displayName === "string" ? pv.displayName : undefined }];
          }),
        )
      : undefined;

  const formulas =
    o.formulas && typeof o.formulas === "object"
      ? Object.fromEntries(Object.entries(o.formulas as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : undefined;

  return { filters: o.filters as BaseConfig["filters"], formulas, properties, views };
}
