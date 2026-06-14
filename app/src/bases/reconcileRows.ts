// Value-stable identity for a re-resolved ViewResult.
//
// Every server revalidation re-runs `/rows` + `runView`, producing brand-new group and
// row OBJECTS even when the underlying data is unchanged. Solid's `<For>` keys by object
// IDENTITY, so those fresh objects unmount→remount every card/row in the view — the whole
// card grid repaints and the masonry reflows. That full repaint is the "flickery/reloady"
// feel on a task status change: toggling one checkbox writes the file, the SSE version
// bumps, the base re-resolves, and all cards blink even though only one changed.
//
// reconcileViewResult diffs the freshly computed result against the PREVIOUS one and reuses
// the prior object reference for any group/row that is byte-identical. `<For>` then sees the
// same references and preserves their DOM — only genuinely changed/added/removed rows touch
// the DOM. Pure (no Solid, no I/O) so it's unit-tested in isolation; BaseView feeds it the
// memo's previous value via `createMemo((prev) => …)`.
import type { Row, ViewResult, ResultGroup } from "../../../core/src/bases/types";

/** Stable key for a row across re-resolves: tasks are `path:line` (many per note), every
 *  other row is keyed by path. Collisions are harmless — a key is only ever reused when the
 *  rows are also deep-equal (see rowsEqual), so an ambiguous key can't reuse a wrong row. */
export function rowKey(row: Row): string {
  const line = (row.note as { line?: unknown } | undefined)?.line;
  return typeof line === "number" ? `${row.file.path}:${line}` : row.file.path;
}

/** The file fields a view actually renders — name/path/folder/ext + tags/links. The volatile
 *  stat fields (mtime/ctime/size) are deliberately EXCLUDED: a body-only edit (e.g. ticking a
 *  task inside a card) bumps mtime but changes nothing a view displays except the note body,
 *  which BodyCard re-reads in place (it subscribes to SSE). Including mtime here would give the
 *  edited row a fresh identity and remount its card on every keystroke-driven save — the exact
 *  flicker we're removing. Trade-off: a view that surfaces `file.mtime` as a column shows a
 *  slightly stale timestamp until the row changes structurally; that's rare and benign. */
function fileIdentity(f: Row["file"]): unknown {
  return { name: f.name, path: f.path, folder: f.folder, ext: f.ext, tags: f.tags, links: f.links };
}

/** Comparison of the parts a view renders. Any change a view can SHOW — a flipped status char,
 *  an edited description, a changed frontmatter prop or formula value, a new tag/link — yields a
 *  fresh identity so that one row repaints; an unchanged row keeps its old reference (and its
 *  DOM). Rows are small plain JSON from the same code path each resolve, so key order is
 *  deterministic. (Volatile stat fields are excluded — see fileIdentity.) */
export function rowsEqual(a: Row, b: Row): boolean {
  if (a === b) return true;
  return (
    JSON.stringify(fileIdentity(a.file)) === JSON.stringify(fileIdentity(b.file)) &&
    JSON.stringify(a.note) === JSON.stringify(b.note) &&
    JSON.stringify(a.formula) === JSON.stringify(b.formula)
  );
}

/** Reconcile a freshly resolved row list against the previous one, reusing prior references
 *  for unchanged rows. Returns the PREVIOUS array reference verbatim when nothing changed at
 *  all (same length, order, and every row reused) so callers can cheaply reuse the enclosing
 *  group object too. */
export function reconcileRows(prev: Row[] | undefined, next: Row[]): Row[] {
  if (!prev || prev.length === 0) return next;
  const byKey = new Map<string, Row>();
  for (const r of prev) byKey.set(rowKey(r), r);
  let allSame = prev.length === next.length;
  const out = next.map((r, i) => {
    const old = byKey.get(rowKey(r));
    if (old && rowsEqual(old, r)) {
      if (old !== prev[i]) allSame = false; // reused, but reordered
      return old;
    }
    allSame = false;
    return r;
  });
  return allSame ? prev : out;
}

/** Reconcile a whole ViewResult: reuse each group object whose rows are unchanged, and within
 *  each group reuse unchanged row objects. `columns`/`summaries`/`view` come straight from the
 *  fresh result (cheap scalars/short arrays — no identity churn that matters to `<For>`). */
export function reconcileViewResult(prev: ViewResult | undefined, next: ViewResult): ViewResult {
  if (!prev) return next;
  const prevByKey = new Map<string, ResultGroup>();
  for (const g of prev.groups) prevByKey.set(g.key, g);
  const groups = next.groups.map((ng) => {
    const pg = prevByKey.get(ng.key);
    if (!pg) return ng;
    const rows = reconcileRows(pg.rows, ng.rows);
    // Group fully unchanged → reuse the prior group object so `<For each={groups}>` keeps it.
    return rows === pg.rows ? pg : { key: ng.key, rows };
  });
  return { view: next.view, columns: next.columns, groups, summaries: next.summaries };
}
