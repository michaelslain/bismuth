// core/src/search.ts
// Vault full-text search: a pure line matcher (findMatches) for snippets/replace,
// plus MiniSearch-backed ranking (searchVault) modeled on the Omnisearch plugin.
import MiniSearch from "minisearch";
import { getFileAccess } from "./fileAccess";
import { fileBasename } from "./pathUtils";

export interface SearchOpts {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface MatchSnippet {
  /** 1-based line number of the match. */
  line: number;
  /** Text on the line before the match. */
  before: string;
  /** The matched text. */
  match: string;
  /** Text on the line after the match. */
  after: string;
}

export interface SearchResult {
  path: string;
  matchCount: number;
  snippets: MatchSnippet[];
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a global RegExp for `query` honoring the toggles. Throws on an invalid
 * pattern when regex mode is on. Always global so callers can iterate matches.
 */
export function buildMatcher(query: string, opts: SearchOpts): RegExp {
  let source = opts.regex ? query : escapeRegExp(query);
  if (opts.wholeWord) source = `\\b(?:${source})\\b`;
  const flags = "g" + (opts.caseSensitive ? "" : "i");
  return new RegExp(source, flags);
}

/** Find every match of `query` in `body`, with 1-based line numbers and split context. */
export function findMatches(body: string, query: string, opts: SearchOpts): MatchSnippet[] {
  if (!query) return [];
  const re = buildMatcher(query, opts);
  const out: MatchSnippet[] = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      out.push({
        line: i + 1,
        before: line.slice(0, m.index),
        match: m[0],
        after: line.slice(m.index + m[0].length),
      });
      if (m[0].length === 0) re.lastIndex++; // avoid zero-width infinite loop
    }
  }
  return out;
}

/** Extract markdown heading text (lines starting with #) for index weighting. */
function extractHeadings(body: string): string {
  return body
    .split("\n")
    .filter((l) => /^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^#{1,6}\s/, ""))
    .join(" ");
}

// Mirror tags.ts INLINE_TAG_REGEX exactly so search tag tokens match the graph's tag
// set (first char must be alnum/underscore). Kept as a literal rather than imported
// because tags.ts does not export it.
const INLINE_TAG_REGEX = /(?:^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;

/** Extract #tags from the body for index weighting. */
function extractBodyTags(body: string): string {
  // matchAll over a fresh regex avoids shared /g lastIndex state across calls.
  return [...body.matchAll(INLINE_TAG_REGEX)].map((m) => m[1]).join(" ");
}

interface IndexDoc {
  id: string; // path
  basename: string;
  headings: string;
  tags: string;
  body: string;
}

// Per-vault cached search index: the built MiniSearch index plus the per-path body map.
// listMarkdown + readNote over the whole vault on every keystroke-driven search is the
// hot cost; this builds once and reuses until a file-watch change invalidates it (see
// invalidateSearchIndex, wired into the server's applyDirty path). Results are identical
// to the uncached path for a given vault state because the index/bodies are rebuilt from
// the same listMarkdown + readNote inputs.
interface SearchIndex {
  mini: MiniSearch<IndexDoc>;
  bodies: Map<string, string>;
  paths: string[];
}
const indexCache = new Map<string, SearchIndex>();
// Dedupe concurrent cold builds for the same vault (mirrors AsyncCache's in-flight guard).
const indexInFlight = new Map<string, Promise<SearchIndex>>();
// Per-root generation counter (mirrors AsyncCache's generation guard): captured when a
// build starts and re-checked when it settles, so an invalidateSearchIndex() during the
// build drops the now-stale result instead of repopulating the cache with it.
const indexGeneration = new Map<string, number>();

/** Drop the cached search index for a vault (or all vaults). Called on file-watch invalidation. */
export function invalidateSearchIndex(root?: string): void {
  if (root === undefined) {
    indexCache.clear();
    indexInFlight.clear();
    indexGeneration.clear();
  } else {
    indexCache.delete(root);
    indexInFlight.delete(root);
    indexGeneration.set(root, (indexGeneration.get(root) ?? 0) + 1);
  }
}

/**
 * Incrementally patch the cached search index for the changed `paths` — re-reading just those notes
 * instead of dropping the whole index and re-walking the vault on the next /search (which was the cold
 * cost paid after every edit). No-op when no .md changed. When nothing is cached yet, fall back to a
 * full invalidation (which also drops any in-flight build, so the next search rebuilds from current
 * files). Per path: gone-from-disk → discard; already-indexed → replace; new → add. `bodies` is the
 * authority for "is this path indexed". Mutates the cached index in place.
 */
export async function updateSearchIndex(root: string, paths: string[]): Promise<void> {
  const idx = indexCache.get(root);
  if (!idx) { invalidateSearchIndex(root); return; }
  const mdPaths = paths.filter((p) => p.endsWith(".md"));
  if (mdPaths.length === 0) return;
  const { readNote } = await getFileAccess();
  for (const p of mdPaths) {
    let body: string | null;
    try {
      body = await readNote(root, p);
    } catch {
      body = null; // unreadable / removed
    }
    const indexed = idx.bodies.has(p);
    if (body === null) {
      if (indexed) {
        idx.mini.discard(p);
        idx.bodies.delete(p);
        const i = idx.paths.indexOf(p);
        if (i >= 0) idx.paths.splice(i, 1);
      }
      continue;
    }
    const doc: IndexDoc = { id: p, basename: fileBasename(p), headings: extractHeadings(body), tags: extractBodyTags(body), body };
    if (indexed) {
      idx.mini.replace(doc);
    } else {
      idx.mini.add(doc);
      idx.paths.push(p);
    }
    idx.bodies.set(p, body);
  }
}

// Cap on concurrent file reads during a cold index build. Reading every note serially made the cold
// build's wall time the SUM of all per-file read latencies; reading them concurrently collapses that to
// roughly one round-trip. Bounded so a huge vault can't exhaust file descriptors / spike memory.
const BUILD_READ_CONCURRENCY = 32;

async function buildSearchIndex(root: string): Promise<SearchIndex> {
  const { listMarkdown, readNote } = await getFileAccess();
  const paths = await listMarkdown(root);
  const bodies = new Map<string, string>();
  const docs: IndexDoc[] = new Array(paths.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= paths.length) return;
      const p = paths[i];
      const body = await readNote(root, p);
      bodies.set(p, body);
      docs[i] = { id: p, basename: fileBasename(p), headings: extractHeadings(body), tags: extractBodyTags(body), body };
    }
  };
  await Promise.all(Array.from({ length: Math.min(BUILD_READ_CONCURRENCY, paths.length) }, worker));
  const mini = new MiniSearch<IndexDoc>({
    fields: ["basename", "headings", "tags", "body"],
    storeFields: ["id"],
    searchOptions: {
      boost: { basename: 6, headings: 3, tags: 2, body: 1 },
      prefix: true,
      fuzzy: (term) => (term.length > 3 ? 0.2 : false),
    },
  });
  mini.addAll(docs);
  return { mini, bodies, paths };
}

