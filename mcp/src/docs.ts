// Pure docs index/search/read over the repo's docs/ tree (markdown).
//
// Token-frugal surface for the MCP server: list docs, search them returning
// only short snippets (never whole docs), and read a single doc or one of its
// heading-delimited sections. No external deps — node:fs + node:path only.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative, sep, basename } from "node:path";

export interface DocHit {
  path: string;
  heading: string;
  snippet: string;
  score: number;
}

// --- internal helpers -------------------------------------------------------

/** Recursively collect absolute paths of every *.md file under `root`. */
function walkMarkdown(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        out.push(full);
      }
    }
  }
  return out;
}

/** Normalize a filesystem-relative path to posix separators. */
function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/** First markdown "# " heading in `text`, else null. */
function firstH1(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}

/** Doc title: first "# " heading, else the filename (no extension). */
function docTitle(text: string, absPath: string): string {
  return firstH1(text) ?? basename(absPath).replace(/\.md$/i, "");
}

/** GitHub-style heading slug for #anchors. */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9 \-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

interface Section {
  /** Heading text. For the intro (text before the first heading) this is the doc title. */
  heading: string;
  /** Heading depth (number of leading `#`). 1 for the top/intro section. */
  level: number;
  /** Slug anchor, or "" for the top/intro section. */
  anchor: string;
  /** Section body text (excludes the heading line itself). */
  text: string;
}

/**
 * Split a doc into sections by markdown headings (## / ### / …). The text
 * preceding the first such heading becomes the intro section, keyed by the
 * doc title. The top-level "# " title line is treated as the intro's start
 * (its own line is dropped from the intro body).
 */
function splitSections(text: string, title: string): Section[] {
  const lines = text.split(/\r?\n/);
  const sections: Section[] = [];
  let cur: Section = { heading: title, level: 1, anchor: "", text: "" };
  const buf: string[] = [];

  const flush = () => {
    cur.text = buf.join("\n").trim();
    sections.push(cur);
    buf.length = 0;
  };

  for (const line of lines) {
    const h = /^(#{2,6})\s+(.+?)\s*$/.exec(line);
    if (h) {
      flush();
      const heading = h[2].trim();
      cur = { heading, level: h[1].length, anchor: slugify(heading), text: "" };
      continue;
    }
    // Drop the top-level "# Title" line from the intro body.
    if (cur.anchor === "" && /^#\s+/.test(line)) continue;
    buf.push(line);
  }
  flush();

  return sections;
}

/** Count case-insensitive occurrences of `term` in `haystackLower`. */
function countOccurrences(haystackLower: string, term: string): number {
  if (term.length === 0) return 0;
  let count = 0;
  let idx = haystackLower.indexOf(term);
  while (idx !== -1) {
    count++;
    idx = haystackLower.indexOf(term, idx + term.length);
  }
  return count;
}

/**
 * A ~200-char single-line snippet centered on the first match of any term,
 * with "…" elision on truncated ends.
 */
function makeSnippet(text: string, terms: string[]): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "";
  const lower = flat.toLowerCase();

  let first = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (first === -1 || i < first)) first = i;
  }
  if (first === -1) first = 0;

  const WINDOW = 200;
  let start = Math.max(0, first - Math.floor(WINDOW / 2));
  let end = Math.min(flat.length, start + WINDOW);
  start = Math.max(0, end - WINDOW);

  let snippet = flat.slice(start, end).trim();
  if (start > 0) snippet = "… " + snippet;
  if (end < flat.length) snippet = snippet + " …";
  return snippet;
}

/** Whitespace-split, lowercased, non-empty query terms. */
function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

// --- public API -------------------------------------------------------------

export function listDocs(docsRoot: string): { path: string; title: string }[] {
  const root = resolve(docsRoot);
  const result = walkMarkdown(root).map((abs) => {
    let text = "";
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      // unreadable file: fall back to filename title, empty body
    }
    return {
      path: toPosix(relative(root, abs)),
      title: docTitle(text, abs),
    };
  });
  result.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return result;
}

export function searchDocs(docsRoot: string, query: string, limit = 8): DocHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const root = resolve(docsRoot);
  const hits: DocHit[] = [];

  for (const abs of walkMarkdown(root)) {
    let text = "";
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const relPath = toPosix(relative(root, abs));
    const title = docTitle(text, abs);
    const titleLower = title.toLowerCase();

    for (const section of splitSections(text, title)) {
      const bodyLower = section.text.toLowerCase();
      const headingLower = section.heading.toLowerCase();

      let score = 0;
      for (const term of terms) {
        score += countOccurrences(bodyLower, term);
        if (headingLower.includes(term)) score += 5;
        if (titleLower.includes(term)) score += 2;
      }
      if (score <= 0) continue;

      const path = section.anchor ? `${relPath}#${section.anchor}` : relPath;
      hits.push({
        path,
        heading: section.heading,
        snippet: makeSnippet(section.text, terms),
        score,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export function readDoc(docsRoot: string, relPath: string, section?: string): string {
  const root = resolve(docsRoot);

  // Strip a trailing #anchor from the relative path before resolving.
  const cleanRel = relPath.replace(/#.*$/, "");
  const target = resolve(root, cleanRel);

  // Reject path traversal: the target must stay within docsRoot.
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new Error(`Path traversal rejected: ${relPath}`);
  }

  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new Error(`Doc not found: ${relPath}`);
  }

  const text = readFileSync(target, "utf8");
  if (section === undefined) return text;

  const wanted = section.toLowerCase().trim();
  const title = docTitle(text, target);
  for (const sec of splitSections(text, title)) {
    if (sec.heading.toLowerCase().trim() === wanted) {
      const prefix = `${"#".repeat(sec.level)} ${sec.heading}\n\n`;
      return (prefix + sec.text).trim();
    }
  }
  throw new Error(`Section not found in ${cleanRel}: ${section}`);
}
