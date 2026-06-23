// app/src/BlockEditor.tsx
// A Notion-like BLOCK editing surface — the second editor surface over a note (the first
// being the CodeMirror `Editor`). It shares the EXACT same props contract as `Editor`
// ({ path, initialText, onSaved, noteNames, tagNames }) so FileView can swap one for the other
// based solely on the `editor.defaultMode` setting (no per-note UI toggle).
//
// CRITICAL — anti-clobber contract. A note's source of truth is the RAW markdown string and
// there is NO server-side conflict detection (last-write-wins on PUT /file). So this surface
// MUST replicate Editor.tsx's contract verbatim, or it would silently clobber the whole file:
//   • parse initialText into the lossless block model (blocks/blockModel.ts), never re-derive
//     output from `text` — serialize is frontmatter + every block's verbatim `raw`;
//   • debounced autosave on settings.editor.autoSaveDelay → api.write → primeNoteCache →
//     onSaved (+ optional backupOnSave), tracking lastSavedText to recognise our own echo;
//   • the SSE reconcile (lastChange) re-reads + re-parses ONLY on a real external change to
//     this path (incoming text !== lastSavedText), and is suppressed while a local save is
//     pending (disk is stale, our write is about to land);
//   • flushSave on unmount and a beforeunload keepalive PUT so a debounced edit can't drop;
//   • normalizeFrontmatterSpacing applied on open AND in the save path, byte-identically to
//     Editor.tsx, so the two surfaces don't fight (one normalising what the other wrote).
import { createEffect, createMemo, createRenderEffect, createSignal, For, Show, onCleanup, onMount } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { api, apiBase } from "./api";
import { lastChange } from "./serverVersion";
import { primeNoteCache } from "./noteCache";
import { settings } from "./settings";
import { renderNoteBody } from "./bases/markdown";
import { normalizeFrontmatterSpacing } from "./editor/normalizeFrontmatter";
import {
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
  setBlockText,
  reconcileEditedBlock,
  toggleTaskChecked,
  blockTypeForSlashItem,
  regenerateRaw,
  type Block,
  type BlockType,
} from "./blocks/blockModel";
import {
  SLASH_ITEMS,
  matchSlashPrefix,
  filterSlashItems,
  type SlashItem,
} from "./editor/slashMenu";
import { PopoverList, type PopoverRow } from "./ui/popover/PopoverList";
import { createMenuNav } from "./ui/popover/createMenuNav";
import type { NoteCandidate } from "./editor/wikilink";
import "./BlockEditor.css";

let blockSeq = 0;
/** A fresh, parse-unique id for a block created at runtime (insert/split), distinct from the
 *  `b<n>` ids parseMarkdownToBlocks mints so keyed rendering never collides across a reparse. */
const freshId = (): string => `rt${blockSeq++}`;

/** A new editable block of `type` with empty content, raw regenerated so it round-trips. The
 *  trailing "\n" gives every inserted block its own line; a following blank block is added by
 *  the caller when a visible gap is wanted. */
function makeBlock(type: BlockType): Block {
  const base: Block = { id: freshId(), type, raw: "\n", text: "" };
  switch (type) {
    case "heading":
      return regenerateRaw({ ...base, level: 1 });
    case "task":
      return regenerateRaw({ ...base, checked: false, indent: "" });
    case "bulletItem":
      return regenerateRaw({ ...base, indent: "", marker: "-", ordered: false });
    case "orderedItem":
      return regenerateRaw({ ...base, indent: "", marker: "1.", ordered: true });
    case "code":
      return regenerateRaw({ ...base, lang: "" });
    case "divider":
      return regenerateRaw(base);
    case "quote":
    case "mathBlock":
    case "paragraph":
      return regenerateRaw(base);
    // Opaque blocks (table/html/image): seed a sensible raw so the read-only display has
    // something, edited as raw afterwards.
    case "table":
      return { id: freshId(), type, raw: "| Column | Column |\n| --- | --- |\n|  |  |\n" };
    case "image":
      return regenerateRaw({ ...base, type: "image", text: "" });
    default:
      return regenerateRaw(base);
  }
}

