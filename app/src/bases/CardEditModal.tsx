// app/src/bases/CardEditModal.tsx
// The focused edit modal for a kanban card (opened by KanbanCard on a tap). It lists the card's
// TITLE plus EVERY declared property (empty or not) — unlike the card face, which only shows
// properties that already have a value — so a NEW card's empty `description`/`worktree`/etc. are
// finally editable (the report this fixes). Each property gets a type-aware control:
//   • markdown  → a TRUE-WYSIWYG Milkdown surface (the SAME rich editor notes use, via
//                 MilkdownField) — NOT a plain textarea;
//   • boolean   → an instant Yes/No Chip toggle;
//   • else      → the shared PropertyValueEditor (text/number/date/select/multiselect).
// Commits route back through the SAME `onRename`/`onSetMeta` (KanbanCard's optimistic
// commitTitle/commitMeta) the inline editors used, so nothing about persistence changes — only
// where you edit.
import { createSignal, createMemo, For, Show, untrack, type JSX } from "solid-js";
import type { Row, BaseConfig } from "../../../core/src/bases/types";
import { resolveProperty } from "../../../core/src/bases/query";
import { propertyType } from "../../../core/src/bases/properties";
import { Modal } from "../ui/Modal";
import { Chip } from "../ui/Chip";
import { Icon } from "../icons/Icon";
import { MilkdownField } from "../ui/MilkdownField";
import { PropertyValueEditor } from "./PropertyValueEditor";
import { propertyEditKind, type PropertyEditKind } from "./propertyEdit";
import { propertyRegistry } from "../propertyRegistry";
import { columnLabel } from "./columnLabel";
import { writableKey } from "./kanbanMeta";
import styles from "./CardEditModal.module.css";

/** Plain-string title for a card (the display/first column value, falling back to the filename). */
function titleOf(row: Row, titleCol: string): string {
  const v = resolveProperty(titleCol, row);
  return v == null || typeof v === "object" ? row.file.name : String(v);
}

