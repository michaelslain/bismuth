// Shared sample data for Bases-view stories (dev-only, Storybook). NOT a story file itself —
// the `*.stories.*` glob (see `.storybook/main.ts`) skips underscore-prefixed files, matching
// the `_storyKit.tsx` convention. Mirrors core/test/helpers.ts's `makeSampleVault()`: one
// small, realistic, reusable dataset instead of every view's story inventing its own rows.
//
// `sampleViewResult` runs the REAL query engine (core/src/bases/query.ts `runView`) over the
// sample rows + a sample BaseConfig, so a story's `result`/`config` are exactly what the
// production Bases pipeline would hand a view renderer — not a hand-rolled stand-in for
// column/group resolution that could drift from the real thing.
import type { BaseConfig, BasePropertyDef, FileMeta, Row, ViewResult } from "../../../core/src/bases/types";
import { runView } from "../../../core/src/bases/query";

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

function file(name: string, folder: string, tags: string[]): FileMeta {
  const path = folder ? `${folder}/${name}.md` : `${name}.md`;
  return {
    name,
    basename: name,
    path,
    folder,
    ext: "md",
    size: 512,
    ctime: NOW - 30 * DAY_MS,
    mtime: NOW,
    tags,
    links: [],
  };
}

/** The curated sample dataset's property vocabulary — reused by both the rows below and the
 *  declared `select`/`multiselect` property config, so the two never drift apart. */
export const SAMPLE_STATUS_OPTIONS = ["Todo", "Doing", "Done"] as const;
export const SAMPLE_TAG_OPTIONS = ["planning", "frontend", "docs", "bug", "testing", "security", "retro"];

/**
 * 6 rows spanning text (file.name), number (priority), checkbox (done), date (due), a select
 * enum (status), and a multiselect (tags) — across two folders — so table/kanban/calendar/chart
 * views all have something meaningful to render, sort, group, sum, or plot.
 */
export const SAMPLE_ROWS: Row[] = [
  {
    file: file("Draft the roadmap", "projects", ["planning"]),
    note: { status: "Todo", priority: 1, done: false, due: "2026-08-10", tags: ["planning"] },
    formula: {},
  },
  {
    file: file("Ship storybook coverage", "projects", ["frontend"]),
    note: { status: "Doing", priority: 2, done: false, due: "2026-08-05", tags: ["frontend"] },
    formula: {},
  },
  {
    file: file("Write onboarding docs", "projects", ["docs"]),
    note: { status: "Done", priority: 3, done: true, due: "2026-07-20", tags: ["docs"] },
    formula: {},
  },
  {
    file: file("Investigate flaky test", "eng", ["bug", "testing"]),
    note: { status: "Todo", priority: 1, done: false, due: "2026-08-12", tags: ["bug", "testing"] },
    formula: {},
  },
  {
    file: file("Vendor security review", "eng", ["security"]),
    note: { status: "Doing", priority: 2, done: false, due: "2026-08-08", tags: ["security"] },
    formula: {},
  },
  {
    file: file("Archive Q2 retro", "eng", ["retro"]),
    note: { status: "Done", priority: 3, done: true, due: "2026-07-01", tags: ["retro"] },
    formula: {},
  },
];

const SAMPLE_PROPERTIES: Record<string, BasePropertyDef> = {
  status: { type: { kind: "select", options: [...SAMPLE_STATUS_OPTIONS] } },
  priority: { type: { kind: "number", number: "plain" } },
  done: { type: { kind: "boolean" } },
  due: { type: { kind: "date" } },
  tags: { type: { kind: "multiselect", options: SAMPLE_TAG_OPTIONS } },
};

const SAMPLE_DECLARED = ["status", "priority", "done", "due", "tags"];

const DEFAULT_CONFIG: BaseConfig = {
  properties: SAMPLE_PROPERTIES,
  declaredProperties: SAMPLE_DECLARED,
  views: [{ type: "table", name: "Table" }],
};

/** A minimal empty row a caller's `Partial<Row>` merges onto — used only when `rows` is passed
 *  explicitly to `sampleViewResult`. The curated `SAMPLE_ROWS` above are used untouched
 *  otherwise, so passing overrides never silently blends with the curated dataset. */
function emptyRow(i: number): Row {
  return { file: file(`Untitled ${i + 1}`, "", []), note: {}, formula: {} };
}

function mergeRow(i: number, partial: Partial<Row>): Row {
  const base = emptyRow(i);
  return {
    file: { ...base.file, ...(partial.file ?? {}) },
    note: { ...base.note, ...(partial.note ?? {}) },
    formula: { ...base.formula, ...(partial.formula ?? {}) },
  };
}

/** Shallow-merge a caller's config over the default: `properties` merges additively (so a
 *  story can add one property without repeating the other four); `views` replaces wholesale
 *  when given (set `views[0].groupBy` for a grouped/kanban story). Exported so a story can
 *  build a `config` prop that matches exactly what `sampleViewResult` fed to `runView`. */
export function sampleBaseConfig(config?: Partial<BaseConfig>): BaseConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    properties: { ...DEFAULT_CONFIG.properties, ...(config?.properties ?? {}) },
  };
}

/**
 * Build a ViewResult for a Bases view story by running the REAL query engine
 * (core/src/bases/query.ts `runView`) over sample rows + a sample BaseConfig. Always resolves
 * `config.views[0]` — a config with multiple views only ever renders the first.
 *
 * - No `rows`: the curated 6-row `SAMPLE_ROWS` dataset.
 * - `rows` given: each partial is merged onto a minimal empty row (NOT onto `SAMPLE_ROWS`) —
 *   pass full rows if you need specific data untouched by the merge.
 * - `config` given: see `sampleBaseConfig` for the merge rule; pass the SAME `config` to
 *   `sampleBaseConfig` to get a matching `BaseConfig` for the view's `config` prop.
 */
export function sampleViewResult(rows?: Partial<Row>[], config?: Partial<BaseConfig>): ViewResult {
  const builtRows = rows ? rows.map((r, i) => mergeRow(i, r)) : SAMPLE_ROWS;
  return runView(sampleBaseConfig(config), builtRows, 0);
}

/** Convenience preset: the curated sample rows grouped by `status` — the shape a kanban
 *  board or a grouped-table story needs (`ViewResult.groups` with more than one `ResultGroup`). */
export function sampleGroupedViewResult(): ViewResult {
  return sampleViewResult(undefined, {
    views: [{ type: "kanban", name: "Kanban", groupBy: { property: "status" } }],
  });
}
