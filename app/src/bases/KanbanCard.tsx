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
import { CardEditModal } from "./CardEditModal";
import { Chip } from "../ui/Chip";
import styles from "./BaseView.module.css";

/** Plain-string title for a card (the display/first column value, falling back to the filename). */
function titleOf(row: Row, titleCol: string): string {
  const v = resolveProperty(titleCol, row);
  return v == null || typeof v === "object" ? row.file.name : String(v);
}

/**
 * The face of a kanban card: a read-only title + the view's remaining `order:` properties
 * (`metaCols`) rendered as read-only chips (only the ones that ALREADY have a value — empties
 * are dropped from the compact card face, EXCEPT booleans, which always show). A tap anywhere on
 * the card opens a focused edit MODAL (CardEditModal): tapping the title focuses the title field,
 * tapping a specific property focuses THAT property's editor, tapping the body focuses the first
 * field. The modal lists EVERY declared property (empty or not) with a type-aware editor — the
 * `markdown`/`description` property using the SAME rich Milkdown surface notes use — so a NEW
 * card's empty `description` is finally editable there (the report this fixes).
 *
 * A tap opens the modal; a drag (pointer move past a few px) is left to the card's pointer-drag
 * (KanbanView.startCardDrag), so dragging a card between columns still works.
 */
