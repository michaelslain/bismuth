// core/src/changeClassifier.ts
//
// Decides whether a file change actually affects the knowledge graph or the file
// tree. The graph is built only from a note's wikilinks + tags; the tree shows
// only structure + the frontmatter `icon`/`visibility`. Everything else in a
// file's content (prose, task lines, status tables, other frontmatter values) is
// irrelevant to both.
//
// This lets the server stay completely silent toward graph/tree consumers when a
// file is rewritten without changing its connections — e.g. a bot status file
// that gets stamped with a fresh timestamp every couple of seconds.
import { parseFrontmatter } from "./frontmatter";
import { extractTags } from "./tags";
import { extractWikilinks } from "./wikilinks";

export interface Fingerprint {
  /** Wikilink targets, order-independent. */
  links: string;
  /** Tags, order-independent. */
  tags: string;
  /** Frontmatter `icon`, or "" if absent. */
  icon: string;
  /** Frontmatter `visibility`, or "" if absent. */
  visibility: string;
}

/** What a change touched. */
export interface Dirty {
  graph: boolean;
  tree: boolean;
}

const norm = (xs: string[]): string => [...new Set(xs)].sort().join("\n");

/** Derive the graph/tree-relevant fingerprint of a note from its raw content. */
export function extractFingerprint(content: string): Fingerprint {
  const { data, body } = parseFrontmatter(content);
  return {
    links: norm(extractWikilinks(content)),
    tags: norm(extractTags(data, body)),
    icon: typeof data.icon === "string" ? data.icon : "",
    visibility: typeof data.visibility === "string" ? data.visibility : "",
  };
}

/**
 * How many debounce intervals a batch may keep growing before it is flushed anyway.
 * The file watcher coalesces with a RESETTING debounce, which alone has no upper bound:
 * while something writes faster than `debounceMs` — an agent editing a run of files over
 * a terminal/chat session, a bulk move, a git checkout — the timer is re-armed on every
 * event and the sidebar/graph never refresh until the writer finally pauses. Capping the
 * total window keeps bursts coalesced while guaranteeing the UI still updates during one.
 * Derived from the configured debounce (rather than a separate setting) so raising
 * `server.fileWatchDebounceMs` widens both windows together.
 */
export const MAX_COALESCE_INTERVALS = 4;

/**
 * Delay before flushing the pending watch batch: the normal debounce, shortened so the
 * batch never spans more than `MAX_COALESCE_INTERVALS * debounceMs` from its first event.
 * `firstPendingAt === 0` means the batch is empty (nothing accumulating yet).
 * Never negative — an already-overdue batch flushes on the next tick.
 */
export function flushDelayMs(now: number, firstPendingAt: number, debounceMs: number): number {
  if (firstPendingAt === 0) return debounceMs;
  const deadline = firstPendingAt + debounceMs * MAX_COALESCE_INTERVALS;
  return Math.max(0, Math.min(debounceMs, deadline - now));
}

/** True when a changed path is the vault settings file (drives registry re-parse + SSE).
 *  Settings live in the single `.settings` file; the legacy root `settings.yaml` and the interim
 *  `.settings/settings.yaml` are still matched during the migration window. */
export function isSettingsPath(path: string): boolean {
  return path === ".settings" || path === "settings.yaml" || path === ".settings/settings.yaml";
}

/**
 * Compare a file's previous and current fingerprints.
 * - A missing prev (new/first-seen file) or missing next (deleted file) is
 *   treated as fully structural — both graph and tree are dirty.
 * - Otherwise, links/tags drive the graph; icon drives the tree.
 */
export function diffFingerprints(
  prev: Fingerprint | undefined,
  next: Fingerprint | null,
): Dirty {
  if (!prev || !next) return { graph: true, tree: true };
  return {
    graph: prev.links !== next.links || prev.tags !== next.tags,
    tree: prev.icon !== next.icon || prev.visibility !== next.visibility,
  };
}

/** Reads a note's current content, or null if it no longer exists. */
export type ReadContent = (path: string) => Promise<string | null>;

export interface ChangeTracker {
  /**
   * Re-fingerprint each changed path against its last-known state and report the
   * aggregate dirtiness. Updates the internal store as it goes, so the next call
   * compares against this one.
   */
  classify(paths: string[], read: ReadContent): Promise<Dirty>;
}

/** Stateful tracker of per-file fingerprints, decoupled from any file system. */
export function createChangeTracker(): ChangeTracker {
  const fps = new Map<string, Fingerprint>();
  return {
    async classify(paths, read) {
      let graph = false;
      let tree = false;
      for (const p of paths) {
        const content = await read(p);
        const prev = fps.get(p);
        const next = content === null ? null : extractFingerprint(content);
        const d = diffFingerprints(prev, next);
        graph ||= d.graph;
        tree ||= d.tree;
        if (next) fps.set(p, next);
        else fps.delete(p);
      }
      return { graph, tree };
    },
  };
}
