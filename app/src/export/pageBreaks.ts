// app/src/export/pageBreaks.ts
// Pure splitting of a note's raw markdown into page-break-delimited sections, for the PNG
// exporter: each section is rendered + rasterized independently and written as its OWN file
// (see exporters.ts's "png" case), since a single raster image can't represent more than one
// page. PDF instead honors the SAME marker by slicing the rendered CANVAS at each marker's
// div (htmlToPdf.ts) — that path needs no text-level split, since one PDF can hold many pages.
import { maskCode, unmaskCode, PAGEBREAK_RE } from "../bases/markdown";
import { stripFrontmatter } from "../bases/cardBodySplit";

/**
 * Split markdown `text` at every lone `<!-- pagebreak -->` marker line — the exact marker
 * `bases/markdown.ts` turns into a `.bismuth-page-break` div for on-screen/PDF rendering. A
 * marker sitting inside a fenced/inline code span is masked out first, so it stays literal
 * rather than splitting the document (mirrors `pageBreaksToDivs`'s own masking).
 *
 * No markers → a single-element array holding the whole text unchanged, so callers can treat
 * "no markers" and "one page" identically. Pure; unit-tested in pageBreaks.test.ts.
 */
export function splitByPageBreaks(text: string): string[] {
  const { masked, codes } = maskCode(text);
  return masked.split(PAGEBREAK_RE).map((section) => unmaskCode(section, codes));
}

/**
 * The sections a PNG export should render as separate files. Frontmatter is stripped FIRST —
 * before splitting — so a marker placed right after the frontmatter block doesn't make "page
 * 1" just the frontmatter; the body is then split on page-break markers, and any section left
 * blank after trimming is dropped (a marker at the very start/end of the body, or two adjacent
 * markers, would otherwise produce an empty page). Always returns at least one section — a
 * blank note yields `[""]` rather than `[]`.
 *
 * This ALWAYS strips frontmatter regardless of the export's `includeFrontmatter` option: that
 * toggle controls whether frontmatter shows up in a single-page render, but page-break
 * splitting is about paginating the note's CONTENT, and frontmatter (config, not content) never
 * belongs on a page of its own.
 */
export function pageSections(text: string): string[] {
  const sections = splitByPageBreaks(stripFrontmatter(text)).filter((s) => s.trim() !== "");
  return sections.length > 0 ? sections : [""];
}
