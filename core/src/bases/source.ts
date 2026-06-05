import type { Row, SourceSpec } from "./types";
import { buildVaultRows } from "../basesData";
import { buildTaskRows, filterTaskRows } from "./tasksData";
import { parseBaseFile } from "./parse";
import { passesFilter } from "./filters";
import { toContext } from "./query";
import { getFileAccess } from "../fileAccess";
import { fileBasename } from "../pathUtils";
import { refToPath } from "./sourceSpec";

export interface SourceCtx {
  root: string;
  today?: string;
  /** Base file paths already entered, for cycle protection across composition.
   *  Paths are resolved to their real paths (symlinks dereferenced) before adding to prevent
   *  symlink-based cycles (e.g., A -> link-to-A -> A). */
  seen?: Set<string>;
}

/**
 * Resolve a base FILE to its rows, following its OWN declared source (composition).
 * An own-rows base (no `source:`) returns its inline table rows; a base whose source
 * is notes/tasks/another-base re-runs that source. Cycles terminate via `seen` after
 * resolving symlinks to prevent symlink-based loops.
 */
export async function resolveBaseRows(path: string, ctx: SourceCtx): Promise<Row[]> {
  const seen = ctx.seen ?? new Set<string>();
  const fa = await getFileAccess();

  // Resolve symlinks to their real paths to detect cycles even through symlink chains.
  // E.g., if A -> link-to-A or A -> B -> link-to-A, both are caught. Best-effort:
  // realPath() falls back to the input path when it can't resolve (e.g. on iOS).
  const realPath = await fa.realPath(path);

  if (seen.has(realPath)) return []; // cycle: A -> ... -> A (possibly through symlinks)
  seen.add(realPath);

  let text: string;
  try {
    text = await fa.readNote(ctx.root, path);
  } catch {
    return [];
  }
  const name = fileBasename(path);
  const { config, rows } = parseBaseFile(text, { name, path });
  // No declared source => inline (own-rows) base: return its table rows.
  if (!config.source) return rows;
  return resolveSource(config.source, { ...ctx, seen });
}

/** Resolve any source (base | notes | tasks) to a uniform Row[]. */
export async function resolveSource(spec: SourceSpec, ctx: SourceCtx): Promise<Row[]> {
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);

  if (spec.kind === "base") {
    if (!spec.ref) return [];
    return resolveBaseRows(refToPath(spec.ref), ctx);
  }

  if (spec.kind === "notes") {
    let rows = await buildVaultRows(ctx.root);
    if (spec.from) {
      const scoped = await resolveBaseRows(refToPath(spec.from), ctx);
      const paths = new Set(scoped.map((r) => r.file.path));
      rows = rows.filter((r) => paths.has(r.file.path));
    }
    if (!spec.where) return rows;
    return rows.filter((r) => passesFilter(spec.where!, toContext(r)));
  }

  // tasks — optionally scoped to the notes a referenced base selects.
  let paths: string[] | undefined;
  if (spec.from) {
    const scoped = await resolveBaseRows(refToPath(spec.from), ctx);
    paths = [...new Set(scoped.map((r) => r.file.path))].filter(Boolean);
  }
  const rows = await buildTaskRows(ctx.root, paths);
  return spec.where ? filterTaskRows(rows, spec.where, today) : rows;
}
