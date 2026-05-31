import type { SourceSpec } from "./types";

const KINDS = ["base", "notes", "tasks"] as const;

/**
 * Coerce a frontmatter `source` value (string OR object) plus the surrounding
 * frontmatter (for top-level `from`/`where`/`ref`) into a SourceSpec.
 *
 * Accepts:
 *   source: notes                          -> { kind: "notes" }
 *   source: notes where <expr>             -> { kind: "notes", where }
 *   source: tasks    (+ from: [[X]])       -> { kind: "tasks", from }
 *   source: base     (+ ref: [[X]])        -> { kind: "base", ref }
 *   source: { kind: tasks, from: "[[X]]" } -> passthrough
 *
 * Returns undefined when unrecognized; callers apply their own default.
 */
export function normalizeSource(raw: unknown, fm: Record<string, unknown>): SourceSpec | undefined {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const kind = (KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as SourceSpec["kind"]) : undefined;
    if (!kind) return undefined;
    return prune({ kind, ref: wikiStr(o.ref), where: str(o.where), from: wikiStr(o.from) }) as SourceSpec;
  }
  if (typeof raw === "string") {
    const m = raw.trim().match(/^(base|notes|tasks)(?:\s+where\s+(.+))?$/i);
    if (!m) return undefined;
    const kind = m[1].toLowerCase() as SourceSpec["kind"];
    return prune({
      kind,
      where: m[2]?.trim() || str(fm.where),
      from: wikiStr(fm.from),
      ref: wikiStr(fm.ref),
    }) as SourceSpec;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length ? v : undefined;
}

/**
 * Read a wikilink-valued field (`from`/`ref`). Unquoted `[[Base]]` in YAML frontmatter
 * parses as a nested flow sequence (`[["Base"]]`), NOT a string — so accept both the
 * string form and the array form, reconstructing `"[[Base]]"`. Without this, an unquoted
 * `from: [[Keep]]` silently drops the scope and tasks fall back to the whole vault.
 */
function wikiStr(v: unknown): string | undefined {
  if (typeof v === "string" && v.length) return v;
  if (Array.isArray(v)) {
    const leaves = (v as unknown[]).flat(Infinity).filter((x): x is string => typeof x === "string" && x.length > 0);
    if (leaves.length) return `[[${leaves.join(", ")}]]`;
  }
  return undefined;
}

function prune<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/** Convert a wikilink ref to a file path. Handles both [[Base]] and [[Base.md]] formats. */
export function refToPath(ref?: string): string {
  if (!ref) return "";
  const r = ref.replace(/^\[\[/, "").replace(/\]\]$/, "");
  return r.endsWith(".md") || r.endsWith(".base") ? r : `${r}.md`;
}
