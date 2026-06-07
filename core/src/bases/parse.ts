import { parse as parseYaml } from "yaml";
import type { BaseConfig, ViewConfig, SortSpec, ParsedBase } from "./types";
import { isValidType } from "./types";
import { parseRows } from "./rows";
import { normalizeSource } from "./sourceSpec";

const AGGREGATE_VALUES: readonly string[] = ["sum", "avg", "count", "min", "max"];
const BIN_VALUES: readonly string[] = ["day", "week", "month"];

function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  return [];
}
function strOrUndef(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function safeYaml(text: string): Record<string, unknown> | null {
  try {
    const d = parseYaml(text);
    return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeDir(raw: unknown): "ASC" | "DESC" {
  return String(raw ?? "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
}

function normalizeSort(raw: unknown): SortSpec[] | undefined {
  if (!raw) return undefined;
  const items = Array.isArray(raw) ? raw : [raw];
  const out: SortSpec[] = [];
  for (const it of items) {
    let spec: SortSpec | null = null;
    if (typeof it === "string") {
      spec = { property: it, direction: "ASC" };
    } else if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      const property = typeof o.property === "string" ? o.property : typeof o.column === "string" ? o.column : null;
      if (property) {
        spec = { property, direction: normalizeDir(o.direction) };
      }
    }
    if (spec) out.push(spec);
  }
  return out.length ? out : undefined;
}

function normalizeGroupBy(raw: unknown): ViewConfig["groupBy"] {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    return { property: raw, direction: "ASC" };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.property === "string") {
      return { property: o.property, direction: normalizeDir(o.direction) };
    }
  }
  return undefined;
}

// Coerce a `columnWidths` map (propertyId -> px) into a clean number map. Tolerates
// values that round-tripped through YAML as strings ("240"); drops non-finite/non-positive.
function normalizeColumnWidths(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeView(raw: unknown): ViewConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const type = isValidType(o.type) ? o.type : "table";
  const name = typeof o.name === "string" && o.name.length ? o.name : "Untitled view";
  const limit = typeof o.limit === "number" ? o.limit : undefined;
  const order = Array.isArray(o.order) ? (o.order as unknown[]).map(String) : undefined;
  const summaries = o.summaries && typeof o.summaries === "object"
    ? Object.fromEntries(Object.entries(o.summaries as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
    : undefined;
  const cardContent = o.cardContent === "body" ? "body" : o.cardContent === "properties" ? "properties" : undefined;
  const columns = Array.isArray(o.columns) ? (o.columns as unknown[]).map(String) : undefined;
  const columnWidths = normalizeColumnWidths(o.columnWidths);
  const lat = typeof o.lat === "string" ? o.lat : undefined;
  const lng = typeof o.lng === "string" ? o.lng : undefined;
  const zoom = typeof o.zoom === "number" ? o.zoom : undefined;

  const centerObj = o.center as { lat?: unknown; lng?: unknown } | undefined;
  const center = centerObj && typeof centerObj.lat === "number" && typeof centerObj.lng === "number"
    ? { lat: centerObj.lat, lng: centerObj.lng }
    : undefined;

  return {
    type,
    name,
    limit,
    filters: o.filters as ViewConfig["filters"],
    order,
    sort: normalizeSort(o.sort),
    groupBy: normalizeGroupBy(o.groupBy),
    summaries,
    cardContent,
    columns,
    columnWidths,
    lat,
    lng,
    zoom,
    center,
    source: o.source as ViewConfig["source"],
    // calendar field bindings
    dateField: strOrUndef(o.dateField),
    startTimeField: strOrUndef(o.startTimeField),
    endTimeField: strOrUndef(o.endTimeField),
    recurrenceField: strOrUndef(o.recurrenceField),
    categoryField: strOrUndef(o.categoryField),
    // flashcards field bindings
    frontField: strOrUndef(o.frontField),
    backField: strOrUndef(o.backField),
    dueField: strOrUndef(o.dueField),
    easeField: strOrUndef(o.easeField),
    intervalField: strOrUndef(o.intervalField),
    bidirectional: o.bidirectional === true ? true : undefined,
    // chart bindings
    x: strOrUndef(o.x),
    y: strOrUndef(o.y),
    aggregate: AGGREGATE_VALUES.includes(o.aggregate as string) ? (o.aggregate as ViewConfig["aggregate"]) : undefined,
    bin: BIN_VALUES.includes(o.bin as string) ? (o.bin as ViewConfig["bin"]) : undefined,
  };
}

const EMPTY_BASE: BaseConfig = { views: [{ type: "table", name: "Table" }] };

function parseBaseObject(o: Record<string, unknown>): BaseConfig {
  const rawViews = asArray<unknown>(o.views);
  const views: ViewConfig[] = rawViews.map(normalizeView);
  if (views.length === 0) views.push({ type: "table", name: "Table" });

  // A top-level `columnWidths` (how the table view persists resizes via a flat
  // setProperty) configures the default view — unless that view already declared
  // its own. This mirrors the top-level order/sort/group handling in parseBaseFile.
  const topWidths = normalizeColumnWidths(o.columnWidths);
  if (topWidths && !views[0].columnWidths) views[0].columnWidths = topWidths;

  const properties = o.properties && typeof o.properties === "object"
    ? Object.fromEntries(
        Object.entries(o.properties as Record<string, unknown>).map(([k, v]) => {
          const pv = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
          return [
            k,
            {
              displayName: typeof pv.displayName === "string" ? pv.displayName : undefined,
              hidden: pv.hidden === true ? true : undefined,
            } as Record<string, unknown>,
          ];
        }),
      )
    : undefined;

  const formulas =
    o.formulas && typeof o.formulas === "object"
      ? Object.fromEntries(Object.entries(o.formulas as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : undefined;

  return {
    filters: o.filters as BaseConfig["filters"],
    formulas,
    properties,
    views,
    source: normalizeSource(o.source, o),
    schema: o.schema as BaseConfig["schema"],
  };
}

export function parseBase(text: string): BaseConfig {
  const o = safeYaml(text);
  if (!o) return EMPTY_BASE;
  return parseBaseObject(o);
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse a `type: base` markdown file: YAML frontmatter (config) + optional GFM table (rows).
 * `view: <type>` is shorthand for a single default view. Reuses parseBase() for the config.
 */
export function parseBaseFile(text: string, meta: { name: string; path: string }): ParsedBase {
  const m = text.match(FM_RE);
  const fmText = m ? m[1] : "";
  const body = m ? m[2] : text;
  const raw = fmText ? safeYaml(fmText) : null;
  const config = raw ? parseBaseObject(raw) : { views: [] as ViewConfig[] };

  // `view: <type>` shorthand wins only when no explicit `views:` array was given.
  if (raw && isValidType(raw.view) && !Array.isArray(raw.views)) {
    config.views = [{ type: raw.view, name: capitalize(raw.view) }];
  }
  if (!config.views || config.views.length === 0) {
    config.views = [{ type: "table", name: "Table" }];
  }
  if (raw?.schema && typeof raw.schema === "object") {
    config.schema = raw.schema as BaseConfig["schema"];
  }
  // Top-level field-binding keys configure the default view (so the settings UI can
  // persist them with a flat `setProperty`, no nested `views:` editing needed).
  if (raw && config.views[0]) {
    const FIELD_KEYS = [
      "frontField", "backField", "dueField",
      "dateField", "startTimeField", "endTimeField", "recurrenceField", "categoryField",
      "x", "y",
    ] as const;
    for (const k of FIELD_KEYS) {
      if (typeof raw[k] === "string") (config.views[0] as Record<string, unknown>)[k] = raw[k];
    }
    // Top-level view shaping (visible columns / sort / group / group-order) configures the default view too.
    if (Array.isArray(raw.order)) config.views[0].order = (raw.order as unknown[]).map(String);
    if (Array.isArray(raw.columns)) config.views[0].columns = (raw.columns as unknown[]).map(String);
    const s = normalizeSort(raw.sort);
    if (s) config.views[0].sort = s;
    const g = normalizeGroupBy(raw.groupBy);
    if (g) config.views[0].groupBy = g;
    const widths = normalizeColumnWidths(raw.columnWidths);
    if (widths) config.views[0].columnWidths = widths;
    // cards view: `cardContent: body` renders each note's body as an interactive todo
    // list (BodyCard); `properties` shows its fields. Top-level so a cards base needs no
    // nested `views:` block.
    if (raw.cardContent === "body" || raw.cardContent === "properties") config.views[0].cardContent = raw.cardContent;
    // chart axis/aggregation keys (flat persistence for chart views)
    if (AGGREGATE_VALUES.includes(raw.aggregate as string)) config.views[0].aggregate = raw.aggregate as ViewConfig["aggregate"];
    if (BIN_VALUES.includes(raw.bin as string)) config.views[0].bin = raw.bin as ViewConfig["bin"];
    // flashcards: top-level `bidirectional` configures the default view (flat persistence).
    if (typeof raw.bidirectional === "boolean") config.views[0].bidirectional = raw.bidirectional;
  }

  const rows = parseRows(body, meta);
  return { config, rows };
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
