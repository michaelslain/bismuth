// app/src/bases/queryGen.ts
//
// Pure, DOM-free codegen + parse for the no-code visual Query Builder. Given a
// `BuilderState` (the modal's reactive store) it produces the text BETWEEN the
// ```query fences (no fences), and given an existing block body it best-effort
// reverses that back into a `BuilderState` for editing.
//
// Two unrelated query formats are produced (verified against
// core/src/bases/queryBlock.ts + core/src/bases/sourceSpec.ts +
// docs/bases/query-block.md):
//
//   - Notes  -> a FULL INLINE CONFIG: `source: notes where <Bases-expr>` plus a
//               one-entry `views: [{ type, name, sort, groupBy, limit }]`. This is
//               the ONLY inline way to iterate notes-with-filters (a flat block
//               cannot iterate notes — only `of:`/`tasks:` produce a source).
//   - Tasks  -> a FLAT spec: `tasks: <Obsidian-Tasks DSL>` (+ optional `from:`,
//               `view:`, `group:`, `limit:`).
//   - Base   -> a FLAT spec: `of: [[Base]]` (+ optional `where:`, `view:`,
//               `group:`, `limit:`).
//
// build()/parse() are NOT required to be byte-identical (YAML key order may
// differ); the contract is that build(parse(body)) is SEMANTICALLY equivalent,
// and a non-reversible expression always survives verbatim in a raw field so no
// hand-edited query is ever dropped.
//
// Pure + DOM-free (no Solid, no api.ts) so it runs under `bun test` like
// blockModel.ts / slashMenu.ts.

import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { parseExpr } from "../../../core/src/bases/parser";
import { parseQueryBlock } from "../../../core/src/bases/queryBlock";
import type { Expr } from "../../../core/src/bases/ast";
import type { SortSpec, ViewType } from "../../../core/src/bases/types";
import { VIEW_TYPES } from "../../../core/src/bases/types";

// ---------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------

export type BuilderSource = "notes" | "tasks" | "base";

/** Coarse value-type of a note property, used to pick the operator set + value editor. */
export type PropType = "string" | "number" | "date" | "boolean" | "tag" | "list" | "link";

/** The operator vocabulary for a single notes filter row. `raw` escapes the visual model and
 *  emits `val` verbatim (used when round-tripping an expression the builder can't reverse). */
export type NotesOp =
  | "equals"
  | "not_equals"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "matches"
  | "has_tag"
  | "not_tag"
  | "in_folder"
  | "folder_is"
  | "date_before"
  | "date_after"
  | "date_within"
  | "checked"
  | "unchecked"
  | "is_set"
  | "is_empty"
  | "raw";

export interface NotesRow {
  prop: string;
  op: NotesOp;
  val: string;
  type: PropType;
}

export interface TaskFilters {
  status: "open" | "done" | "all";
  /** Priority filter: "any" | one of highest|high|medium|low|lowest|none. */
  priority: string;
  due: "any" | "overdue" | "today" | "week" | "has";
  recurring: "any" | "yes" | "no";
  /** Sort key: "" (none) | priority|due|scheduled|start|done|created|cancelled|description. */
  sortKey: string;
  sortReverse: boolean;
  from?: string;
  /** DSL leaves the parser could not reverse into the preset controls, kept verbatim. */
  rawWhere?: string;
}

export interface BuilderState {
  source: BuilderSource;
  view: ViewType;
  limit?: number;
  group?: string;
  sort?: SortSpec[];
  notes: {
    connective: "and" | "or";
    rows: NotesRow[];
    /** A whole `where` expression the parser couldn't reverse into rows, kept verbatim. */
    rawWhere?: string;
  };
  baseRef?: string;
  baseWhere?: string;
  tasks: TaskFilters;
}

/** Step-1 alias: the design names this type both ways. They are identical. */
export type QueryBuilderState = BuilderState;

export function defaultTaskFilters(): TaskFilters {
  return { status: "all", priority: "any", due: "any", recurring: "any", sortKey: "", sortReverse: false };
}

