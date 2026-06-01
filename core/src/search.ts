// core/src/search.ts
// Vault full-text search: a pure line matcher (findMatches) for snippets/replace,
// plus MiniSearch-backed ranking (searchVault) modeled on the Omnisearch plugin.
import MiniSearch from "minisearch";
import { listMarkdown, readNote } from "./files";

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

/** Extract #tags from the body for index weighting. */
function extractTags(body: string): string {
  return (body.match(/(?:^|\s)#([A-Za-z0-9_/-]+)/g) || []).map((t) => t.trim().slice(1)).join(" ");
}

interface IndexDoc {
  id: string; // path
  basename: string;
  headings: string;
  tags: string;
  body: string;
}

function basenameOf(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/, "");
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
  const paths = await listMarkdown(root);
  const bodies = new Map<string, string>();
  const docs: IndexDoc[] = [];
  for (const p of paths) {
    const body = await readNote(root, p);
    bodies.set(p, body);
    docs.push({ id: p, basename: basenameOf(p), headings: extractHeadings(body), tags: extractTags(body), body });
  }

  let ordered: string[];
  if (opts.regex) {
    ordered = paths;
  } else {
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
