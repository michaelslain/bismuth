import { createSignal, createEffect, untrack, For, Show } from "solid-js";
import type { Row, BaseConfig } from "../../../core/src/bases/types";
import { resolveProperty } from "../../../core/src/bases/query";
import { renderMarkdown } from "./markdown";
import { renderCell, isTagColumn } from "./renderValue";
import { columnLabel } from "./columnLabel";
import { hasValue } from "./kanbanMeta";
import styles from "./BaseView.module.css";

/** Plain-string title for a card (the display/first column value, falling back to the filename). */
function titleOf(row: Row, titleCol: string): string {
  const v = resolveProperty(titleCol, row);
  return v == null || typeof v === "object" ? row.file.name : String(v);
}

/** Current description text from the card's frontmatter (empty string when unset). */
function descOf(row: Row, descField: string): string {
  const v = (row.note as Record<string, unknown>)[descField];
  return v == null || typeof v === "object" ? "" : String(v);
}

/**
 * The editable face of a kanban card: a click-to-edit title (renames the note) over a
 * click-to-edit multiline description (a frontmatter property, rendered as markdown and
 * revealed as a raw textarea on click). Editing either field flips the card out of
 * draggable mode via `onEditingChange` so text selection/caret placement work normally;
 * blur (or Enter on the title, Escape on either) commits and restores dragging.
 *
 * The description lives in frontmatter (default `description`), so it rides along in the
 * already-resolved Row — no per-card body fetch, keeping large boards cheap.
 *
 * Below the description, the view's remaining `order:` properties (`metaCols`) render as a
 * READ-ONLY meta section — plain spans (no inputs/buttons), so the card stays draggable and
 * the meta never competes with the tap-to-edit title/description.
 */
export function KanbanCard(props: {
  row: Row;
  titleCol: string;
  descField: string;
  metaCols: string[];
  config: BaseConfig;
  editable: boolean;
  onEditingChange: (editing: boolean) => void;
  onRename: (newTitle: string) => void;
  onSetDescription: (value: string) => void;
}) {
  const [mode, setMode] = createSignal<"none" | "title" | "desc">("none");
  // Local mirrors so a commit paints instantly without waiting for a refetch. Re-seed from the row
  // when the ROW's own values change (a refetch landed), NOT when `mode` changes — `mode` is read
  // untracked so committing (which flips mode → "none") doesn't re-run this effect and clobber the
  // just-committed optimistic value back to the stale `props.row` until the server round-trips.
  const [title, setTitle] = createSignal(titleOf(props.row, props.titleCol));
  const [desc, setDesc] = createSignal(descOf(props.row, props.descField));
  createEffect(() => {
    const t = titleOf(props.row, props.titleCol);
    const d = descOf(props.row, props.descField);
    if (untrack(mode) === "none") { setTitle(t); setDesc(d); }
  });

  // Meta columns that actually have a value on THIS row — empties render nothing at all.
  const visibleMeta = () => props.metaCols.filter((id) => hasValue(resolveProperty(id, props.row)));

  const enter = (m: "title" | "desc") => {
    if (!props.editable) return;
    setMode(m);
    props.onEditingChange(true);
  };
  const leave = () => {
    setMode("none");
    props.onEditingChange(false);
  };

  const commitTitle = () => {
    const next = title().trim();
    leave();
    if (next && next !== titleOf(props.row, props.titleCol)) props.onRename(next);
    else setTitle(titleOf(props.row, props.titleCol));
  };
  const commitDesc = () => {
    const next = desc();
    leave();
    if (next !== descOf(props.row, props.descField)) props.onSetDescription(next);
  };

  // Tap-to-edit: the card is `draggable`, and a `click` on a draggable element is swallowed by
  // the browser's drag machinery whenever the pointer moves even slightly between down and up. So
  // detect the edit intent ourselves — pointer-up within a few px of pointer-down is a tap (edit);
  // anything more is a drag (leave it to the card's native DnD). Also covers touch on iPad.
  let downX = 0;
  let downY = 0;
  const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
  const tapped = (e: PointerEvent) => Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) < 6;

  return (
    <>
      <Show
        when={mode() === "title"}
        fallback={
          <div
            class={styles.kbCardTitle}
            classList={{ [styles.kbEditable]: props.editable }}
            onPointerDown={onDown}
            onPointerUp={(e) => { if (tapped(e)) enter("title"); }}
            title={props.editable ? "Click to rename" : undefined}
          >
            {title()}
          </div>
        }
      >
        <input
          class={styles.kbTitleInput}
          value={title()}
          autofocus
          ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
          onInput={(e) => setTitle(e.currentTarget.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
            else if (e.key === "Escape") { setTitle(titleOf(props.row, props.titleCol)); e.currentTarget.blur(); }
          }}
        />
      </Show>

      <Show
        when={mode() === "desc"}
        fallback={
          <Show
            when={desc().trim() !== ""}
            fallback={
              <Show when={props.editable}>
                <div class={styles.kbDescEmpty} onPointerDown={onDown} onPointerUp={(e) => { if (tapped(e)) enter("desc"); }}>Add a description…</div>
              </Show>
            }
          >
            <div
              class={styles.kbDesc}
              classList={{ [styles.kbEditable]: props.editable }}
              onPointerDown={onDown}
              onPointerUp={(e) => { if (tapped(e)) enter("desc"); }}
              innerHTML={renderMarkdown(desc())}
            />
          </Show>
        }
      >
        <textarea
          class={styles.kbDescArea}
          value={desc()}
          rows={1}
          placeholder="Description… (Markdown, ⏎ for a new line)"
          ref={(el) => queueMicrotask(() => { el.focus(); autoGrow(el); })}
          onInput={(e) => { setDesc(e.currentTarget.value); autoGrow(e.currentTarget); }}
          onBlur={commitDesc}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setDesc(descOf(props.row, props.descField)); e.currentTarget.blur(); }
          }}
        />
      </Show>

      <Show when={visibleMeta().length > 0}>
        {/* Suppress native anchor drag on meta links — it would hijack the card's pointer-drag
            (a native link-drag fires pointercancel, tearing the card drag down mid-gesture). */}
        <div class={styles.kbMeta} onDragStart={(e) => e.preventDefault()}>
          <For each={visibleMeta()}>
            {(id) => (
              <div class={styles.kbMetaItem}>
                {/* #tags are self-describing — skip the label for tag columns. */}
                <Show when={!isTagColumn(id)}>
                  <span class={styles.kbMetaLabel}>{columnLabel(id, props.config)}</span>
                </Show>
                {renderCell(id, props.row)}
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}

/** Grow a textarea to fit its content (no scrollbar) so the description reads like prose. */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