export function defaultBuilderState(): BuilderState {
  return {
    source: "notes",
    view: "table",
    notes: { connective: "and", rows: [] },
    tasks: defaultTaskFilters(),
  };
}

// ---------------------------------------------------------------------------------------
// Shared: config-vs-flat detection (identical test to queryBlock.ts / parse.ts)
// ---------------------------------------------------------------------------------------

/** A block body is a FULL INLINE CONFIG (not a flat spec) when it has a top-level
 *  views:/filters:/formulas:/properties:/schema:/source: key. Mirrors the detection
 *  used by the BaseView render host so the builder and the renderer agree. */
export function looksLikeBaseConfig(body: string): boolean {
  return /^(views|filters|formulas|properties|schema|source)\s*:/m.test(body);
}

// ---------------------------------------------------------------------------------------
// Notes: compile one (prop, op, val) row -> a single Bases expression leaf
// ---------------------------------------------------------------------------------------

const capitalize = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A bare number literal if `v` parses as a finite number, else a JSON string literal. */
function numOrStr(v: string): string {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? String(n) : JSON.stringify(v);
}

/** Resolve a date preset / literal to a Bases date expression (RHS of a date comparison).
 *    today | today+Nd | today-Nd | YYYY-MM-DD  ->  today() | today() + "Nd" | date("YYYY-MM-DD")
 *  Anything else is wrapped as a string literal date. */
