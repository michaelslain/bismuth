import { parse as parseYaml } from "yaml";
import type { BaseConfig, ViewConfig, SortSpec, ViewType, ParsedBase } from "./types";
import { parseMarkdownTable } from "./table";

function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  return [];
}

const VIEW_TYPES: ViewType[] = ["table", "cards", "list", "kanban", "map", "calendar", "flashcards"];
function isValidType(t: unknown): t is ViewType {
  return typeof t === "string" && (VIEW_TYPES as string[]).includes(t);
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
      if (property && typeof property === "string") {
        const dir = String(o.direction ?? "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
        spec = { property, direction: dir };
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
      const dir = String(o.direction ?? "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
      return { property: o.property, direction: dir };
    }
  }
  return undefined;
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
  };
}

const EMPTY_BASE: BaseConfig = { views: [{ type: "table", name: "Table" }] };

export function parseBase(text: string): BaseConfig {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return EMPTY_BASE;
  }
  if (!doc || typeof doc !== "object") return EMPTY_BASE;
  const o = doc as Record<string, unknown>;

  const rawViews = asArray<unknown>(o.views);
  const views: ViewConfig[] = rawViews.map(normalizeView);
  if (views.length === 0) views.push({ type: "table", name: "Table" });

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
    source: o.source as BaseConfig["source"],
    schema: o.schema as BaseConfig["schema"],
  };
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
  const config = fmText ? parseBase(fmText) : { views: [] as ViewConfig[] };
  const raw = fmText ? safeYaml(fmText) : null;

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
  if (raw?.source && typeof raw.source === "object") {
    config.source = raw.source as BaseConfig["source"];
  }

  const rows = parseMarkdownTable(body, meta);
  return { config, rows };
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