async function getSearchIndex(root: string): Promise<SearchIndex> {
  const cached = indexCache.get(root);
  if (cached) return cached;
  const pending = indexInFlight.get(root);
  if (pending) return pending;
  const gen = indexGeneration.get(root) ?? 0;
  const build = buildSearchIndex(root).then(
    (idx) => {
      indexInFlight.delete(root);
      // Adopt the result only if no invalidation bumped the generation mid-build.
      if ((indexGeneration.get(root) ?? 0) === gen) indexCache.set(root, idx);
      return idx;
    },
    (err) => {
      indexInFlight.delete(root);
      throw err;
    },
  );
  indexInFlight.set(root, build);
  return build;
}

/**
 * Rank vault notes for `query` and attach per-note match snippets.
 *
 * When regex mode is OFF, MiniSearch (BM25, fuzzy for longer terms, prefix match)
 * ranks the notes; filename/headings/tags are boosted above body. When regex mode
 * is ON, MiniSearch can't parse the pattern, so we scan every note and rank by
 * match count. Either way, snippets are computed with the same findMatches matcher
 * so highlighting is exact.
 */
export async function searchVault(root: string, query: string, opts: SearchOpts): Promise<SearchResult[]> {
  if (!query) return [];
  const { mini, bodies, paths } = await getSearchIndex(root);

  let ordered: string[];
  if (opts.regex) {
    ordered = paths;
  } else {
    const hits = mini.search(query);
    ordered = hits.map((h) => h.id as string);
  }

  const results: SearchResult[] = [];
  for (const p of ordered) {
    const snippets = findMatches(bodies.get(p) ?? "", query, opts).slice(0, 20);
    if (snippets.length === 0) continue; // a ranked hit with no literal match in body
    results.push({ path: p, matchCount: snippets.length, snippets });
  }
  // When regex (no BM25 order), sort by match count desc for a useful order.
  if (opts.regex) results.sort((a, b) => b.matchCount - a.matchCount);
  return results;
}