function dateRhs(v: string): string {
  const s = v.trim();
  if (s === "" || s === "today") return "today()";
  const rel = s.match(/^today\s*([+-])\s*(\d+)\s*d$/i);
  if (rel) return `today() ${rel[1]} ${JSON.stringify(`${rel[2]}d`)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `date(${JSON.stringify(s)})`;
  return `date(${JSON.stringify(s)})`;
}

/** Map a property id to the engine accessor for tags/folder pseudo-props.
 *  `tags`/`file.tags` keep their natural ident; everything else is emitted as-is. */
function propExpr(prop: string): string {
  return prop;
}

/** Compile a single notes filter row to one Bases-expression leaf (NO surrounding parens). */
export function compileNotesRow(row: NotesRow): string {
  if (row.op === "raw") return row.val.trim();
  const p = propExpr(row.prop);
  switch (row.op) {
    case "equals":
      return `${p} == ${row.type === "number" ? numOrStr(row.val) : JSON.stringify(row.val)}`;
    case "not_equals":
      return `${p} != ${row.type === "number" ? numOrStr(row.val) : JSON.stringify(row.val)}`;
    case "gt":
      return `${p} > ${numOrStr(row.val)}`;
    case "gte":
      return `${p} >= ${numOrStr(row.val)}`;
    case "lt":
      return `${p} < ${numOrStr(row.val)}`;
    case "lte":
      return `${p} <= ${numOrStr(row.val)}`;
    case "contains":
      return `${p}.contains(${JSON.stringify(row.val)})`;
    case "starts_with":
      return `${p}.startsWith(${JSON.stringify(row.val)})`;
    case "ends_with":
      return `${p}.endsWith(${JSON.stringify(row.val)})`;
    case "matches":
      return `${p}.matches(${JSON.stringify(row.val)})`;
    case "has_tag":
      return `file.hasTag(${JSON.stringify(row.val)})`;
    case "not_tag":
      return `!file.hasTag(${JSON.stringify(row.val)})`;
    case "in_folder":
      return `file.inFolder(${JSON.stringify(row.val)})`;
    case "folder_is":
      return `file.folder == ${JSON.stringify(row.val)}`;
    case "date_before":
      return `date(${p}) < ${dateRhs(row.val)}`;
    case "date_after":
      return `date(${p}) >= ${dateRhs(row.val)}`;
    case "date_within":
      // within N days = >= today() AND < today()+Nd, expressed as one leaf via &&.
      return `date(${p}) >= today() && date(${p}) < today() + ${JSON.stringify(`${Number(row.val) || 0}d`)}`;
    case "checked":
      return p;
    case "unchecked":
      return `!${p}`;
    case "is_set":
      return p;
    case "is_empty":
      return `!${p}`;
    default:
      return row.val.trim();
  }
}

/** Compile the notes filter rows (+ connective) to a single `where` expression, or "" if none.
 *  A `rawWhere` overrides the rows entirely (the un-reversible advanced field wins). */
export function compileNotesWhere(notes: BuilderState["notes"]): string {
  if (notes.rawWhere && notes.rawWhere.trim()) return notes.rawWhere.trim();
  const leaves = notes.rows.map(compileNotesRow).filter((l) => l.trim() !== "");
  if (leaves.length === 0) return "";
  if (leaves.length === 1) return leaves[0];
  const join = notes.connective === "or" ? " || " : " && ";
  return leaves.map((l) => `(${l})`).join(join);
}

// ---------------------------------------------------------------------------------------
// Tasks: compile TaskFilters -> Obsidian-Tasks DSL leaves
// ---------------------------------------------------------------------------------------

/** Compile TaskFilters to an array of DSL leaves (filters first, then sort). The flat `tasks:`
 *  value is a single line, so callers join filter leaves with ` AND ` (runTaskQuery tokenizes a
 *  line on ` AND `/` OR `). */
export function compileTaskLeaves(tf: TaskFilters): string[] {
  const leaves: string[] = [];
  if (tf.status === "open") leaves.push("not done");
  else if (tf.status === "done") leaves.push("done");

  if (tf.priority && tf.priority !== "any") leaves.push(`priority is ${tf.priority}`);

  switch (tf.due) {
    case "overdue":
      leaves.push("due before today");
      break;
    case "today":
      leaves.push("due today");
      break;
    case "week":
      leaves.push("due before in 7 days");
      break;
    case "has":
      // "has a due date" = a date after the dawn of time.
      leaves.push("due after 1900-01-01");
      break;
  }

  if (tf.recurring === "yes") leaves.push("is recurring");
  else if (tf.recurring === "no") leaves.push("is not recurring");

  if (tf.rawWhere && tf.rawWhere.trim()) leaves.push(tf.rawWhere.trim());

  // NOTE: `sort by …` is intentionally NOT a filter leaf — it must land on its OWN line (emitted by
  // buildQueryBlockBody as a block scalar), since runTaskQuery only honors a sort as a whole line.
  return leaves;
}

/** The `sort by <key>[ reverse]` Tasks-DSL line for a task filter set, or "" when no sort. */
function taskSortLine(tf: TaskFilters): string {
  return tf.sortKey ? `sort by ${tf.sortKey}${tf.sortReverse ? " reverse" : ""}` : "";
}

// ---------------------------------------------------------------------------------------
// build(): BuilderState -> the ```query block body (NO fences)
// ---------------------------------------------------------------------------------------

/** Strip a trailing newline that yaml.stringify always appends so the body fits tightly between
 *  the fences (renderBlockToMarkdown re-adds the surrounding newlines). */
function trimYaml(s: string): string {
  return s.replace(/\n+$/, "");
}

export function buildQueryBlockBody(state: BuilderState): string {
  if (state.source === "notes") {
    const where = compileNotesWhere(state.notes);
    const view: Record<string, unknown> = {
      type: state.view,
      name: capitalize(state.view),
    };
    if (state.sort && state.sort.length) view.sort = state.sort;
    if (state.group) view.groupBy = { property: state.group };
    if (state.limit != null) view.limit = state.limit;
    const config: Record<string, unknown> = {
      source: where ? `notes where ${where}` : "notes",
      views: [view],
    };
    return trimYaml(yamlStringify(config));
  }

  if (state.source === "tasks") {
    const lines: string[] = [];
    const filters = compileTaskLeaves(state.tasks).join(" AND ");
    const sortLine = taskSortLine(state.tasks);
    if (sortLine) {
      // A sort needs its own DSL line, so emit a multi-line `tasks:` block scalar (filters AND-joined
      // on one line, `sort by …` on the next). parseQueryBlock reads block scalars; runTaskQuery then
      // honors the sort (incl. rank-aware `sort by priority`, which a view-level sort can't replicate).
      lines.push("tasks: |-");
      if (filters) lines.push(`  ${filters}`);
      lines.push(`  ${sortLine}`);
    } else {
      lines.push(`tasks: ${filters}`.trimEnd());
    }
    if (state.tasks.from) lines.push(`from: ${state.tasks.from}`);
    if (state.view && state.view !== "list") lines.push(`view: ${state.view}`);
    if (state.group) lines.push(`group: ${state.group}`);
    if (state.limit != null) lines.push(`limit: ${state.limit}`);
    return lines.join("\n");
  }

  // source === "base"
  const lines: string[] = [];
  lines.push(`of: ${state.baseRef ?? ""}`.trimEnd());
  const where = state.baseWhere?.trim() || compileNotesWhere(state.notes);
  if (where) lines.push(`where: ${where}`);
  if (state.view && state.view !== "table") lines.push(`view: ${state.view}`);
  if (state.group) lines.push(`group: ${state.group}`);
  if (state.limit != null) lines.push(`limit: ${state.limit}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------
// parse(): block body -> BuilderState (best-effort, fails OPEN to a raw field)
// ---------------------------------------------------------------------------------------

const TASK_PRIORITIES = ["highest", "high", "medium", "low", "lowest", "none"];
const TASK_SORT_KEYS = ["priority", "due", "scheduled", "start", "done", "created", "cancelled", "description"];

/** Reverse a single Tasks DSL leaf into a TaskFilters mutation. Returns true if recognized. */
function applyTaskLeaf(leaf: string, tf: TaskFilters): boolean {
  const s = leaf.trim();
  const lc = s.toLowerCase();
  if (lc === "not done") {
    tf.status = "open";
    return true;
  }
  if (lc === "done") {
    tf.status = "done";
    return true;
  }
  let m = lc.match(/^priority is (highest|high|medium|low|lowest|none)$/);
  if (m && TASK_PRIORITIES.includes(m[1])) {
    tf.priority = m[1];
    return true;
  }
  if (lc === "due before today") {
    tf.due = "overdue";
    return true;
  }
  if (lc === "due today") {
    tf.due = "today";
    return true;
  }
  if (/^due before in \d+ days?$/.test(lc)) {
    tf.due = "week";
    return true;
  }
  if (/^due after \d{4}-\d{2}-\d{2}$/.test(lc)) {
    tf.due = "has";
    return true;
  }
  if (lc === "is recurring") {
    tf.recurring = "yes";
    return true;
  }
  if (lc === "is not recurring") {
    tf.recurring = "no";
    return true;
  }
  m = lc.match(/^sort by (\w+)(?: (reverse))?$/);
  if (m && TASK_SORT_KEYS.includes(m[1])) {
    tf.sortKey = m[1];
    tf.sortReverse = !!m[2];
    return true;
  }
  return false;
}

/** Coerce a parsed-block view string into a valid ViewType (default "table"). */
function asView(v: unknown, fallback: ViewType): ViewType {
  return typeof v === "string" && (VIEW_TYPES as string[]).includes(v) ? (v as ViewType) : fallback;
}

/** Flatten a same-op binary tree (`a && b && c`) into its leaf nodes; `null` if the op differs. */
function flattenSameOp(expr: Expr, op: string): Expr[] | null {
  if (expr.type === "binary" && (expr.op === "&&" || expr.op === "||")) {
    if (expr.op !== op) return null;
    const left = flattenSameOp(expr.left, op);
    const right = flattenSameOp(expr.right, op);
    if (!left || !right) return null;
    return [...left, ...right];
  }
  return [expr];
}

function strLit(e: Expr): string | null {
  return e.type === "str" ? e.value : null;
}

/** Reverse a single Bases-expression leaf into a NotesRow; null if unrecognized. */
export function leafToRow(expr: Expr): NotesRow | null {
  const mk = (prop: string, op: NotesOp, val: string, type: PropType): NotesRow => ({ prop, op, val, type });

  // file.hasTag("x")  /  !file.hasTag("x")
  if (expr.type === "unary" && expr.op === "!") {
    const inner = expr.operand;
    if (inner.type === "call" && inner.callee.type === "member" && inner.callee.name === "hasTag") {
      const a = strLit(inner.args[0] ?? ({} as Expr));
      if (a != null) return mk("tags", "not_tag", a, "tag");
    }
    // !ident  -> is_empty (a bare property unset / falsy)
    if (inner.type === "ident") return mk(inner.name, "is_empty", "", "string");
    if (inner.type === "member") {
      const mp = memberPath(inner);
      if (mp != null) return mk(mp, "is_empty", "", "string");
    }
    return null;
  }

  if (expr.type === "call" && expr.callee.type === "member") {
    const method = expr.callee.name;
    const obj = expr.callee.object;
    const arg = strLit(expr.args[0] ?? ({} as Expr));
    if (method === "hasTag" && arg != null) return mk("tags", "has_tag", arg, "tag");
    if (method === "inFolder" && arg != null) return mk("file.folder", "in_folder", arg, "string");
    if (arg == null) return null;
    const prop = obj.type === "ident" ? obj.name : memberPath(obj);
    if (prop == null) return null;
    if (method === "contains") return mk(prop, "contains", arg, "string");
    if (method === "startsWith") return mk(prop, "starts_with", arg, "string");
    if (method === "endsWith") return mk(prop, "ends_with", arg, "string");
    if (method === "matches") return mk(prop, "matches", arg, "string");
    return null;
  }

  if (expr.type === "binary") {
    const { op, left, right } = expr;
    // date(prop) </>= <rhs>
    if (left.type === "call" && left.callee.type === "ident" && left.callee.name === "date") {
      const inner = left.args[0];
      const prop = inner?.type === "ident" ? inner.name : inner?.type === "member" ? memberPath(inner) : null;
      if (prop) {
        const rhs = dateRhsToVal(right);
        if (op === "<" && rhs != null) return mk(prop, "date_before", rhs, "date");
        if (op === ">=" && rhs != null) return mk(prop, "date_after", rhs, "date");
      }
    }
    const lProp = left.type === "ident" ? left.name : left.type === "member" ? memberPath(left) : null;
    if (lProp == null) return null;
    // file.folder == "x"
    if (lProp === "file.folder" && op === "==" && right.type === "str") {
      return mk("file.folder", "folder_is", right.value, "string");
    }
    const rv = scalarToVal(right);
    if (rv == null) return null;
    const type: PropType = right.type === "num" ? "number" : "string";
    switch (op) {
      case "==":
        return mk(lProp, "equals", rv, type);
      case "!=":
        return mk(lProp, "not_equals", rv, type);
      case ">":
        return mk(lProp, "gt", rv, "number");
      case ">=":
        return mk(lProp, "gte", rv, "number");
      case "<":
        return mk(lProp, "lt", rv, "number");
      case "<=":
        return mk(lProp, "lte", rv, "number");
    }
  }

  // bare ident  -> is_set (a property is truthy / present)
  if (expr.type === "ident") return mk(expr.name, "is_set", "", "string");
  if (expr.type === "member") {
    const mp = memberPath(expr);
    if (mp != null) return mk(mp, "is_set", "", "string");
  }

  return null;
}

/** Reconstruct a dotted member path (`file.folder`) from a pure ident/member chain.
 *  Returns null when the chain bottoms out at anything else (a call, index, …) so a
 *  chained expression like `items.filter(...).length` is treated as unrecognized. */
function memberPath(e: Expr): string | null {
  if (e.type === "ident") return e.name;
  if (e.type === "member") {
    const base = memberPath(e.object);
    return base == null ? null : `${base}.${e.name}`;
  }
  return null;
}

/** A scalar RHS (string/number/bool) -> its display value string, else null. */
function scalarToVal(e: Expr): string | null {
  if (e.type === "str") return e.value;
  if (e.type === "num") return String(e.value);
  if (e.type === "bool") return String(e.value);
  return null;
}

/** Reverse a date-comparison RHS back to a preset/literal value string. */
function dateRhsToVal(e: Expr): string | null {
  if (e.type === "call" && e.callee.type === "ident" && e.callee.name === "today") return "today";
  if (e.type === "call" && e.callee.type === "ident" && e.callee.name === "date") {
    const a = e.args[0];
    return a?.type === "str" ? a.value : null;
  }
  // today() ± "Nd"
  if (e.type === "binary" && (e.op === "+" || e.op === "-")) {
    if (e.left.type === "call" && e.left.callee.type === "ident" && e.left.callee.name === "today") {
      const amt = e.right.type === "str" ? e.right.value.replace(/d$/, "") : null;
      if (amt != null) return `today${e.op}${amt}d`;
    }
  }
  if (e.type === "str") return e.value;
  return null;
}

/** Reverse a whole `where` expression into rows + connective. On any mixed/unrecognized shape,
 *  set `rawWhere` and leave rows empty (fail open). */
function reverseWhere(where: string): BuilderState["notes"] {
  const empty: BuilderState["notes"] = { connective: "and", rows: [] };
  if (!where.trim()) return empty;
  let ast: Expr;
  try {
    ast = parseExpr(where);
  } catch {
    return { connective: "and", rows: [], rawWhere: where.trim() };
  }
  // A single top-level binary && / || splits into same-op leaves; anything else is one leaf.
  let connective: "and" | "or" = "and";
  let leaves: Expr[];
  if (ast.type === "binary" && (ast.op === "&&" || ast.op === "||")) {
    connective = ast.op === "||" ? "or" : "and";
    const flat = flattenSameOp(ast, ast.op);
    if (!flat) return { connective: "and", rows: [], rawWhere: where.trim() };
    leaves = flat;
  } else {
    leaves = [ast];
  }
  const rows: NotesRow[] = [];
  for (const leaf of leaves) {
    const row = leafToRow(leaf);
    if (!row) return { connective: "and", rows: [], rawWhere: where.trim() };
    rows.push(row);
  }
  // date_within compiles to `date(P) >= today() && date(P) < today()+"Nd"` — a single leaf with an
  // inner `&&` that flattenSameOp splits into a date_after+date_before pair. Re-fuse that consecutive
  // pair so a "within N days" control round-trips as one row instead of degrading into two.
  return { connective, rows: connective === "and" ? coalesceDateWithin(rows) : rows };
}

/** Merge a consecutive `[date_after P "today", date_before P "today+Nd"]` pair (how date_within
 *  compiles + flattens) back into one `date_within` row. */
function coalesceDateWithin(rows: NotesRow[]): NotesRow[] {
  const out: NotesRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    const m = b && /^today\+(\d+)d$/.exec(b.val);
    if (a.op === "date_after" && a.val === "today" && b && b.op === "date_before" && b.prop === a.prop && m) {
      out.push({ prop: a.prop, op: "date_within", val: m[1], type: "date" });
      i++; // consumed b
    } else {
      out.push(a);
    }
  }
  return out;
}

export function parseQueryBlockBody(body: string): BuilderState {
  const state = defaultBuilderState();
  const trimmed = body.trim();
  if (!trimmed) return state;

  // ---- FULL INLINE CONFIG (notes) ----
  if (looksLikeBaseConfig(body)) {
    state.source = "notes";
    let config: Record<string, unknown> | undefined;
    try {
      config = yamlParse(body) as Record<string, unknown>;
    } catch {
      config = undefined;
    }
    if (config) {
      const src = config.source;
      if (typeof src === "string") {
        const m = src.trim().match(/^notes(?:\s+where\s+([\s\S]+))?$/i);
        if (m) state.notes = reverseWhere(m[1] ?? "");
        else state.notes = { connective: "and", rows: [], rawWhere: src.trim() };
      }
      const views = Array.isArray(config.views) ? (config.views as Record<string, unknown>[]) : [];
      const view = views[0];
      if (view) {
        state.view = asView(view.type, "table");
        if (Array.isArray(view.sort)) state.sort = view.sort as SortSpec[];
        const gb = view.groupBy as { property?: string } | undefined;
        if (gb && typeof gb.property === "string") state.group = gb.property;
        if (typeof view.limit === "number") state.limit = view.limit;
      }
    }
    return state;
  }

  // ---- FLAT spec (tasks / base) ----
  const qb = parseQueryBlock(body);
  if (qb.source?.kind === "base") {
    state.source = "base";
    state.baseRef = qb.source.ref;
    if (qb.where) state.baseWhere = qb.where;
    state.view = asView(qb.as, "table");
  } else if (qb.source?.kind === "tasks") {
    state.source = "tasks";
    const tf = defaultTaskFilters();
    if (qb.source.from) tf.from = qb.source.from;
    const dsl = qb.source.where ?? "";
    const unmatched: string[] = [];
    // runTaskQuery splits on lines AND on ` AND `/` OR ` within a line; mirror that.
    for (const line of dsl.split(/\r?\n/)) {
      for (const piece of line.split(/\s+(?:AND|OR)\s+/i)) {
        const p = piece.trim();
        if (!p) continue;
        if (!applyTaskLeaf(p, tf)) unmatched.push(p);
      }
    }
    if (unmatched.length) tf.rawWhere = unmatched.join(" AND ");
    state.tasks = tf;
    state.view = asView(qb.as, "list");
  } else {
    // Neither of: nor tasks: — default to notes so the builder opens cleanly.
    state.source = "notes";
    state.view = asView(qb.as, "table");
  }
  if (qb.group) state.group = qb.group;
  if (qb.limit != null) state.limit = qb.limit;
  return state;
}

/** Whether the no-code builder can edit `body` WITHOUT dropping anything on save. The builder models
 *  exactly: a flat tasks/base spec, OR a notes inline-config with a fully-reversible `where`, a single
 *  view, and only the view fields it knows (type/name/sort/groupBy/limit) — and NO top-level
 *  filters/formulas/properties/schema. A richer hand-authored config (extra views, formulas, a
 *  structured filters tree, a tasks/base config form) is NOT representable; callers should hide the
 *  builder's edit affordance for it so the raw block is edited as source instead of being clobbered. */
export function isBuilderRepresentable(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return true;
  if (!looksLikeBaseConfig(body)) return true; // flat tasks/base round-trips losslessly
  let config: Record<string, unknown>;
  try {
    config = yamlParse(body) as Record<string, unknown>;
  } catch {
    return false;
  }
  if (!config || typeof config !== "object") return false;
  // Only `source` + `views` are modeled — any other top-level key (filters/formulas/properties/schema)
  // would be lost.
  for (const k of Object.keys(config)) if (k !== "source" && k !== "views") return false;
  const src = typeof config.source === "string" ? config.source.trim() : "";
  const m = src.match(/^notes(?:\s+where\s+([\s\S]+))?$/i);
  if (!m) return false; // tasks/base CONFIG form (builder emits those flat, so it can't round-trip a config one)
  if (m[1] && reverseWhere(m[1]).rawWhere) return false; // a where the builder can't reverse into rows
  const views = Array.isArray(config.views) ? (config.views as Record<string, unknown>[]) : [];
  if (views.length > 1) return false; // extra views would be dropped
  const v = views[0];
  if (v) for (const k of Object.keys(v)) if (!["type", "name", "sort", "groupBy", "limit"].includes(k)) return false;
  return true;
}
