import { createSignal, createEffect, untrack, For, Show, type JSX } from "solid-js";
import type { Row, BaseConfig } from "../../../core/src/bases/types";
import { resolveProperty } from "../../../core/src/bases/query";
import { propertyType, coercePropertyValue } from "../../../core/src/bases/properties";
import { renderMarkdown } from "./markdown";
import { renderCell, isTagColumn } from "./renderValue";
import { formatNumberDisplay } from "./numberFormat";
import { columnLabel } from "./columnLabel";
import { metaVisible, writableKey } from "./kanbanMeta";
import { propertyEditKind, multiselectValues } from "./propertyEdit";
import { propertyRegistry } from "../propertyRegistry";
import { PropertyValueEditor } from "./PropertyValueEditor";
import { Chip } from "../ui/Chip";
import styles from "./BaseView.module.css";

/** Plain-string title for a card (the display/first column value, falling back to the filename). */
function titleOf(row: Row, titleCol: string): string {
  const v = resolveProperty(titleCol, row);
  return v == null || typeof v === "object" ? row.file.name : String(v);
}

/** Current description text from the card's frontmatter (empty string when unset/opted-out). */
function descOf(row: Row, descField: string | null): string {
  if (descField === null) return "";
  const v = (row.note as Record<string, unknown>)[descField];
  return v == null || typeof v === "object" ? "" : String(v);
}

/**
 * The editable face of a kanban card: a click-to-edit title (renames the note) and, ONLY when
 * the view's config lists a description property (`descField` non-null), a click-to-edit
 * multiline description (a frontmatter property, rendered as markdown and revealed as a raw
 * textarea on click). Editing either field flips the card out of draggable mode via
 * `onEditingChange` so text selection/caret placement work normally; blur (or Enter on the
 * title, Escape on either) commits and restores dragging.
 *
 * The description is NOT built-in — a board that never mentions one renders no slot and no
 * "Add a description…" affordance. When configured, it lives in frontmatter so it rides along
 * in the already-resolved Row — no per-card body fetch, keeping large boards cheap.
 *
 * Below the description, the view's remaining `order:` properties (`metaCols`) render as
 * EDITABLE chips — click one to swap in a type-aware control (text/number/date/select/tags;
 * a boolean toggles instantly via a `Chip`, no popover) that persists to the note's
 * frontmatter via `onSetMeta`. Only one editor (title/description/a single meta chip) is
 * ever open at a time, so the card's draggability and the editors never fight each other.
 */