/** Which block types surface as plain editable text (a textarea) vs a read-only rendered
 *  display with a click-to-edit-raw affordance. */
function isTextEditable(type: BlockType): boolean {
  return (
    type === "paragraph" ||
    type === "heading" ||
    type === "quote" ||
    type === "bulletItem" ||
    type === "orderedItem" ||
    type === "task" ||
    type === "code"
  );
}

/** Blocks rendered as read-only markdown (with a click-to-edit-raw fallback). */
function isRendered(type: BlockType): boolean {
  return type === "table" || type === "image" || type === "html" || type === "mathBlock";
}

export function BlockEditor(props: {
  path: string | null;
  initialText?: string;
  onSaved: () => void;
  noteNames: () => NoteCandidate[];
  tagNames: () => string[];
}) {
  // --- Document state -------------------------------------------------------
  // The verbatim frontmatter prefix + the body blocks. `blocks` is a fine-grained STORE: edits
  // update individual block fields in place (`setBlocks(i, "text", v)`) so the DOM row + its
  // focused textarea persist across a keystroke. Structural changes go through `replaceBlocks`,
  // which reconciles by `id` so only the rows that actually changed remount.
  const [frontmatter, setFrontmatter] = createSignal("");
  const [blocks, setBlocks] = createStore<Block[]>([]);

  /** Replace the whole block list while PRESERVING the store proxy (and thus the DOM row +
   *  textarea focus) for every block whose `id` is unchanged — reconcile diffs by id, so an
   *  insert/remove/split/merge/reorder only touches the rows that actually changed. */
  const replaceBlocks = (next: Block[]): void => setBlocks(reconcile(next, { key: "id" }));

  // --- Anti-clobber bookkeeping (mirrors Editor.tsx) ------------------------
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  // Text of our most recent write to the current buffer, so we recognise the SSE echo of our
  // own save and don't reload stale disk over in-flight edits. Reset when the buffer switches.
  let lastSavedText: string | undefined;
  // True while there are local edits not yet flushed to disk. The external-reload reconcile
  // must NOT revert to disk in this window — disk is stale and the pending save will land.
  let pendingSave = false;
  // The currently-open buffer's path, tracked at component scope so the unload handler (added
  // once) flushes whatever buffer is open.
  let activePath: string | null = null;

  // Value-dedupe the path (props.path re-emits on every pane focus change). Only re-parse on a
  // real file switch — same memo guard Editor.tsx uses to avoid rebuilding mid-edit.
  const currentPath = createMemo(() => props.path);

  /** Current document serialized to markdown — the lossless frontmatter + every block's raw. */
  const docText = (): string => serializeBlocksToMarkdown(frontmatter(), blocks);

  const save = async (path: string, text: string) => {
    lastSavedText = text; // record before the await so a fast echo still matches
    await api.write(path, text);
    primeNoteCache(path, text); // keep the body cache warm so a reopen is instant
    props.onSaved();
    if (settings.vault.backupOnSave) api.backup(); // local-git snapshot; no-op when nothing changed
  };

  // Flush the debounced autosave NOW so a reload / file-switch / unload can't drop an edit
  // still sitting in the timer. `keepalive` lets the PUT survive page unload.
  const flushSave = (keepalive: boolean): void => {
    if (!pendingSave || !activePath) return;
    clearTimeout(saveTimer);
    const text = currentText();
    pendingSave = false;
    lastSavedText = text;
    if (keepalive) {
      try {
        void fetch(`${apiBase()}/file`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: activePath, contents: text }),
          keepalive: true,
        });
      } catch {
        /* best effort on unload */
      }
    } else {
      void save(activePath, text); // in-app navigation: a normal async write completes fine
    }
  };

  // `currentText` is reassigned per-buffer so flushSave/onBeforeUnload (added once) always read
  // the live document for whatever buffer is open.
  let currentText = (): string => docText();

  const onBeforeUnload = (): void => flushSave(true);
  if (typeof window !== "undefined") window.addEventListener("beforeunload", onBeforeUnload);
  onCleanup(() => {
    if (typeof window !== "undefined") window.removeEventListener("beforeunload", onBeforeUnload);
  });

  /** Schedule the debounced autosave. Plain typing calls this directly after a granular,
   *  re-render-free field update; structural edits go through `commit`. It does NOT re-normalize
   *  or re-parse the document: frontmatter spacing is normalized on open and blocks mode never
   *  edits the frontmatter, so re-parsing here would only churn — it would replace every block
   *  (fresh ids) and recreate the focused textarea mid-type. */
  const scheduleSave = (): void => {
    pendingSave = true; // local change not yet on disk → block reconcile-revert
    clearTimeout(saveTimer);
    const path = activePath;
    if (!path) return;
    saveTimer = setTimeout(async () => {
      const text = serializeBlocksToMarkdown(frontmatter(), blocks);
      await save(path, text);
      // Clear only if nothing changed during the write — else a newer edit is pending.
      if (serializeBlocksToMarkdown(frontmatter(), blocks) === text) pendingSave = false;
    }, settings.editor.autoSaveDelay);
  };

  /** Apply a STRUCTURAL block change (insert/remove/split/merge/reorder/type-change) and save.
   *  reconcile-by-id keeps every untouched row (and its caret) stable. */
  const commit = (nextBlocks: Block[]): void => {
    replaceBlocks(nextBlocks);
    scheduleSave();
  };

  // --- Buffer load + teardown ----------------------------------------------
  createEffect(async () => {
    const path = currentPath();
    activePath = path;
    onCleanup(() => {
      flushSave(false);
    });
    lastSavedText = undefined; // different buffer — forget the prior file's save text
    pendingSave = false;
    if (!path) {
      setFrontmatter("");
      setBlocks([]);
      return;
    }

    // Prefer the body FileView already fetched (no second HTTP round-trip on open). Fall back
    // to a read; a missing file is an empty note. Same precedence as Editor.tsx.
    let text = "";
    if (props.initialText !== undefined) {
      text = props.initialText;
    } else {
      try {
        text = await api.read(path);
      } catch {
        text = "";
      }
    }
    if (path !== currentPath()) return; // path changed mid-await — discard this run

    // Auto-format on open: keep exactly one blank line between frontmatter and body, and
    // persist the reformat so the file self-heals (notes only). Identical to Editor.tsx so the
    // surfaces agree on the canonical on-disk form. The doc we render equals what we write, so
    // the SSE echo is a clean no-op.
    const isMd = !path.endsWith(".yaml") && !path.endsWith(".yml");
    if (isMd) {
      const normalized = normalizeFrontmatterSpacing(text);
      if (normalized !== text) {
        text = normalized;
        lastSavedText = text; // recognise the echo of this write as our own
        void api.write(path, text);
      }
    }

    const parsed = parseMarkdownToBlocks(text);
    setFrontmatter(parsed.frontmatter);
    replaceBlocks(parsed.blocks);
  });

  // --- External-change reconcile (SSE) --------------------------------------
  // Skip the echo of versions we already reconciled (typically our own debounced save).
  let lastIgnoredVersion = -1;
  createEffect(async () => {
    const change = lastChange();
    const path = props.path;
    if (!path) return;
    const affectsUs = change.paths.length === 0 /* unknown — assume so */ || change.paths.includes(path);
    if (!affectsUs) return;
    if (change.version === lastIgnoredVersion) return;
    // Un-flushed local edits → disk is stale and our pending save is about to overwrite it.
    // Reverting now would clobber the local edit; skip and let the post-save echo reconcile.
    if (pendingSave) return;

    let onDisk: string;
    try {
      onDisk = await api.read(path);
    } catch {
      return; // file may have been deleted; another flow handles tab cleanup
    }
    primeNoteCache(path, onDisk); // freshest on-disk truth — keep the body cache warm
    if (path !== props.path) return; // path changed while awaiting
    const current = serializeBlocksToMarkdown(frontmatter(), blocks);
    if (current === onDisk) {
      lastIgnoredVersion = change.version; // no-op refresh (e.g. our own save echoed back)
      return;
    }
    if (onDisk === lastSavedText) {
      // The echo of OUR OWN save, but we've edited further since — reloading would revert those
      // in-flight edits. Skip; the pending autosave will write `current` and reconcile.
      lastIgnoredVersion = change.version;
      return;
    }
    // A real external change: re-parse from disk. (Blocks have no cursor/scroll to preserve the
    // way CodeMirror does, so a full reparse is fine — keyed rows keep untouched DOM stable.)
    const parsed = parseMarkdownToBlocks(onDisk);
    setFrontmatter(parsed.frontmatter);
    replaceBlocks(parsed.blocks);
    lastIgnoredVersion = change.version;
  });

  // ------------------------------------------------------------------------
  // Editing operations (all funnel through `commit`)
  // ------------------------------------------------------------------------

  const indexOfId = (id: string): number => blocks.findIndex((b) => b.id === id);

  const updateBlock = (id: string, mutate: (b: Block) => Block): void => {
    const i = indexOfId(id);
    if (i === -1) return;
    const next = blocks.slice();
    next[i] = mutate(next[i]);
    commit(next);
  };

  /** Insert `block` (+ a trailing blank gap) after the block with `afterId`; focus it next
   *  tick. Returns the inserted block's id. */
  const insertAfter = (afterId: string, block: Block): string => {
    const i = indexOfId(afterId);
    const next = blocks.slice();
    const at = i === -1 ? next.length : i + 1;
    next.splice(at, 0, block);
    commit(next);
    queueFocus(block.id);
    return block.id;
  };

  const removeBlock = (id: string): void => {
    const i = indexOfId(id);
    if (i === -1) return;
    const next = blocks.slice();
    next.splice(i, 1);
    commit(next);
  };

  /** Enter inside a text block: split into the same kind, carrying the text after the caret
   *  into the new block (so paragraphs/list items behave like a normal editor). */
  const splitBlock = (id: string, caret: number): void => {
    const i = indexOfId(id);
    if (i === -1) return;
    const cur = blocks[i];
    const text = cur.text ?? "";
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    // A heading splits into a paragraph (Notion-like); list items / tasks continue their kind.
    const newType: BlockType =
      cur.type === "heading" ? "paragraph" : cur.type;
    let created = makeBlock(newType);
    // Preserve list/task indent + marker so the continued item nests the same.
    if (newType === "bulletItem" || newType === "orderedItem" || newType === "task") {
      created = regenerateRaw({ ...created, indent: cur.indent ?? "", marker: cur.marker ?? created.marker, ordered: cur.ordered, text: after });
    } else {
      created = setBlockText(created, after);
    }
    const next = blocks.slice();
    next[i] = setBlockText(cur, before);
    next.splice(i + 1, 0, created);
    commit(next);
    queueFocus(created.id);
  };

  /** Backspace at the start of an empty/short block: merge into the previous text block,
   *  placing the caret at the join. Falls back to deleting an empty block when there's no
   *  prior text block. */
  const mergeIntoPrevious = (id: string): void => {
    const i = indexOfId(id);
    if (i <= 0) return;
    // Find the nearest previous TEXT-editable block (skip blank gaps).
    let p = i - 1;
    while (p >= 0 && !isTextEditable(blocks[p].type)) p--;
    const cur = blocks[i];
    if (p < 0) {
      // No prior text block — just drop this one if it's empty.
      if ((cur.text ?? "") === "") removeBlock(id);
      return;
    }
    const prev = blocks[p];
    const joinAt = (prev.text ?? "").length;
    const merged = setBlockText(prev, (prev.text ?? "") + (cur.text ?? ""));
    const next = blocks.slice();
    next[p] = merged;
    // Remove everything from p+1 through i (the blank gap + the current block) so the merge
    // closes the visual gap too.
    next.splice(p + 1, i - p);
    commit(next);
    queueFocus(prev.id, joinAt);
  };

  // --- Focus scheduling ------------------------------------------------------
  // Each block's textarea registers itself by id (the ref runs synchronously during render).
  // Because reconcile-by-id keeps rows mounted across edits, focus must address the LIVE element
  // by id — not a ref that only re-fires on remount. queueFocus defers to a microtask so any
  // just-created row has registered before we focus it.
  const taById = new Map<string, HTMLTextAreaElement>();
  const queueFocus = (id: string, caret?: number): void => {
    queueMicrotask(() => {
      const el = taById.get(id);
      if (!el) return;
      el.focus();
      const pos = caret ?? el.value.length;
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        /* setSelectionRange not applicable */
      }
      autoGrow(el);
    });
  };

  /** Textarea autosize: grow to fit content so a block has no inner scrollbar. */
  const autoGrow = (el: HTMLTextAreaElement): void => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // ------------------------------------------------------------------------
  // Slash menu
  // ------------------------------------------------------------------------
  const [slash, setSlash] = createSignal<{
    blockId: string;
    query: string;
    x: number;
    y: number;
  } | null>(null);
  const slashFiltered = createMemo<SlashItem[]>(() => {
    const s = slash();
    if (!s) return [];
    // Properties (frontmatter) only makes sense at doc start, and is handled separately; keep
    // the rest. We drop wikilink/embed here since those insert inline text, not a block — they
    // map to paragraph and would just create an empty paragraph; still allow them as paragraph
    // inserts is confusing, so filter them out of the block menu.
    const items = SLASH_ITEMS.filter((it) => it.id !== "wikilink" && it.id !== "embed" && it.id !== "properties");
    return filterSlashItems(items, s.query);
  });
  const slashNav = createMenuNav({
    count: () => slashFiltered().length,
    onSelect: (i) => chooseSlash(i),
    onEscape: () => setSlash(null),
  });
  const slashRows = createMemo<PopoverRow[]>(() =>
    slashFiltered().map((it) => ({ label: it.label, icon: it.icon, detail: it.info })),
  );

  /** Pick a slash item: transform the (empty) trigger block into a block of that type. The
   *  `query`/`code` snippet items map to a `code` block; everything else to its block type. */
  const chooseSlash = (i: number): void => {
    const s = slash();
    const item = slashFiltered()[i];
    if (!s || !item) return;
    setSlash(null);
    const idx = indexOfId(s.blockId);
    if (idx === -1) return;
    const newType = blockTypeForSlashItem(item.id);
    let block = makeBlock(newType);
    // For a `query` block, seed the code lang so it round-trips as ```query.
    if (item.id === "query") block = regenerateRaw({ ...block, type: "code", lang: "query" });
    const next = blocks.slice();
    next[idx] = block;
    commit(next);
    if (isTextEditable(block.type)) queueFocus(block.id);
  };

  // --- Drag-to-reorder -------------------------------------------------------
  const [dragId, setDragId] = createSignal<string | null>(null);
  const [dragOverId, setDragOverId] = createSignal<string | null>(null);
  const onDrop = (targetId: string): void => {
    const from = dragId();
    setDragId(null);
    setDragOverId(null);
    if (!from || from === targetId) return;
    const fromI = indexOfId(from);
    const toI = indexOfId(targetId);
    if (fromI === -1 || toI === -1) return;
    const next = blocks.slice();
    const [moved] = next.splice(fromI, 1);
    // Re-find the target index after removal so the moved block lands just before it.
    const adjusted = next.findIndex((b) => b.id === targetId);
    next.splice(adjusted, 0, moved);
    commit(next);
  };

  // ------------------------------------------------------------------------
  // Per-block input handling
  // ------------------------------------------------------------------------
  const onTextInput = (block: Block, el: HTMLTextAreaElement): void => {
    autoGrow(el);
    const value = el.value;
    // Slash trigger: only fires when the `/` is the first content char of the (single) line —
    // matchSlashPrefix enforces that. We feed it the text up to the caret on the current line.
    const caret = el.selectionStart ?? value.length;
    const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
    const textBefore = value.slice(lineStart, caret);
    const m = matchSlashPrefix(textBefore);
    if (m && (block.type === "paragraph" || block.type === "bulletItem" || block.type === "orderedItem")) {
      // Only offer the menu on an otherwise-empty block (Notion behaviour): the `/query` token
      // is the only content. Position the popover under the textarea.
      const rect = el.getBoundingClientRect();
      setSlash({ blockId: block.id, query: m.query, x: rect.left, y: rect.bottom + 4 });
      slashNav.setActive(0);
    } else if (slash() && slash()!.blockId === block.id) {
      setSlash(null);
    }
    // Plain typing: update text + regenerated raw IN PLACE (granular store writes) and save.
    // No reconcile/split here — that would replace the block (and recreate the focused textarea)
    // mid-keystroke. Markdown shortcuts (# → heading) and pasted-newline splits are applied on
    // BLUR (onTextBlur), so typing is never interrupted.
    onPlainInput(block.id, value);
  };

  /** A plain in-place text edit: rewrite the block's `text` + `raw` via granular store updates so
   *  the DOM row + caret persist (no remount), then schedule a save. */
  const onPlainInput = (id: string, value: string): void => {
    const i = indexOfId(id);
    if (i === -1) return;
    const raw = regenerateRaw({ ...blocks[i], text: value }).raw;
    setBlocks(i, "text", value);
    setBlocks(i, "raw", raw);
    scheduleSave();
  };

  /** On blur, re-align the block with what its markdown re-parses to: a "# "/"- "/"> " prefix
   *  becomes a heading/list/quote, and a pasted/Shift+Enter newline in a single-line block splits
   *  into real blocks. Deferred to blur (not per keystroke) so the caret is never disturbed while
   *  typing; no-op when the structure is unchanged. */
  const onTextBlur = (id: string): void => {
    const i = indexOfId(id);
    if (i === -1) return;
    const reconciled = reconcileEditedBlock({ ...blocks[i] });
    if (reconciled.length === 1 && reconciled[0].type === blocks[i].type) return; // unchanged
    const next = blocks.slice();
    next.splice(i, 1, ...reconciled);
    commit(next);
  };

  const onTextKeyDown = (block: Block, e: KeyboardEvent, el: HTMLTextAreaElement): void => {
    // Slash menu owns navigation/selection keys while open for this block.
    if (slash() && slash()!.blockId === block.id) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") {
        slashNav.onKeyDown(e);
        return;
      }
    }
    const caret = el.selectionStart ?? 0;
    const value = el.value;
    if (e.key === "Enter" && !e.shiftKey) {
      // Shift+Enter inserts a literal newline within the block (default textarea behaviour);
      // plain Enter splits into a new block. Code blocks keep Enter as a newline.
      if (block.type === "code") return;
      e.preventDefault();
      splitBlock(block.id, caret);
      return;
    }
    if (e.key === "Backspace" && caret === 0 && (el.selectionEnd ?? 0) === 0) {
      // At the very start of a block: merge into the previous text block.
      e.preventDefault();
      mergeIntoPrevious(block.id);
      return;
    }
    if (e.key === "ArrowUp" && caret === 0) {
      e.preventDefault();
      focusSibling(block.id, -1);
      return;
    }
    if (e.key === "ArrowDown" && caret === value.length) {
      e.preventDefault();
      focusSibling(block.id, 1);
      return;
    }
  };

  /** Move focus to the next/previous text-editable block. */
  const focusSibling = (id: string, dir: 1 | -1): void => {
    const i = indexOfId(id);
    if (i === -1) return;
    let j = i + dir;
    while (j >= 0 && j < blocks.length && !isTextEditable(blocks[j].type)) j += dir;
    if (j < 0 || j >= blocks.length) return;
    queueFocus(blocks[j].id);
  };

  // ------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------
  let host!: HTMLDivElement;

  /** Insert an empty paragraph below `afterId` (the gutter "+" affordance). */
  const insertParagraphBelow = (afterId: string): void => {
    insertAfter(afterId, makeBlock("paragraph"));
  };

  const rowClass = (block: Block): string => {
    const over = dragOverId() === block.id ? " block-row--dragover" : "";
    return `block-row block-row--${block.type}${over}`;
  };

  return (
    <div class="block-editor" ref={host}>
      <div class="block-editor-col">
        <For each={blocks}>
          {(block) => (
            <div
              class={rowClass(block)}
              data-block-id={block.id}
              onDragOver={(e) => {
                if (!dragId()) return;
                e.preventDefault();
                setDragOverId(block.id);
              }}
              onDragLeave={() => {
                if (dragOverId() === block.id) setDragOverId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(block.id);
              }}
            >
              <div class="block-gutter">
                <button
                  class="block-add"
                  title="Insert block below"
                  onClick={() => insertParagraphBelow(block.id)}
                >
                  <PlusGlyph />
                </button>
                <span
                  class="block-handle"
                  title="Drag to reorder"
                  draggable={true}
                  onDragStart={() => setDragId(block.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setDragOverId(null);
                  }}
                >
                  <GripGlyph />
                </span>
              </div>
              <div class="block-body">{renderBlock(block)}</div>
            </div>
          )}
        </For>
        <Show when={blocks.length === 0}>
          <div class="block-empty">
            <button class="block-empty-add" onClick={() => commit([makeBlock("paragraph")])}>
              Start writing…
            </button>
          </div>
        </Show>
      </div>

      <Show when={slash()}>
        {(s) => (
          <div
            class="block-slash-popover"
            style={{ position: "fixed", left: `${s().x}px`, top: `${s().y}px`, "z-index": 50 }}
            onMouseDown={(e) => e.preventDefault() /* keep textarea focus */}
          >
            <Show
              when={slashRows().length > 0}
              fallback={<div class="oa-popover block-slash-empty">No blocks</div>}
            >
              <PopoverList
                items={slashRows()}
                active={slashNav.active()}
                onActivate={(i) => chooseSlash(i)}
                onHover={(i) => slashNav.setActive(i)}
              />
            </Show>
          </div>
        )}
      </Show>
    </div>
  );

  // --- Per-type block renderers --------------------------------------------
  function renderBlock(block: Block) {
    if (block.type === "divider") {
      return <hr class="block-hr" />;
    }
    if (block.type === "blank") {
      // A spacer between content blocks — render nothing visible, but keep the row so the gutter
      // affordances still let you insert/reorder around the gap.
      return <div class="block-spacer" />;
    }
    if (isRendered(block.type)) {
      return <RenderedBlock block={block} />;
    }
    if (isTextEditable(block.type)) {
      return <TextBlock block={block} />;
    }
    // unknown / frontmatter (shouldn't appear in body) — show raw read-only.
    return <pre class="block-raw">{block.raw}</pre>;
  }

  // A text block: a checkbox (tasks) + an autosizing textarea styled per type.
  function TextBlock(p: { block: Block }) {
    let ta: HTMLTextAreaElement | undefined;
    onMount(() => {
      if (ta) autoGrow(ta);
    });
    onCleanup(() => {
      if (ta && taById.get(p.block.id) === ta) taById.delete(p.block.id);
    });
    const placeholder = (): string => {
      switch (p.block.type) {
        case "heading":
          return `Heading ${p.block.level ?? 1}`;
        case "task":
          return "To-do";
        case "bulletItem":
        case "orderedItem":
          return "List item";
        case "quote":
          return "Quote";
        case "code":
          return "Code";
        default:
          return "Type '/' for blocks…";
      }
    };
    const taClass = (): string => {
      let c = "block-text";
      if (p.block.type === "heading") c += ` block-text--h${Math.min(6, Math.max(1, p.block.level ?? 1))}`;
      else c += ` block-text--${p.block.type}`;
      if (p.block.type === "task" && p.block.checked) c += " block-text--done";
      return c;
    };
    return (
      <div class="block-text-wrap">
        <Show when={p.block.type === "task"}>
          <input
            type="checkbox"
            class="block-checkbox"
            checked={p.block.checked}
            onChange={() => updateBlock(p.block.id, (b) => toggleTaskChecked(b))}
          />
        </Show>
        <Show when={p.block.type === "bulletItem"}>
          <span class="block-bullet">•</span>
        </Show>
        <Show when={p.block.type === "orderedItem"}>
          <span class="block-number">{p.block.marker ?? "1."}</span>
        </Show>
        <textarea
          ref={(el) => {
            ta = el;
            taById.set(p.block.id, el); // register for id-addressed focus (survives reconcile)
            // Caret-safe controlled value: write the DOM value ONLY when it differs from what's
            // already there. While the user types, p.block.text === el.value (we set it from the
            // input), so we skip the write and the caret never jumps; a PROGRAMMATIC change
            // (split/merge/slash/external reload) differs, so we sync it. Tracks the reactive
            // store field, so it re-runs on every in-place text update.
            createRenderEffect(() => {
              const v = p.block.text ?? "";
              if (el.value !== v) {
                el.value = v;
                autoGrow(el);
              }
            });
          }}
          class={taClass()}
          rows={1}
          placeholder={placeholder()}
          spellcheck={settings.editor.spellcheck}
          onInput={(e) => onTextInput(p.block, e.currentTarget)}
          onKeyDown={(e) => onTextKeyDown(p.block, e, e.currentTarget)}
          onBlur={() => onTextBlur(p.block.id)}
        />
      </div>
    );
  }

  // A rendered (read-only) block: table/image/html/math. Click toggles a raw textarea editor so
  // it stays editable without a full markdown surface.
  function RenderedBlock(p: { block: Block }) {
    const [editing, setEditing] = createSignal(false);
    let ta: HTMLTextAreaElement | undefined;
    return (
      <Show
        when={editing()}
        fallback={
          <div
            class="block-rendered"
            title="Click to edit source"
            onClick={() => {
              setEditing(true);
              queueMicrotask(() => {
                if (ta) {
                  autoGrow(ta);
                  ta.focus();
                }
              });
            }}
            innerHTML={renderNoteBody(p.block.raw)}
          />
        }
      >
        <textarea
          ref={(el) => (ta = el)}
          class="block-raw-edit"
          rows={1}
          value={p.block.raw}
          onInput={(e) => autoGrow(e.currentTarget)}
          onBlur={(e) => {
            setEditing(false);
            const raw = e.currentTarget.value;
            // Re-parse the edited raw so the block re-typifies (e.g. an edited table stays a
            // table, or becomes a paragraph). Replace this single block with the reparse.
            updateBlock(p.block.id, () => reparseRaw(raw));
          }}
        />
      </Show>
    );
  }
}

/** Re-parse one block's edited raw back into a Block, preserving a trailing newline so it keeps
 *  its own line. Reuses the document parser on the isolated snippet and takes the first body
 *  block (opaque blocks like tables span multiple lines but parse as one block). */
function reparseRaw(raw: string): Block {
  const withEol = raw.endsWith("\n") ? raw : raw + "\n";
  const parsed = parseMarkdownToBlocks(withEol);
  const first = parsed.blocks.find((b) => b.type !== "blank");
  if (first) return { ...first, id: freshId() };
  return { id: freshId(), type: "paragraph", raw: withEol, text: raw };
}

// Inline glyphs (kept tiny + dependency-free so the gutter affordances don't pull a Lucide
// chunk for two icons that are effectively decorative). GripVertical = the drag handle.
function GripGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}
function PlusGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
