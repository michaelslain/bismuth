// Builds the HTML for a BodyCard's note body, rendering EVERY checkbox task line as a
// uniform status-bearing marker (`<span class="oa-task-box" data-line data-status>`) instead
// of relying on marked's GFM checkbox. marked only emits an <input> for `[ ]`/`[x]` — `[/]`
// (in progress) and `[-]` (cancelled) render as plain text with no checkbox — so a positional
// checkbox→line mapping silently misaligns the moment those statuses appear. Emitting our own
// marker per task line gives a 1:1, status-aware, right-clickable target for every status, and
// `data-line` (the ABSOLUTE source-file line, frontmatter included) maps a click straight back
// to the line to rewrite — no index counting.
import { renderNoteBody } from "./markdown";
import { stripFrontmatter } from "./cardBodySplit";
import { escapeAttr } from "../htmlEscape";

// `- [<one char>] body` — the bullet is normalized to `-` by the writers (toggleTaskLine /
// setTaskLineStatus), so a single `-` bullet is all the card needs to recognize.
const TASK_LINE_CAP = /^(\s*)- \[(.)\] (.*)$/;
const HEADING_RE = /^#{1,6}\s/;

// Drop headings with no remaining content beneath them (their tasks all moved to the
// completed section) so an all-done card collapses to title + "N completed".
function pruneEmptyHeadings(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) {
      let hasContent = false;
      for (let j = i + 1; j < lines.length && !HEADING_RE.test(lines[j]); j++) {
        if (lines[j].trim() !== "") { hasContent = true; break; }
      }
      if (!hasContent) continue;
    }
    out.push(lines[i]);
  }
  return out;
}

// A "resolved" task — done (`x`/`X`) or cancelled (`-`) — is tucked into the collapsible
// "completed" section, Google-Keep style. Todo (`[ ]`) and in-progress (`[/]`) are ACTIVE
// work and stay in the open section (so marking a task in-progress doesn't make it vanish).
export function isResolvedStatus(status: string): boolean {
  return status === "x" || status === "X" || status === "-";
}

function markerFor(status: string, line: number): string {
  return `<span class="oa-task-box" data-status="${escapeAttr(status)}" data-line="${line}"></span>`;
}

export interface TaskCardParts {
  openHtml: string;
  doneHtml: string;
  doneCount: number;
}

interface Entry { text: string; line: number; status: string | null }

/**
 * Partition a note body into the open section (rendered up top) and the resolved-task
 * section (inside the "N completed" expander), each as task-marker HTML. In `"tasks"` mode
 * only checklist lines are kept (as if the file were just its todo list). Pure — unit-tested
 * in taskCardMarkup.test.ts.
 */
export function buildTaskCardParts(content: string, mode?: "body" | "tasks"): TaskCardParts {
  const rawLines = content.split("\n");
  const strippedLines = stripFrontmatter(content).split("\n");
  // Lines removed off the top by frontmatter-stripping; add it back so each marker's
  // `data-line` is the absolute index into the original file (what /tasks/toggle expects).
  const offset = rawLines.length - strippedLines.length;

  let entries: Entry[] = strippedLines.map((text, j) => {
    const m = TASK_LINE_CAP.exec(text);
    return { text, line: j + offset, status: m ? m[2] : null };
  });
  if (mode === "tasks") entries = entries.filter((e) => e.status !== null);

  const toMarkup = (e: Entry): string => {
    if (e.status === null) return e.text;
    const m = TASK_LINE_CAP.exec(e.text)!;
    const [, indent, status, body] = m;
    return `${indent}- ${markerFor(status, e.line)}${body}`;
  };

  const isResolved = (e: Entry): boolean => e.status !== null && isResolvedStatus(e.status);
  const open = entries.filter((e) => !isResolved(e));
  const done = entries.filter(isResolved);

  return {
    openHtml: renderNoteBody(pruneEmptyHeadings(open.map(toMarkup)).join("\n")),
    doneHtml: renderNoteBody(done.map(toMarkup).join("\n")),
    doneCount: done.length,
  };
}