export function KanbanCard(props: {
  row: Row;
  titleCol: string;
  descField: string | null;
  metaCols: string[];
  config: BaseConfig;
  editable: boolean;
  onEditingChange: (editing: boolean) => void;
  onRename: (newTitle: string) => void;
  onSetDescription: (value: string) => void;
  onSetMeta: (id: string, value: unknown) => void;
  /** Every OTHER row's raw value for a property id, across the whole board — feeds the
   *  meta chip editor's "select from known values" fallback. */
  siblingValues: (id: string) => unknown[];
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

  // Which meta property (if any) currently shows its editor, and an optimistic echo of
  // just-committed meta values so the chip shows the new value instantly rather than
  // waiting for the write's refetch. Same idiom as `title`/`desc` above, generalized to a
  // map since any of several meta properties may be edited (one at a time).
  const [metaEdit, setMetaEdit] = createSignal<string | null>(null);
  const [overrides, setOverrides] = createSignal<Record<string, unknown>>({});
  createEffect(() => {
    const row = props.row; // track: re-run when a fresh row lands (refetch)
    untrack(() => {
      const cur = overrides();
      const ids = Object.keys(cur);
      if (ids.length === 0) return;
      let changed = false;
      const next = { ...cur };
      for (const id of ids) {
        const bare = id.startsWith("note.") ? id.slice(5) : id;
        const live = (row.note as Record<string, unknown>)[bare] ?? null;
        if (JSON.stringify(live) === JSON.stringify(cur[id] ?? null)) {
          delete next[id];
          changed = true;
        }
      }
      if (changed) setOverrides(next);
    });
  });
  // The row as it should currently DISPLAY: `props.row` with any not-yet-confirmed meta
  // overrides applied. `resolveProperty`'s bare/`note.`-namespaced lookups both read
  // `row.note`, so patching that object covers every id shape a meta column can use.
  const displayRow = (): Row => {
    const ov = overrides();
    const ids = Object.keys(ov);
    if (ids.length === 0) return props.row;
    const note = { ...props.row.note } as Record<string, unknown>;
    for (const id of ids) {
      const bare = id.startsWith("note.") ? id.slice(5) : id;
      note[bare] = ov[id];
    }
    return { ...props.row, note };
  };

  // Meta columns that actually have a value on THIS row — empties render nothing at all,
  // EXCEPT a declared/runtime-boolean property, which always shows (even `false`): its chip
  // is the only UI that can ever toggle it, see `metaVisible`.
  const visibleMeta = () => props.metaCols.filter((id) => metaVisible(id, resolveProperty(id, displayRow()), propertyRegistry()));

  const enter = (m: "title" | "desc") => {
    if (!props.editable) return;
    setMetaEdit(null);
    setMode(m);
    props.onEditingChange(true);
  };
  const leave = () => {
    setMode("none");
    props.onEditingChange(false);
  };

  function enterMeta(id: string): void {
    if (!props.editable || writableKey(id) === null) return;
    setMode("none");
    setMetaEdit(id);
    props.onEditingChange(true);
  }
  // `opts.keepOpen` (the multiselect editor's add/remove writes — #101) leaves the editor
  // mounted so a second/third change can follow the first, instead of the usual
  // commit-once-and-close every other kind uses.
  function commitMeta(id: string, value: unknown, opts?: { keepOpen?: boolean }): void {
    if (writableKey(id) === null) return;
    const bare = id.startsWith("note.") ? id.slice(5) : id;
    const current = (props.row.note as Record<string, unknown>)[bare] ?? null;
    // When the base declares this property's type, coerce the committed value through it
    // (e.g. a number field's unparseable-input string fallback still ends up a real
    // number here when it happens to parse; a genuinely unparseable value is left as-is —
    // resilient over strict) — #100.
    const t = propertyType(props.config, id);
    const next = (t ? coercePropertyValue(t, value) : value) ?? null;
    if (!opts?.keepOpen) {
      setMetaEdit(null);
      props.onEditingChange(false);
    }
    if (JSON.stringify(next) === JSON.stringify(current)) return; // unchanged — no write
    setOverrides((prev) => ({ ...prev, [id]: next }));
    props.onSetMeta(id, next);
  }
  function cancelMeta(): void {
    setMetaEdit(null);
    props.onEditingChange(false);
  }

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

      {/* Description slot — only when the view's config lists a description property. */}
      <Show when={props.descField !== null}>
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
      </Show>

      <Show when={visibleMeta().length > 0}>
        {/* Suppress native anchor drag on meta links — it would hijack the card's pointer-drag
            (a native link-drag fires pointercancel, tearing the card drag down mid-gesture). */}
        <div class={styles.kbMeta} onDragStart={(e) => e.preventDefault()}>
          <For each={visibleMeta()}>
            {(id) => {
              const value = () => resolveProperty(id, displayRow());
              const declType = () => propertyType(props.config, id);
              const kind = () => propertyEditKind(id, value(), propertyRegistry(), props.siblingValues(id), declType());
              const writable = () => props.editable && writableKey(id) !== null;
              // Type-aware display (#100): a declared `markdown` property renders as block
              // markdown (like the description slot); a declared `number` property renders
              // through its format (plain/unit/currency/percent). Everything else keeps the
              // existing heuristic renderCell (status dots, tags, ratings, links, …).
              const display = (): JSX.Element => {
                const k = kind();
                if (k.kind === "markdown") {
                  const v = value();
                  return <div class={styles.kbMetaMarkdown} innerHTML={renderMarkdown(v == null ? "" : String(v))} />;
                }
                if (k.kind === "number") {
                  const v = value();
                  if (typeof v === "number") return <span>{formatNumberDisplay(v, k.format, k.unit)}</span>;
                }
                if (k.kind === "multiselect") {
                  const vals = multiselectValues(value());
                  if (vals.length === 0) return <span class="bismuth-empty">—</span>;
                  return (
                    <span class={styles.kbMetaMultiselectDisplay}>
                      <For each={vals}>{(t) => <Chip selected>{t}</Chip>}</For>
                    </span>
                  );
                }
                return renderCell(id, displayRow());
              };
              return (
                <div class={styles.kbMetaItem}>
                  {/* #tags are self-describing — skip the label for tag columns. */}
                  <Show when={!isTagColumn(id)}>
                    <span class={styles.kbMetaLabel}>{columnLabel(id, props.config)}</span>
                  </Show>
                  <Show
                    when={metaEdit() === id}
                    fallback={
                      <Show
                        when={writable() && kind().kind === "boolean"}
                        fallback={
                          <span
                            class={styles.kbMetaValueWrap}
                            classList={{ [styles.kbMetaClickable]: writable() }}
                            onPointerDown={writable() ? onDown : undefined}
                            onPointerUp={writable() ? (e) => { if (tapped(e)) enterMeta(id); } : undefined}
                            title={writable() ? "Click to edit" : undefined}
                          >
                            {display()}
                          </span>
                        }
                      >
                        {/* A boolean property toggles instantly on click — no popover for a
                            single yes/no value (the meta-editing double-Show above skips
                            `enterMeta` for these, so this is the only entry point). */}
                        <span class={styles.kbMetaBoolChip}>
                          <Chip
                            selected={value() === true}
                            icon={value() === true ? "Check" : "Square"}
                            iconSize={12}
                            onClick={() => commitMeta(id, !(value() === true))}
                          >
                            {value() === true ? "Yes" : "No"}
                          </Chip>
                        </span>
                      </Show>
                    }
                  >
                    <PropertyValueEditor
                      kind={kind()}
                      value={value()}
                      onCommit={(v, opts) => commitMeta(id, v, opts)}
                      onCancel={cancelMeta}
                    />
                  </Show>
                </div>
              );
            }}
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
