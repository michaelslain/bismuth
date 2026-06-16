// Split a note's raw markdown into a preserved PREFIX (frontmatter + an optional leading
// `# Title` heading that just repeats the card's own title) and the editable BODY beneath it.
//
// A body card edits only the BODY: frontmatter never shows in a card, and a leading H1 that
// merely duplicates the note's title reads as noise next to the card's title chip — so both are
// sliced off the front and kept verbatim in `prefix`. The card editor saves `prefix + body`, so
// the stripped parts round-trip losslessly (prefix is always a literal substring of the input).

export const FRONTMATTER_RE = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Strip a leading YAML frontmatter block (incl. an optional BOM). Pure. */
export function stripFrontmatter(text: string): string {
  return text.replace(FRONTMATTER_RE, "");
}
// Run of blank lines (each a possibly-indented empty line). Absorbs the spacing around a
// stripped title heading so the editable body starts at real content.
const BLANK_LINES_RE = /^(?:[ \t]*\r?\n)*/;
// A single leading ATX H1 line (`# heading`), capturing its text up to the newline.
const H1_LINE_RE = /^#[ \t]+([^\n]*?)[ \t]*(?:\r?\n|$)/;

export interface CardBodySplit {
  /** Frontmatter (+ a duplicated title heading) kept verbatim; re-prepended on every save. */
  prefix: string;
  /** The editable note body shown in the card editor. */
  body: string;
}

/**
 * Slice `raw` into `{ prefix, body }` such that `prefix + body === raw` exactly. Frontmatter is
 * always moved to the prefix. When `title` is given and the first content line is an H1 whose
 * text equals it, that heading — plus the blank lines around it — joins the prefix too, so the
 * card never shows its title twice. Pure; unit-tested in cardBodySplit.test.ts.
 */
export function splitCardBody(raw: string, title?: string): CardBodySplit {
  let pos = FRONTMATTER_RE.exec(raw)?.[0].length ?? 0;

  const wanted = title?.trim();
  if (wanted) {
    const lead = BLANK_LINES_RE.exec(raw.slice(pos))?.[0] ?? "";
    const afterLead = pos + lead.length;
    const h1 = H1_LINE_RE.exec(raw.slice(afterLead));
    if (h1 && h1[1].trim() === wanted) {
      let q = afterLead + h1[0].length;
      q += BLANK_LINES_RE.exec(raw.slice(q))?.[0].length ?? 0;
      pos = q;
    }
  }

  return { prefix: raw.slice(0, pos), body: raw.slice(pos) };
}

// A task line: `- [x] body` (any single status char between the brackets), possibly indented. The
// writers normalize the bullet to `-`, so a single-dash bullet is enough to recognize one.
const TASK_LINE = /^[ \t]*- \[.\] /;

export type CardMode = "body" | "tasks";

export interface CardSplit {
  /** Frontmatter (+ duplicate title; + in tasks mode the pre-checklist content) — re-prepended on save. */
  prefix: string;
  /** The editable region shown in the card editor. */
  body: string;
  /** In tasks mode, the note content AFTER the checklist — re-appended on save (empty in body mode). */
  suffix: string;
}

/**
 * Split `raw` into the editable region plus the surrounding text kept out of the editor, such that
 * `prefix + body + suffix === raw`. In "body" mode the editable region is the whole note body
 * (frontmatter + a duplicate title heading go to the prefix; suffix is empty). In "tasks" mode the
 * editable region is narrowed to the note's CHECKLIST — from its first task line to its last — so
 * the card stays a focused, fully-editable checklist (add / delete / retype task lines as normal
 * markdown); prose before the first task joins the prefix and anything after the last task joins the
 * suffix. A note with no task lines falls back to editing the whole body so the first task can still
 * be typed. Pure; unit-tested in cardBodySplit.test.ts.
 */
export function splitCard(raw: string, title: string | undefined, mode: CardMode): CardSplit {
  const base = splitCardBody(raw, title);
  if (mode !== "tasks") return { prefix: base.prefix, body: base.body, suffix: "" };

  const region = taskRegion(base.body);
  if (!region) return { prefix: base.prefix, body: base.body, suffix: "" };
  return {
    prefix: base.prefix + base.body.slice(0, region.start),
    body: base.body.slice(region.start, region.end),
    suffix: base.body.slice(region.end),
  };
}

/** Char offsets `[start, end)` of the checklist region within `body` — from the start of the first
 *  task line to the end of the last — or null when the body has no task lines. */
function taskRegion(body: string): { start: number; end: number } | null {
  const lines = body.split("\n");
  let first = -1;
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (TASK_LINE.test(lines[i])) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  let start = 0;
  for (let i = 0; i < first; i++) start += lines[i].length + 1; // + newline
  let end = start;
  for (let i = first; i <= last; i++) end += lines[i].length + (i < last ? 1 : 0);
  return { start, end };
}