export function CardEditModal(props: {
  /** The card's row — reactive (displayRow), so committed values reflect optimistically. */
  row: Row;
  /** The title column id (kanban binds this to file.name). */
  titleCol: string;
  /** EVERY declared/`order:` property id (empty or not) — the modal renders all of them. */
  metaCols: string[];
  config: BaseConfig;
  /** Which control to focus on open: the title (titleCol / undefined) or a specific property id. */
  focusTarget?: string;
  /** Every OTHER row's raw value for a property id, across the board — feeds the select fallback. */
  siblingValues: (id: string) => unknown[];
  onRename: (newTitle: string) => void;
  onSetMeta: (id: string, value: unknown, opts?: { keepOpen?: boolean }) => void;
  onClose: () => void;
}) {
  let titleRef: HTMLInputElement | undefined;
  const fieldRefs = new Map<string, HTMLElement>();

  const [titleDraft, setTitleDraft] = createSignal(untrack(() => titleOf(props.row, props.titleCol)));
  // Latest markdown per markdown-property id — set on every edit, committed on blur / close. Only
  // ids the user actually touched appear here, so an untouched field is never written.
  const mdDrafts: Record<string, string> = {};

  const value = (id: string): unknown => resolveProperty(id, props.row);
  const declType = (id: string) => propertyType(props.config, id);
  const kindOf = (id: string): PropertyEditKind =>
    propertyEditKind(id, value(id), propertyRegistry(), props.siblingValues(id), declType(id));
  const writable = (id: string): boolean => writableKey(id) !== null;

  const commitTitle = (): void => {
    const next = titleDraft().trim();
    if (next && next !== titleOf(props.row, props.titleCol)) props.onRename(next);
  };
  const commitMarkdown = (id: string): void => {
    if (id in mdDrafts) props.onSetMeta(id, mdDrafts[id]);
  };
  /** Flush any drafts that commit lazily (title + markdown fields) before the modal tears down.
   *  The type-aware PropertyValueEditor controls commit on their own blur, so they need no flush. */
  const close = (): void => {
    commitTitle();
    for (const id of Object.keys(mdDrafts)) commitMarkdown(id);
    props.onClose();
  };

  // The declared columns to render, minus the title (which has its own dedicated field above).
  const cols = createMemo(() => props.metaCols.filter((id) => id !== props.titleCol));

  // Focus the requested control once mounted (a microtask so freshly-rendered rows are in the DOM).
  // Markdown fields self-focus via MilkdownField's `autofocus` (their surface mounts async); every
  // other control (and the title) is focused here.
  queueMicrotask(() => {
    const t = props.focusTarget;
    if (!t || t === props.titleCol) {
      titleRef?.focus();
      titleRef?.select();
      return;
    }
    const rowEl = fieldRefs.get(t);
    if (!rowEl) return;
    rowEl.scrollIntoView({ block: "nearest" });
    rowEl.querySelector<HTMLElement>("input, textarea, .ui-select-trigger, button")?.focus();
  });

  // Build a field's control ONCE. The control TYPE (kind) is fixed for a modal session, so we read
  // it untracked — otherwise `{renderControl(id)}` would become a memo that re-runs (and remounts
  // the editor, losing the Milkdown surface / caret) every time an optimistic commit changes the
  // row. Reactive VALUE reads stay inside the returned controls (prop getters that update in place).
  function renderControl(id: string): JSX.Element {
    if (!writable(id)) {
      const v = untrack(() => value(id));
      return <span class={styles.readonly}>{v == null || v === "" ? "—" : String(v)}</span>;
    }
    const k = untrack(() => kindOf(id));
    if (k.kind === "markdown") {
      const initial = untrack(() => String(value(id) ?? ""));
      return (
        <MilkdownField
          class={styles.mdField}
          value={initial}
          autofocus={props.focusTarget === id}
          onChange={(md) => { mdDrafts[id] = md; }}
          onBlur={() => commitMarkdown(id)}
        />
      );
    }
    if (k.kind === "boolean") {
      return (
        <span class={styles.boolChip}>
          <Chip
            selected={value(id) === true}
            icon={value(id) === true ? "Check" : "Square"}
            iconSize={13}
            onClick={() => props.onSetMeta(id, !(value(id) === true))}
          >
            {value(id) === true ? "Yes" : "No"}
          </Chip>
        </span>
      );
    }
    return (
      <PropertyValueEditor
        kind={k}
        value={value(id)}
        autofocus={false}
        onCommit={(v, opts) => props.onSetMeta(id, v, opts)}
        onCancel={() => {}}
      />
    );
  }

  return (
    <Modal onClose={close} class={styles.panel}>
      <div class={styles.header}>
        <div class={styles.headTitle}>Edit card</div>
        <button type="button" class={styles.close} aria-label="Close" onClick={close}>
          <Icon value="X" size={16} />
        </button>
      </div>

      <div class={styles.body}>
        <label class={styles.titleField}>
          <span class={styles.label}>Title</span>
          <input
            ref={titleRef}
            class={styles.titleInput}
            value={titleDraft()}
            placeholder="Untitled"
            onInput={(e) => setTitleDraft(e.currentTarget.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
              else if (e.key === "Escape") { setTitleDraft(titleOf(props.row, props.titleCol)); e.currentTarget.blur(); }
            }}
          />
        </label>

        <For each={cols()}>
          {(id) => (
            <div class={styles.field} ref={(el) => fieldRefs.set(id, el)}>
              <span class={styles.label}>{columnLabel(id, props.config)}</span>
              {renderControl(id)}
            </div>
          )}
        </For>

        <Show when={cols().length === 0}>
          <div class={styles.empty}>This board declares no editable properties.</div>
        </Show>
      </div>

      <div class={styles.footer}>
        <button type="button" class={styles.doneBtn} onClick={close}>Done</button>
      </div>
    </Modal>
  );
}
