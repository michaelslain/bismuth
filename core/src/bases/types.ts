// ---- The base config (parsed .base YAML) ----
export type { Recurrence, RecurrenceType } from "./recurrence";

export type FilterNode = string | { and: FilterNode[] } | { or: FilterNode[] } | { not: FilterNode[] };

// All view kinds a view can render. Calendar + flashcards are the unified additions.
// Chart types: bar, line, stat (stat tile), heatmap.
export type ViewType = "table" | "cards" | "list" | "bullets" | "kanban" | "map" | "calendar" | "flashcards" | "bar" | "line" | "stat" | "heatmap";

/** Exhaustive list of valid view type strings. Single source of truth. */
export const VIEW_TYPES: ViewType[] = ["table", "cards", "list", "bullets", "kanban", "map", "calendar", "flashcards", "bar", "line", "stat", "heatmap"];
export function isValidType(t: unknown): t is ViewType {
  return typeof t === "string" && (VIEW_TYPES as string[]).includes(t);
}

// Where a view's rows come from. Default is { kind: "base" } for a type:base file.
export type SourceSpec =
  | { kind: "base"; ref?: string }                  // ref = "[[Other Base]]"; resolves that base's OWN source (composition)
  | { kind: "notes"; where?: string; from?: string } // vault notes filtered by a Bases expression; from = "[[Base]]" scopes to that base's notes
  | { kind: "tasks"; where?: string; from?: string }; // vault checkbox tasks; from = "[[Base]]" scopes tasks to that base's notes (not the whole vault)

export interface ViewConfig {
  type: ViewType;
  name: string;
  limit?: number;
  filters?: FilterNode;
  order?: string[];                       // property ids to display, e.g. "file.name", "note.age", "formula.ppu"
  sort?: SortSpec[];                       // sort keys, applied in order
  groupBy?: { property: string; direction?: "ASC" | "DESC" };
  summaries?: Record<string, string>;     // propertyId -> summary name (e.g. "Average")
  cardContent?: "properties" | "body" | "tasks";   // cards view: what to render inside each card ("tasks" = body filtered to checklist lines)
  // Cards view: render an image cover from this property instead of the generated
  // text cover. The value may be a full URL (http/https/data/blob) or a vault image
  // path/filename (served via the asset endpoint). When unset, the text cover is used.
  image?: string;                         // property id holding the cover URL/path, e.g. "cover"
  imageFit?: "cover" | "contain";        // object-fit for the cover image (default "cover")
  imageAspectRatio?: number;             // cover width÷height (CSS aspect-ratio); default 0.667 (2:3 portrait)
  // Explicit group order for a grouped view: groups appear in this declared order,
  // with any data-only keys appended (ordered by value). Kanban additionally shows
  // every listed key as a column even when empty (so a column doesn't vanish when its
  // last card is dragged out); other view types only show declared groups that have
  // rows. Without this, groups are ordered by the group value (type-aware), not the
  // declared list.
  groupOrder?: string[];
  // Kanban: per-column (group-key) color override, keyed by the group value. A CSS color
  // string (e.g. "#e5484d" or "var(--blue)"). Columns without an entry fall back to a
  // known-status palette, then a distinct auto-assigned palette color. Set by the column
  // header's color picker; persisted via the top-level `groupColors` frontmatter key.
  groupColors?: Record<string, string>;
  // Kanban: which frontmatter property holds each card's editable multiline description
  // (rendered + edited inline on the card face). Defaults to "description". A bare
  // frontmatter name (no "note." prefix needed).
  descriptionField?: string;
  // Table: per-column pixel widths, keyed by property id (set by drag-resizing headers).
  columnWidths?: Record<string, number>;
  // Map view: which property ids carry geo coords. Defaults to bare "lat" / "lng"
  // (matched to frontmatter). Use "note.x" or "formula.y" for custom property
  // namespaces. zoom + center seed the initial framing.
  lat?: string;
  lng?: string;
  zoom?: number;
  center?: { lat: number; lng: number };
  // Per-view source override (falls back to BaseConfig.source, then { kind: "base" }).
  source?: SourceSpec;
  // Calendar view: which columns carry the date/time/recurrence/category fields.
  dateField?: string;          // default "date"
  startTimeField?: string;     // default "startTime"
  endTimeField?: string;       // default "endTime"
  recurrenceField?: string;    // default "recurrence"
  categoryField?: string;      // default "category"
  // Flashcards view: which columns carry the card fields + SM-2 scheduling state.
  frontField?: string;         // default "front"
  backField?: string;          // default "back"
  dueField?: string;           // default "due"
  easeField?: string;          // default "ease"
  intervalField?: string;      // default "interval"
  // When true, every card is reviewed in BOTH directions (front→back AND back→front),
  // each direction carrying its own independent SM-2 schedule. The reverse schedule
  // lives in companion columns: `<dueField>Back` / `<easeField>Back` / `<intervalField>Back`
  // (defaults dueBack / easeBack / intervalBack). Replaces the old `:::` reversed card.
  bidirectional?: boolean;
  // Chart views (bar, line, stat): axis + aggregation config.
  x?: string;                  // property id for the x-axis / category
  y?: string;                  // property id for the y-axis value
  aggregate?: "sum" | "avg" | "count" | "min" | "max";
  bin?: "day" | "week" | "month";
}

