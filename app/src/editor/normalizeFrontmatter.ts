// app/src/editor/normalizeFrontmatter.ts
// Pure, DOM-free helper that enforces exactly one blank line between a note's YAML
// frontmatter (the `---` … `---` block) and its body. Used by the editor to auto-format
// notes on open. NO CodeMirror imports, so it runs under `bun test` without a browser.

import { extractFrontmatterBoundary } from "./frontmatterUtils";

/**
 * Return `doc` with exactly one blank line between the closing frontmatter fence and the
 * body. Collapses zero or many blank lines down to one, is idempotent, and preserves the
 * document's line-ending style (LF vs CRLF).
 *
 * Left unchanged when there is:
 *  - no well-formed frontmatter (no opening fence on line 1, or never closed), or
 *  - frontmatter but no body (closing fence is the last line / body is only whitespace).
 */
export function normalizeFrontmatterSpacing(doc: string): string {
  const fm = extractFrontmatterBoundary(doc);
  if (!fm) return doc; // no frontmatter → leave the document untouched

  // Locate the closing fence and the line ending that terminates it. `fm.to` is the end of
  // the frontmatter body (before the newline preceding the fence), so the slice from there
  // begins with that newline + the `---` line.
  const closeRe = /^---[ \t]*(\r?\n|$)/m;
  const m = closeRe.exec(doc.slice(fm.to));
  if (!m) return doc; // unreachable (boundary already matched) — be defensive
  const fenceEol = m[1]; // "\n" | "\r\n" | "" (closing fence is the final line, no newline)
  if (fenceEol === "") return doc; // frontmatter only, no body → nothing to space

  const bodyStart = fm.to + m.index + m[0].length; // first char past the closing fence line
  const prefix = doc.slice(0, bodyStart); // ends with `---` + its line ending
  const body = doc.slice(bodyStart).replace(/^(?:[ \t]*\r?\n)+/, ""); // drop leading blank lines

  if (body === "") return doc; // body is only blank lines/whitespace → leave as-is
  return prefix + fenceEol + body; // one extra line ending == exactly one blank line
}

/**
 * Smallest single-range edit that turns `a` into `b` — the differing middle, with the
 * common prefix/suffix trimmed off. Dispatching this (instead of a full-document replace)
 * lets CodeMirror map the selection/cursor through the change so it stays put.
 */
export function minimalChange(a: string, b: string): { from: number; to: number; insert: string } {
  const min = Math.min(a.length, b.length);
  let p = 0;
  while (p < min && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < min - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return { from: p, to: a.length - s, insert: b.slice(p, b.length - s) };
}
