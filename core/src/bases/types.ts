// ---- The base config (parsed .base YAML) ----
export type FilterNode = string | { and: FilterNode[] } | { or: FilterNode[] } | { not: FilterNode[] };

export interface ViewConfig {
  type: "table" | "cards" | "list" | "kanban" | "map";
  name: string;
  limit?: number;
  filters?: FilterNode;
  order?: string[];                       // property ids to display, e.g. "file.name", "note.age", "formula.ppu"
  sort?: SortSpec[];                       // sort keys, applied in order
  groupBy?: { property: string; direction?: "ASC" | "DESC" };
  summaries?: Record<string, string>;     // propertyId -> summary name (e.g. "Average")
  cardContent?: "properties" | "body";   // cards view: what to render inside each card
  // Kanban: fixed group keys + order. Without this, columns are derived from data —
  // dragging the last card out makes the column vanish. With it, every listed key
  // shows up as a column even when empty, and the order follows the declared list.
  columns?: string[];
  // Map view: which property ids carry geo coords. Defaults to bare "lat" / "lng"
  // (matched to frontmatter). Use "note.x" or "formula.y" for custom property
  // namespaces. zoom + center seed the initial framing.
  lat?: string;
  lng?: string;
  zoom?: number;
  center?: { lat: number; lng: number };
}

export interface SortSpec { property: string; direction?: "ASC" | "DESC"; }

export interface BaseConfig {
  filters?: FilterNode;                    // global, ANDed with each view's filters
  formulas?: Record<string, string>;       // name -> expression string
  // Per-property metadata. `hidden: true` omits the property from auto-derived
  // columns (table/cards/list/kanban default columns). A view's explicit
  // `order: [...]` still wins — that's the per-view opt-in.
  properties?: Record<string, { displayName?: string; hidden?: boolean }>;
  views: ViewConfig[];
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
