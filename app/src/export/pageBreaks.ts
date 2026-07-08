// app/src/export/pageBreaks.ts
// Pure splitting of a note's raw markdown into page-break-delimited sections, for the PNG
// exporter (each section is rendered + rasterized independently and written as its OWN file
// — see exporters.ts's "png" case, since a single raster image can't represent more than one
// page) AND for the export preview (each section draws as its own visually distinct "sheet"
// — see exporters.ts renderPreview). PDF instead honors the SAME marker by slicing the
// rendered CANVAS at each marker's div (htmlToPdf.ts) — that path needs no text-level split,
// since one PDF can hold many pages.
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
 * The sections a page-break-aware render works from — the PNG export writes one file per
 * entry and the preview draws one "sheet" per entry, sharing this one model so the two can
 * never disagree. Frontmatter is sliced off FIRST — before splitting — so a marker placed
 * right after the frontmatter block doesn't make "page 1" just the frontmatter; the body is
 * then split on page-break markers, and any section left blank after trimming is dropped (a
 * marker at the very start/end of the body, or two adjacent markers, would otherwise produce
 * an empty page). Always returns at least one section — a blank note yields `[""]`, not `[]`.
 *
 * `includeFrontmatter` mirrors ExportOptions.includeFrontmatter: when true, the note's
 * frontmatter block is RE-PREPENDED to the first surviving section (so it renders as prose
 * at the top of page 1, exactly like the single-page and PDF paths), but it never counts
 * as — or produces — a page of its own. When false (the default) it is simply dropped.
 * Either way the section COUNT is identical, so page numbering never shifts with the toggle.
 */
export function pageSections(text: string, includeFrontmatter = false): string[] {
  const body = stripFrontmatter(text);
  const sections = splitByPageBreaks(body).filter((s) => s.trim() !== "");
  if (sections.length === 0) sections.push("");
  if (includeFrontmatter && body.length < text.length) {
    // stripFrontmatter removes a leading prefix, so the frontmatter block is exactly the
    // slice it dropped — re-prepend it verbatim to the first real page.
    sections[0] = text.slice(0, text.length - body.length) + sections[0];
  }
  return sections;
}
