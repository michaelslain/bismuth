// Decides whether an SSE server change can affect a given base view's rows — so BaseView
// can skip re-resolving + re-rendering on changes that provably don't matter. Without this,
// a busy vault (e.g. the claude-bot daemon rewriting DAEMON.md every ~2s) re-resolves every
// open base continuously and pegs CPU.
//
// Pure + dependency-free (only types) so it's unit-tested in isolation. BaseView calls
// changeAffectsView() with the current resolution's deps.
import type { FilterNode, SourceSpec } from "../../../core/src/bases/types";
import type { ServerChange } from "../serverVersion";

// A filter leaf (a Bases expression) is "file-structural only" when every identifier it
// references is file.* (tag/folder/name/path/link) or a literal — so its membership can change
// ONLY via a graph-dirty (tag/link) or tree-dirty (rename/move/icon) event, never a content-only
// edit. Anything else (note./formula./bare frontmatter props, comparisons, date fns) is
// content-dependent. Conservative: unrecognized → content-dependent. String literals are
// stripped first so a tag/folder NAME in quotes isn't mistaken for a property identifier.
export function leafIsFileStructuralOnly(leaf: string): boolean {
  const noStrings = leaf.replace(/"[^"]*"|'[^']*'/g, " ");
  const idents = noStrings.match(/[A-Za-z_][\w.]*/g) ?? [];
  return idents.every((id) => id === "file" || id.startsWith("file.") || id === "true" || id === "false" || id === "null");
}

/** True if any leaf in the filter tree is content-dependent (references a frontmatter/formula
 *  property), so a content-only edit could change membership and the view must re-resolve. */
export function hasPropertyFilters(node: FilterNode | undefined): boolean {
  if (!node) return false;
  if (typeof node === "string") return !leafIsFileStructuralOnly(node);
  const kids = "and" in node ? node.and : "or" in node ? node.or : node.not;
  return (kids ?? []).some(hasPropertyFilters);
}

export interface ViewDeps {
  baseFilters?: FilterNode;
  viewFilters: (FilterNode | undefined)[];
  spec?: SourceSpec;
  /** The note paths this view already depends on: its resolved row notes + base file + host note. */
  relevantPaths: Set<string>;
}

/**
 * Whether a server change can affect this view's rows. `deps` is null until the first
 * resolution lands (treated as "affects" — safe). Branch order matters:
 *   - no dirty (poll catch-up, unknown extent) → affects (be safe)
 *   - dirty.tree (new/renamed/removed/icon note may newly match) → affects
 *   - paths empty + !tree → memory-only (3rd brain); never feeds vault rows → does NOT affect
 *   - dirty.graph (a vault tag/link edit may change filter membership) → affects
 *   - else content-only vault edit → affects only if the view is content-dependent
 *     (property-value filter / `where` / scoped `from:` / composed `ref:`) OR a changed path
 *     is already one this view depends on.
 */
export function changeAffectsView(c: ServerChange, deps: ViewDeps | null): boolean {
  if (!c.dirty) return true;
  if (c.dirty.tree) return true;
  if (c.paths.length === 0) return false;
  if (c.dirty.graph) return true;
  if (!deps) return true;
  const s = deps.spec;
  const scopedOrComposed =
    s?.kind === "base"
      ? !!s.ref
      : s
        ? !!s.from || (!!s.where && !leafIsFileStructuralOnly(s.where))
        : false;
  if (scopedOrComposed || hasPropertyFilters(deps.baseFilters) || deps.viewFilters.some(hasPropertyFilters)) {
    return true;
  }
  return c.paths.some((p) => deps.relevantPaths.has(p));
}
