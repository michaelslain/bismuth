import { createSignal, createMemo, Show, onMount } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { api } from "../api";
import { renderValue } from "./renderValue";
import { renderNoteBody } from "./markdown";
import styles from "./BaseView.module.css";

// Strip a leading YAML frontmatter block so the card shows just the note body —
// same as `.md` transclusion (embedBlock).
function stripFrontmatter(text: string): string {
  return text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

// A checklist line whose box is anything other than empty (`[x]`, `[-]`, `[/]`, …)
// is treated as completed and tucked into the collapsible section at the bottom,
// Google-Keep style. `[ ]` (and every non-task line) stays in the open section.
const DONE_TASK_RE = /^\s*- \[[^ \]]\]/;
const HEADING_RE = /^#{1,6}\s/;
// Lines that GFM renders as an actual checkbox, in document order — used to map a
// clicked checkbox back to its source line for the toggle.
const OPEN_BOX_RE = /^\s*- \[ \]/;
// Mirror DONE_TASK_RE: any non-empty box (`[x]`, `[-]`, `[/]`, `[>]`, …) is a done
// task. Keeping these in sync is what lets doneLines index the same lines BodyCard
// renders in the completed section, so a click toggles the right source line.
const DONE_BOX_RE = /^\s*- \[[^ \]]\]/;
// Any checklist line (open OR done) — used by tasks-only mode to keep just the todo list.
const TASK_LINE_RE = /^\s*- \[.\]/;

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

// marked renders task checkboxes `disabled`; un-disable them so they're clickable.
function enableCheckboxes(html: string): string {
  return html.replace(/\sdisabled(="")?/g, "");
}

/**
 * A Google-Keep-style preview card: the note's body rendered as real markdown
 * (`renderNoteBody` — standard renderer + Obsidian `[[wikilinks]]`), with completed
 * tasks hidden behind a "N completed" expander. Checkboxes toggle the underlying
 * task (`api.toggleTask`); links open the note. Cards take their natural height; the
 * grid (`.bodyGrid`) lays them out as a masonry so a short note stays short.
 */
export function BodyCard(props: { row: Row; result: ViewResult; config: BaseConfig; mode?: "body" | "tasks" }) {
  const [content, setContent] = createSignal<string>("");
  const [loaded, setLoaded] = createSignal(false);
  const [showDone, setShowDone] = createSignal(false);

  onMount(async () => {
    try {
      setContent(await api.read(props.row.file.path));
    } catch {
      setContent("");
    } finally {
      setLoaded(true);
    }
  });

  const firstCol = () => props.result.columns[0] ?? "file.name";

  // Partition the body into open lines (rendered up top) and completed task lines
  // (inside the expander), plus the absolute file-line index of every rendered
  // checkbox so a click maps back to the source line.
  const parts = createMemo(() => {
    const raw = content();
    const all = stripFrontmatter(raw).split("\n");
    // tasks-only mode: keep just the checklist lines, as if the file contained only its
    // todo list. The SAME renderer + collapse-completed behavior below then applies — no
    // separate task component, no signifier reformatting.
    const body = props.mode === "tasks" ? all.filter((l) => TASK_LINE_RE.test(l)) : all;
    const open: string[] = [];
    const done: string[] = [];
    for (const line of body) (DONE_TASK_RE.test(line) ? done : open).push(line);

    const openLines: number[] = [];
    const doneLines: number[] = [];
    raw.split("\n").forEach((l, i) => {
      if (OPEN_BOX_RE.test(l)) openLines.push(i);
      else if (DONE_BOX_RE.test(l)) doneLines.push(i);
    });

    return {
      openHtml: enableCheckboxes(renderNoteBody(pruneEmptyHeadings(open).join("\n"))),
      doneHtml: enableCheckboxes(renderNoteBody(done.join("\n"))),
      doneCount: done.length,
      openLines,
      doneLines,
    };
  });

  // One delegated handler per section: checkbox click -> toggle the mapped source
  // line; link click -> open the note (the standard `oa-open` nav) or external URL.
  async function onCardClick(e: MouseEvent, lineIdx: number[]) {
    const container = e.currentTarget as HTMLElement;
    const target = e.target as HTMLElement;
    const box = target.closest('input[type="checkbox"]') as HTMLInputElement | null;
    if (box) {
      e.preventDefault();
      const k = [...container.querySelectorAll('input[type="checkbox"]')].indexOf(box);
      const idx = lineIdx[k];
      if (idx == null) return;
      try {
        await api.toggleTask(props.row.file.path, idx);
        setContent(await api.read(props.row.file.path));
      } catch { /* best-effort: leave the card as-is on failure */ }
      return;
    }
    const a = target.closest("a") as HTMLAnchorElement | null;
    if (!a) return;
    const wl = a.getAttribute("data-href");
    if (wl) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("oa-open", { detail: wl }));
      return;
    }
    const href = a.getAttribute("href");
    if (!href || href === "#") return;
    e.preventDefault();
    if (/^https?:\/\//.test(href)) window.open(href, "_blank", "noopener");
    else window.dispatchEvent(new CustomEvent("oa-open", { detail: href.endsWith(".md") ? href : `${href}.md` }));
  }

  return (
    <div class={styles.bodyCard}>
      <div class={styles.cardTitle}>{renderValue(firstCol(), props.row)}</div>
      <Show when={loaded()} fallback={<div class={styles.cardKey}>Loading…</div>}>
        <div class={styles.cardMd} onClick={(e) => void onCardClick(e, parts().openLines)} innerHTML={parts().openHtml} />
        <Show when={parts().doneCount > 0}>
          <button class={styles.doneToggle} onClick={() => setShowDone(!showDone())}>
            {showDone() ? "▾" : "▸"} {parts().doneCount} completed
          </button>
          <Show when={showDone()}>
            <div class={`${styles.cardMd} ${styles.cardMdDone}`} onClick={(e) => void onCardClick(e, parts().doneLines)} innerHTML={parts().doneHtml} />
          </Show>
        </Show>
      </Show>
    </div>
  );
}
