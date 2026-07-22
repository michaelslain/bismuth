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
import { createSignal, createMemo, For, Show, untrack, onMount, onCleanup, type JSX } from "solid-js";
import type { Row, BaseConfig } from "../../../core/src/bases/types";
import { resolveProperty } from "../../../core/src/bases/query";
import { propertyType } from "../../../core/src/bases/properties";
import { Modal } from "../ui/Modal";
import { Chip } from "../ui/Chip";
import { IconButton } from "../ui/IconButton";
import { TextButton } from "../ui/TextButton";
import { MilkdownField } from "../ui/MilkdownField";
import { PropertyValueEditor } from "./PropertyValueEditor";
import { propertyEditKind, type PropertyEditKind } from "./propertyEdit";
import { propertyRegistry } from "../propertyRegistry";
import { columnLabel } from "./columnLabel";
import { writableKey } from "./kanbanMeta";
import { appendEmbedToValue, isImagePath } from "./kanbanImageDrop";
import {
  isFileDrag,
  nativeDropPoint,
  uploadImageEmbeds,
  uploadsFromFiles,
  uploadsFromNativePaths,
  type ImageUpload,
} from "./cardImageDrop";
import { pointInDropRect, type NativeDragDetail } from "../nativeDrop";
import { claimNativeDrop } from "../nativeDropRouting";
import type { DocEditorHandle } from "../blocks/milkdownEditor";
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
  /** Delete this card's note — the SOLE delete affordance for a kanban card (no separate
   *  right-click context-menu path; see KanbanView/KanbanCard). */
  onDelete: () => void;
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

  // ── Image drop onto the description ─────────────────────────────────────────────────────────
  // Drag an image file onto a markdown property (the `description`) and the picture is appended to
  // the text as an ordinary `![[basename]]` embed over a real vault attachment — then renders as
  // the actual image in this very field (inlineNodes.ts draws image embeds as <img>) AND on the
  // card face (renderMarkdown does the same). It commits through the SAME mdDrafts/commitMarkdown
  // path typing already uses, so a dropped image and a typed edit can never disagree.
  //
  // Two intake paths, because an OS file drop is not an in-app pointer drag and we can't choose how
  // the platform delivers it: the packaged WKWebView routes it through Tauri's native handler
  // (`bismuth-native-drag`, real on-disk paths — the path that works in the real app), while a
  // plain browser fires HTML5 `drop` with `dataTransfer.files`. Both live in cardImageDrop.ts,
  // shared with the board's card-face drop.

  // The live Milkdown handle + drop zone per markdown field id (the surface mounts async).
  const fields = new Map<string, { handle: DocEditorHandle | null; zone: HTMLElement }>();
  const [dropField, setDropField] = createSignal<string | null>(null);

  function registerField(id: string, handle: DocEditorHandle | null, zone: HTMLElement): void {
    fields.set(id, { handle, zone });
  }

  /** Append each uploaded image's embed to the field's markdown, refresh the live surface so the
   *  picture appears at once, and COMMIT immediately — a drop is a deliberate act, so it shouldn't
   *  wait for a blur to reach disk.
   *
   *  The new value comes from the same pure `appendEmbedToValue` the board's card-face drop uses,
   *  so an image dropped here and one dropped on the card produce byte-identical markdown (an
   *  earlier cut inserted at the drop point via ProseMirror and glued the embed onto the end of
   *  the preceding sentence — `description: text.![[img.png]]`). Reading the CURRENT markdown off
   *  the live surface (not the row) keeps un-blurred typing in the same commit; a surface that
   *  hasn't mounted yet (the Milkdown chunk is code-split) falls back to the draft/row value, so a
   *  fast drop is never lost. */
  async function insertImages(id: string, uploads: ImageUpload[]): Promise<void> {
    if (uploads.length === 0) return;
    const embeds = await uploadImageEmbeds(uploads, props.row.file.path);
    if (embeds.length === 0) return;
    const handle = fields.get(id)?.handle;
    const current = handle ? handle.getMarkdown() : (mdDrafts[id] ?? String(untrack(() => value(id)) ?? ""));
    const next = appendEmbedToValue(current, embeds.join("\n"));
    mdDrafts[id] = next;
    handle?.setMarkdown(next); // programmatic set → no onChange, hence the explicit draft write above
    commitMarkdown(id);
  }

  function onFieldDragOver(e: DragEvent, id: string): void {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault(); // required for the drop to fire
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    setDropField(id);
  }
  function onFieldDragLeave(e: DragEvent, id: string): void {
    // dragleave also fires moving between the zone's own children — ignore those.
    const zone = e.currentTarget as HTMLElement;
    const to = e.relatedTarget as Node | null;
    if (to && zone.contains(to)) return;
    if (dropField() === id) setDropField(null);
  }
  async function onFieldDrop(e: DragEvent, id: string): Promise<void> {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropField(null);
    await insertImages(id, await uploadsFromFiles(e.dataTransfer!.files));
  }

  /** The markdown field whose drop zone contains (x, y) in page CSS px, or null. */
  function fieldAt(x: number, y: number): string | null {
    return [...fields.entries()].find(([, f]) => pointInDropRect(f.zone.getBoundingClientRect(), x, y))?.[0] ?? null;
  }

  // Native (Tauri) OS drop: a WINDOW event EVERY surface sees, so hit-test our OWN field rects and
  // only claim it when the cursor is inside one. The modal sits ABOVE the board, so a drop on an
  // open modal's description resolves here while the board's card-face handler finds no card under
  // the (modal-covered) point; `claimNativeDrop` backstops any overlap.
  onMount(() => {
    const onNativeDrag = (ev: Event): void => {
      const d = (ev as CustomEvent<NativeDragDetail>).detail;
      if (!d) return;
      if (d.type === "leave") { setDropField(null); return; }
      if (d.type !== "drop") {
        // enter/over — raw coords, deliberately NOT zoom-corrected: the correction costs an async
        // Tauri IPC round-trip and `over` fires continuously through a drag. It only shifts the
        // point by a zoom residual, which can't cross a whole field, so the highlight is right and
        // the DROP (below) still gets the exact correction. Mirrors KanbanView's card highlight.
        setDropField(fieldAt(d.x, d.y));
        return;
      }
      void (async () => {
        setDropField(null);
        if (!d.paths.some(isImagePath)) return;
        const pt = await nativeDropPoint(d);
        const id = fieldAt(pt.x, pt.y);
        if (!id) return; // not dropped on a description — let another surface handle it
        if (!claimNativeDrop(d)) return; // another surface already owns this drop
        await insertImages(id, await uploadsFromNativePaths(d.paths));
      })();
    };
    window.addEventListener("bismuth-native-drag", onNativeDrag);
    onCleanup(() => window.removeEventListener("bismuth-native-drag", onNativeDrag));
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
      // Wrap the rich surface in its own drop zone: dragging an image onto the description drops
      // the picture INTO the text (see the "Image drop onto the description" section).
      let zone!: HTMLDivElement;
      return (
        <div
          ref={zone}
          class={styles.mdDropZone}
          classList={{ [styles.mdDropActive]: dropField() === id }}
          onDragEnter={(e) => onFieldDragOver(e, id)}
          onDragOver={(e) => onFieldDragOver(e, id)}
          onDragLeave={(e) => onFieldDragLeave(e, id)}
          onDrop={(e) => void onFieldDrop(e, id)}
        >
          <MilkdownField
            class={styles.mdField}
            value={initial}
            autofocus={props.focusTarget === id}
            onReady={(h) => { registerField(id, h, zone); }}
            onChange={(md) => { mdDrafts[id] = md; }}
            onBlur={() => commitMarkdown(id)}
          />
        </div>
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
        <IconButton icon="X" label="Close" onClick={close} />
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
        <TextButton danger onClick={props.onDelete}>DELETE</TextButton>
        <div class={styles.footerSpacer} />
        <TextButton variant="selected" onClick={close}>DONE</TextButton>
      </div>
    </Modal>
  );
}