export function KanbanCard(props: {
  row: Row;
  titleCol: string;
  metaCols: string[];
  config: BaseConfig;
  editable: boolean;
  /** #105: the kanban view's `hideLabels` toggle — when true, meta rows show only the
   *  value, no label caption above it. Tag rows already skip the label regardless. */
  hideLabels?: boolean;
  onEditingChange: (editing: boolean) => void;
  onRename: (newTitle: string) => void;
  onSetMeta: (id: string, value: unknown) => void;
  /** Every OTHER row's raw value for a property id, across the whole board — feeds the
   *  modal editor's "select from known values" fallback. */
  siblingValues: (id: string) => unknown[];
}) {
  // Local mirror so a commit paints instantly without waiting for a refetch. Re-seed from the row
  // when the ROW's own values change (a refetch landed), NOT while the modal is open — read
  // untracked so an optimistic commit doesn't get clobbered back to stale `props.row` before the
  // server round-trips.
  const [title, setTitle] = createSignal(titleOf(props.row, props.titleCol));
  const [edit, setEdit] = createSignal<{ target?: string } | null>(null);
  createEffect(() => {
    const t = titleOf(props.row, props.titleCol);
    if (untrack(edit) === null) setTitle(t);
  });

  // Optimistic echo of just-committed meta values so the card face shows the new value instantly
  // rather than waiting for the write's refetch. Same idiom as `title` above, generalized to a map
  // since any of several meta properties may be edited (via the modal).
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

  // Meta columns that actually have a value on THIS row — empties render nothing at all on the
  // compact card face (the MODAL lists every declared property, empty or not), EXCEPT a
  // declared/runtime-boolean property, which always shows (see `metaVisible`).
  const visibleMeta = () => props.metaCols.filter((id) => metaVisible(id, resolveProperty(id, displayRow()), propertyRegistry()));

  // ── Edit modal ────────────────────────────────────────────────────────────────────────
  function openEdit(target?: string): void {
    if (!props.editable) return;
    setEdit({ target });
    props.onEditingChange(true);
  }
  function closeEdit(): void {
    setEdit(null);
    props.onEditingChange(false);
  }
  /** Rename from the modal's title field — optimistic mirror + persist (KanbanView.renameCard). */
  function commitRename(next: string): void {
    const t = next.trim();
    if (t && t !== titleOf(props.row, props.titleCol)) {
      setTitle(t);
      props.onRename(t);
    }
  }
  /** Persist a meta value the modal's type-aware editor produced, with an optimistic echo. `null`
   *  clears the key. When the base declares the property's type, coerce through it first (#100).
   *  `opts` (multiselect's add/remove keepOpen) is irrelevant now the editor lives in a modal —
   *  kept in the signature so the modal can pass PropertyValueEditor's onCommit through unchanged. */
  function commitMeta(id: string, value: unknown, _opts?: { keepOpen?: boolean }): void {
    if (writableKey(id) === null) return;
    const bare = id.startsWith("note.") ? id.slice(5) : id;
    const current = (props.row.note as Record<string, unknown>)[bare] ?? null;
    const t = propertyType(props.config, id);
    const next = (t ? coercePropertyValue(t, value) : value) ?? null;
    if (JSON.stringify(next) === JSON.stringify(current)) return; // unchanged — no write
    setOverrides((prev) => ({ ...prev, [id]: next }));
    props.onSetMeta(id, next);
  }

  // ── Tap-to-edit (not drag) ──────────────────────────────────────────────────────────────
  // The card is `draggable` (KanbanView's pointer-drag), and a small pointer move is a drag, not a
  // tap. Detect the tap ourselves (pointer-up within a few px of pointer-down) and open the modal,
  // targeting whichever element carries `data-edit-target` under the cursor (title / a property id;
  // the bare card body → first field). Anything past the threshold is left to the card's drag.
  let downX = 0;
  let downY = 0;
  const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
  const tapped = (e: PointerEvent) => Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) < 6;
  const onUp = (e: PointerEvent) => {
    if (!props.editable || !tapped(e)) return;
    const el = (e.target as HTMLElement | null)?.closest?.("[data-edit-target]") as HTMLElement | null;
    openEdit(el?.dataset.editTarget);
  };

  return (
    <div
      class={styles.kbCardFace}
      classList={{ [styles.kbFaceEditable]: props.editable }}
      onPointerDown={onDown}
      onPointerUp={onUp}
    >
      <div
        class={styles.kbCardTitle}
        classList={{ [styles.kbEditable]: props.editable }}
        data-edit-target={props.titleCol}
        title={props.editable ? "Click to edit card" : undefined}
      >
        {title()}
      </div>

      <Show when={visibleMeta().length > 0}>
        {/* Suppress native anchor drag on meta links — it would hijack the card's pointer-drag
            (a native link-drag fires pointercancel, tearing the card drag down mid-gesture). */}
        <div class={styles.kbMeta} onDragStart={(e) => e.preventDefault()}>
          <For each={visibleMeta()}>
            {(id) => {
              const value = () => resolveProperty(id, displayRow());
              const declType = () => propertyType(props.config, id);
              const kind = () => propertyEditKind(id, value(), propertyRegistry(), props.siblingValues(id), declType());
              // Type-aware read-only display (#100): a declared `markdown` property renders as
              // block markdown; a declared `number` through its format; a `multiselect`/`boolean`
              // as chips. Everything else keeps the heuristic renderCell (status dots, tags, …).
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
                if (k.kind === "boolean") {
                  const on = value() === true;
                  return (
                    <span class={styles.kbMetaBoolChip}>
                      <Chip selected={on} icon={on ? "Check" : "Square"} iconSize={12}>{on ? "Yes" : "No"}</Chip>
                    </span>
                  );
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
                <div class={styles.kbMetaItem} data-edit-target={id}>
                  {/* #tags are self-describing — skip the label for tag columns. The view's
                      `hideLabels` toggle (#105) suppresses every OTHER label too. */}
                  <Show when={!isTagColumn(id) && !props.hideLabels}>
                    <span class={styles.kbMetaLabel}>{columnLabel(id, props.config)}</span>
                  </Show>
                  <span
                    class={styles.kbMetaValueWrap}
                    classList={{ [styles.kbMetaClickable]: props.editable }}
                    title={props.editable ? "Click to edit" : undefined}
                  >
                    {display()}
                  </span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={edit()}>
        {(e) => (
          <CardEditModal
            row={displayRow()}
            titleCol={props.titleCol}
            metaCols={props.metaCols}
            config={props.config}
            focusTarget={e().target}
            siblingValues={props.siblingValues}
            onRename={commitRename}
            onSetMeta={(id, v, opts) => commitMeta(id, v, opts)}
            onClose={closeEdit}
          />
        )}
      </Show>
    </div>
  );
}