export interface SortSpec { property: string; direction?: "ASC" | "DESC"; }

/** Value types a declared base property can carry (same vocabulary as `schema`). */
export type PropertyType = "text" | "number" | "checkbox" | "date" | "time" | "list" | "link";
export const PROPERTY_TYPES: readonly PropertyType[] = ["text", "number", "checkbox", "date", "time", "list", "link"];

/** One entry of a base's `properties:` config. In the MAP form only the metadata fields
 *  (displayName/hidden) mattered historically; the LIST form (per-base declared properties)
 *  additionally carries an optional value `type` and a `default` seeded onto new cards/rows. */
export interface BasePropertyDef {
  displayName?: string;
  hidden?: boolean;
  type?: PropertyType;
  default?: unknown;
}

export interface BaseConfig {
  filters?: FilterNode;                    // global, ANDed with each view's filters
  formulas?: Record<string, string>;       // name -> expression string
  // Per-property metadata/definitions, keyed by property name. `hidden: true` omits the
  // property from auto-derived columns (table/cards/list/kanban default columns). A view's
  // explicit `order: [...]` still wins — that's the per-view opt-in.
  properties?: Record<string, BasePropertyDef>;
  // Set ONLY when `properties:` was written in LIST form: the declared property names in
  // declaration order. Its presence means the base declares its OWN property set — views
  // derive their default columns from this list instead of unioning row frontmatter, and
  // new cards seed each declared `default`. Absent (map form / no properties) keeps the
  // classic behavior: note-reading bases keep reflecting the notes' own frontmatter.
  declaredProperties?: string[];
  views: ViewConfig[];
  // Unified additions:
  source?: SourceSpec;                     // base-level default source for all views
  schema?: Record<string, string>;         // column -> type ("text"|"date"|"time"|"number"|"checkbox"|"list"|"link")
}

// ---- The data model (one Row per note) ----
export interface FileMeta {
  name: string;        // basename WITHOUT extension, e.g. "housing"
  basename: string;    // alias of name (Obsidian parity)
  path: string;        // vault-relative path, e.g. "reading/housing.md"
  folder: string;      // folder path, "" for root
  ext: string;         // "md", "base", ...
  size: number;        // bytes
  ctime: number;       // epoch ms
  mtime: number;       // epoch ms
  tags: string[];      // without leading '#'
  links: string[];     // wikilink targets (no .md, no #heading, no |alias)
}

/** Shared base for synthetic FileMeta rows (base-file rows, not distinct notes). */
export const EMPTY_FILE: Omit<FileMeta, "name" | "path" | "basename"> = {
  folder: "",
  ext: "md",
  size: 0,
  ctime: 0,
  mtime: 0,
  tags: [],
  links: [],
};

/**
 * Build a synthetic FileMeta for a base-file row (not a distinct note).
 * name/basename are empty so they aren't auto-shown as a meaningless repeated column;
 * path is kept for write-back purposes.
 */
export function syntheticBaseFile(path: string): FileMeta {
  return { ...EMPTY_FILE, name: "", basename: "", path };
}

/** Build a placeholder FileMeta with a real name/basename (unlike EMPTY_FILE/syntheticBaseFile,
 *  which blank those out). Used as a fallback `Row["file"]` when no parsed row exists yet. */
export function placeholderFile(name: string, path: string): FileMeta {
  return { ...EMPTY_FILE, name, basename: name, path };
}

export interface Row {
  file: FileMeta;
  note: Record<string, unknown>;           // frontmatter
  formula: Record<string, unknown>;        // filled in by the query engine
}

// ---- Engine output ----
export interface ResultGroup { key: string; rows: Row[]; }
export interface ViewResult {
  view: ViewConfig;
  columns: string[];                       // resolved display order of property ids
  groups: ResultGroup[];                   // single group with key "" when not grouped
  summaries: Record<string, string>;       // propertyId -> formatted summary value
}

export interface EvalContext {
  file: FileMeta;
  note: Record<string, unknown>;
  formula: Record<string, unknown>;
  this?: Record<string, unknown>;          // properties of the embedding/host note (optional)
  scope?: Scope;                            // lambda parameter scope chain
}

export interface Scope {
  bindings: Record<string, unknown>;
  parent?: Scope;
}

// ---- Unified source/view additions ----

// Parsed result of a `type: base` markdown file: its config + its own inline rows
// (rows is empty for a notes/tasks-source base that has no markdown table).
export interface ParsedBase {
  config: BaseConfig;
  rows: Row[];
}

// A flat ```query block parsed from a note body. `source` is undefined when the block
// references neither a base (`of:`) nor a task query (`tasks:`) — the host then
// renders an empty state instead of dumping the whole vault. `as` is the render mode
// (set in the block via `view:`, or the legacy `as:`).
export interface QueryBlock {
  source?: SourceSpec;
  as: ViewType;
  where?: string;
  sort?: SortSpec[];
  group?: string;
  limit?: number;
}
