// core/src/changeClassifier.ts
//
// Decides whether a file change actually affects the knowledge graph or the file
// tree. The graph is built only from a note's wikilinks + tags; the tree shows
// only structure + the frontmatter `icon`. Everything else in a file's content
// (prose, task lines, status tables, frontmatter values) is irrelevant to both.
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
  };
}

/** True when a changed path is the vault settings file (drives registry re-parse + SSE).
 *  Settings live at `.settings/settings.yaml`; the legacy root path is still matched
 *  during the migration window. */
export function isSettingsPath(path: string): boolean {
  return path === ".settings/settings.yaml" || path === "settings.yaml";
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
    tree: prev.icon !== next.icon,
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
