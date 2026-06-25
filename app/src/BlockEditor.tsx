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
import { parseFrontmatter } from "../../core/src/frontmatter";
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
  filterSlashItems,
  type SlashItem,
} from "./editor/slashMenu";
import { PopoverList, type PopoverRow } from "./ui/popover/PopoverList";
import { createMenuNav } from "./ui/popover/createMenuNav";
import { type NoteCandidate } from "./editor/wikilink";
import { FormatBar, type FormatBarState, type FormatBlockKind } from "./blocks/FormatBar";
import { BaseView } from "./bases/BaseView";
import { QueryBuilder } from "./bases/QueryBuilder";
import { looksLikeBaseConfig, parseQueryBlockBody, isBuilderRepresentable, type BuilderState } from "./bases/queryGen";
import { parseQueryBlock } from "../../core/src/bases/queryBlock";
import { IconButton } from "./ui/IconButton";
import type { BlockEditorHandle, CaretHint, createBlockEditor as CreateBlockEditorFn } from "./blocks/milkdownEditor";
import "./BlockEditor.css";

// The Milkdown bridge is code-split (ProseMirror + remark are heavy) — loaded once on first
// text-block mount and shared by every block afterwards (sheet/univerSheet.ts pattern). The
// promise is module-scoped so concurrent first mounts share one import.
let milkdownModule: Promise<{ createBlockEditor: typeof CreateBlockEditorFn }> | null = null;
function loadMilkdown(): Promise<{ createBlockEditor: typeof CreateBlockEditorFn }> {
  if (!milkdownModule) milkdownModule = import("./blocks/milkdownEditor");
  return milkdownModule;
}

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

/** A live `\`\`\`query` block (code + lang "query") renders as a BaseView, not a textarea. */
function isQueryBlock(b: Block): boolean {
  return b.type === "code" && b.lang === "query";
}

/** A TRUE-WYSIWYG rich-text block: edited in a Milkdown surface (bold renders bold, wikilinks/
 *  tags become chips, no markdown symbols shown). This is every text-editable type EXCEPT `code`
 *  — code stays a monospace textarea (raw is the point) and a `\`\`\`query` code block renders a
 *  BaseView. The block model still owns the block PREFIX (#, -, >, - [ ]); Milkdown only edits
 *  the inline `text`. */
function isRichText(type: BlockType): boolean {
  return (
    type === "paragraph" ||
    type === "heading" ||
    type === "quote" ||
    type === "bulletItem" ||
    type === "orderedItem" ||
    type === "task"
  );
}

/** A block that hosts an editable textarea, for caret navigation (Arrow up/down, Backspace
 *  merge). Excludes query blocks: they're a code type but render a BaseView with no textarea,
 *  so treating them as a focus target would strand the caret. */
function isTextNavTarget(b: Block): boolean {
  return isTextEditable(b.type) && !isQueryBlock(b);
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

  // --- Frontmatter properties (read-only display) ---------------------------
  // The frontmatter is kept as a VERBATIM prefix in `frontmatter()` and is NEVER a block — it's
  // never edited here and serialize concatenates it byte-for-byte. In source mode CodeMirror shows
  // the raw `---` YAML with a line-number gutter; visual mode instead surfaces it as a clean
  // read-only properties strip (key + rendered value chips) so the note's metadata is visible
  // without the raw monospace `1 | tags: […]` line. Parsing is display-only (parseFrontmatter, the
  // same tolerant peeler the model uses); editing properties stays in source mode / the FileTree.
  const properties = createMemo<{ key: string; values: string[] }[]>(() => {
    const fm = frontmatter();
    if (!fm) return [];
    const { data } = parseFrontmatter(fm);
    return Object.entries(data).map(([key, value]) => ({ key, values: propValues(value) }));
  });

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
    // Focus the new block at its START (caret 0), where the split occurred — the carried-over
    // tail text sits after the caret, matching a normal editor's Enter behaviour.
    queueFocus(created.id, 0);
  };

  /** Backspace at the start of an empty/short block: merge into the previous text block,
   *  placing the caret at the join. Falls back to deleting an empty block when there's no
   *  prior text block. */
  const mergeIntoPrevious = (id: string): void => {
    const i = indexOfId(id);
    if (i <= 0) return;
    // Find the nearest previous TEXT-editable block (skip blank gaps + query blocks).
    let p = i - 1;
    while (p >= 0 && !isTextNavTarget(blocks[p])) p--;
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

  /** Change a block's TYPE in place (the format toolbar's H1-H3 / bullet actions), PRESERVING its
   *  inline `text`. Heading carries the level; list/quote drop the heading level. Re-runs
   *  regenerateRaw so the new prefix (#, -, >) round-trips. reconcile-by-id keeps the row + caret
   *  stable, then we re-focus so the Milkdown surface keeps the caret. */
  const changeBlockKind = (id: string, kind: FormatBlockKind): void => {
    const i = indexOfId(id);
    if (i === -1) return;
    const cur = blocks[i];
    const text = cur.text ?? "";
    let next: Block;
    if (kind === "bullet") {
      next = regenerateRaw({ id: cur.id, type: "bulletItem", indent: "", marker: "-", ordered: false, text, raw: "" });
    } else {
      const level = kind === "h1" ? 1 : kind === "h2" ? 2 : 3;
      next = regenerateRaw({ id: cur.id, type: "heading", level, text, raw: "" });
    }
    updateBlock(id, () => next);
    queueFocus(id, text.length);
  };

  // --- Focus scheduling ------------------------------------------------------
  // Each block's editable surface registers a focus closure by id (the ref runs synchronously
  // during render). Because reconcile-by-id keeps rows mounted across edits, focus must address
  // the LIVE surface by id — not a ref that only re-fires on remount. A rich-text block registers
  // a Milkdown handle's focus(); a code block registers its textarea's. queueFocus defers to a
  // microtask so any just-created row has registered before we focus it. The Milkdown surface
  // mounts ASYNCHRONOUSLY (Editor.create() is async), so a focus that lands before the handle is
  // ready is retried for a couple of frames.
  const focusById = new Map<string, (caret?: CaretHint) => void>();
  const queueFocus = (id: string, caret?: number): void => {
    const want: CaretHint | undefined = caret;
    const attempt = (tries: number): void => {
      const fn = focusById.get(id);
      if (fn) {
        fn(want);
        return;
      }
      if (tries > 0) requestAnimationFrame(() => attempt(tries - 1));
    };
    queueMicrotask(() => attempt(8));
  };

  // --- Lazy mount (viewport virtualization) ---------------------------------
  // A rich-text block hosts a full ProseMirror EditorView, which is heavy to construct and paint.
  // On a long note we mount Milkdown ONLY for blocks in or NEAR the viewport; an offscreen block
  // renders a lightweight static `renderNoteBody` preview until scrolled in. The store stays the
  // single source of truth (every keystroke flows through onPlainInput into the store), so an
  // unmount can never lose data — serialize always reads the store, never the DOM.
  //
  // One shared IntersectionObserver (created lazily once `host` is mounted) watches every
  // rich-text block's root. Its `root` is the scroll container (`.block-editor` = `host`) and its
  // `rootMargin` extends a full viewport above + below so a block mounts BEFORE it scrolls into
  // sight (no blank flash on fast scroll). Each block registers a visibility callback keyed by its
  // root element; the observer dispatches `isIntersecting` to it.
  const visibilityCb = new WeakMap<Element, (near: boolean) => void>();
  let blockObserver: IntersectionObserver | undefined;
  const ensureObserver = (): IntersectionObserver | undefined => {
    if (typeof IntersectionObserver === "undefined") return undefined; // headless / jsdom
    if (!blockObserver) {
      blockObserver = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const cb = visibilityCb.get(e.target);
            if (cb) cb(e.isIntersecting);
          }
        },
        // host is the scroll container; one viewport of pre-mount margin on each edge.
        { root: host, rootMargin: "100% 0px 100% 0px", threshold: 0 },
      );
    }
    return blockObserver;
  };
  /** Observe `el` for viewport proximity, dispatching `near`/`far` to `cb`. Returns an unobserve. */
  const observeBlock = (el: Element, cb: (near: boolean) => void): (() => void) => {
    const obs = ensureObserver();
    if (!obs) {
      cb(true); // no observer (headless) → always-mounted, preserving prior behaviour + tests
      return () => {};
    }
    visibilityCb.set(el, cb);
    obs.observe(el);
    return () => {
      obs.unobserve(el);
      visibilityCb.delete(el);
    };
  };
  onCleanup(() => blockObserver?.disconnect());

  // Warm the Milkdown chunk as soon as the surface opens so a block scrolling into view doesn't
  // stall on the (~one-time) code-split import — only the per-view construction then remains.
  onMount(() => void loadMilkdown());

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
  // The visual query builder. When set, the QueryBuilder modal is open over `blockId`; on
  // confirm it rewrites that block as a ```query fence (built from the no-code form). `initial`
  // seeds it when editing an existing block (parsed from its body); absent → a fresh query.
  const [builder, setBuilder] = createSignal<{ blockId: string; initial?: BuilderState } | null>(
    null,
  );

  // --- Wikilink / tag autocomplete (the Milkdown-surface equivalent of the CodeMirror sources).
  // The bridge detects the open `[[…`/`#tag` trigger + reports the query + caret rect; we render
  // the SAME PopoverList + createMenuNav the slash menu uses, and commit the chosen candidate back
  // through the bridge's applyAutocomplete (which re-parses the inserted text into a live chip).
  const [auto, setAuto] = createSignal<{
    blockId: string;
    handle: BlockEditorHandle;
    kind: "wikilink" | "tag";
    query: string;
    from: number; // markdown offset where the query starts (after `[[` / `#`)
    x: number;
    y: number;
  } | null>(null);

  /** Candidate strings (the raw insert text) for the active autocomplete, ranked by a simple
   *  prefix-then-substring match — note basenames for `[[`, tag names for `#`. */
  const autoCandidates = createMemo<{ label: string; detail?: string }[]>(() => {
    const a = auto();
    if (!a) return [];
    const q = a.query.toLowerCase();
    if (a.kind === "wikilink") {
      const notes = props.noteNames();
      const ranked = notes
        .map((n) => ({ n, score: matchScore(n.label.toLowerCase(), q) }))
        .filter((r) => r.score >= 0)
        .sort((r1, r2) => r1.score - r2.score || r1.n.label.localeCompare(r2.n.label))
        .slice(0, 50);
      return ranked.map((r) => ({ label: r.n.label, detail: r.n.folder }));
    }
    const tags = props.tagNames();
    const ranked = tags
      .map((t) => ({ t, score: matchScore(t.toLowerCase(), q) }))
      .filter((r) => r.score >= 0)
      .sort((r1, r2) => r1.score - r2.score || r1.t.localeCompare(r2.t))
      .slice(0, 50);
    return ranked.map((r) => ({ label: r.t }));
  });
  const autoNav = createMenuNav({
    count: () => autoCandidates().length,
    onSelect: (i) => chooseAuto(i),
    onEscape: () => setAuto(null),
  });
  const autoRows = createMemo<PopoverRow[]>(() =>
    autoCandidates().map((c) => ({
      label: c.label,
      icon: auto()?.kind === "tag" ? "Hash" : "FileText",
      detail: c.detail,
    })),
  );

  /** Commit the chosen wikilink/tag candidate: replace the partial token (from its OPENING delimiter
   *  to the caret) with the complete `[[Label]]` / `#tag`, which the bridge re-parses into a live
   *  chip, landing the caret past it. */
  const chooseAuto = (i: number): void => {
    const a = auto();
    const cand = autoCandidates()[i];
    if (!a || !cand) return;
    setAuto(null);
    // Anchor the replacement at the OPENING delimiter (`[[` / `#`) and insert the WHOLE token so the
    // bridge's inline re-parse tokenizes it into a live wikilink/tag CHIP — anchoring after the
    // delimiter (and inserting just the tail) leaves `[[Label]]` as raw text until an external reload.
    // Caret lands past the atom (applyAutocomplete defaults to the parsed content size).
    if (a.kind === "wikilink") {
      a.handle.applyAutocomplete(a.from - 2, `[[${cand.label}]]`);
    } else {
      a.handle.applyAutocomplete(a.from - 1, `#${cand.label}`);
    }
  };

  // --- Selection-anchored format toolbar (B/I/code/link + H1-H3/list). Shown while a rich-text
  // block holds a non-empty selection; the bridge reports the selection rect, marks route to the
  // bridge's exec(), heading/list buttons change the BLOCK type via the store.
  const [format, setFormat] = createSignal<FormatBarState | null>(null);
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
    // `/query` opens the no-code visual builder instead of inserting an empty fence. The trigger
    // block stays as-is (the empty paragraph) until the builder confirms — at which point it's
    // rewritten as a ```query fence; cancelling leaves the empty paragraph untouched.
    if (item.id === "query") {
      setBuilder({ blockId: s.blockId, initial: undefined });
      return;
    }
    const newType = blockTypeForSlashItem(item.id);
    const block = makeBlock(newType);
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
  // NOTE: onTextInput/onTextKeyDown/onTextBlur now back ONLY the `code` block's textarea (rich-text
  // blocks use the Milkdown bridge, which owns slash/Enter-split/etc.). The slash-menu and
  // Enter-split branches that existed here for the old rich-text textarea were dead for `code` (the
  // type guard excluded it; Enter already fell through to a literal newline) and have been removed.
  const onTextInput = (block: Block, el: HTMLTextAreaElement): void => {
    autoGrow(el);
    // Plain typing in a code block: update text + regenerated raw IN PLACE (granular store writes)
    // and save. No reconcile/split here — applied on BLUR (onTextBlur) so the caret isn't disturbed.
    onPlainInput(block.id, el.value);
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
    const caret = el.selectionStart ?? 0;
    const value = el.value;
    // Enter is a literal newline in a code block (default textarea behaviour) — no split intercept.
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
    while (j >= 0 && j < blocks.length && !isTextNavTarget(blocks[j])) j += dir;
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
        <Show when={properties().length > 0}>
          <div class="block-properties" role="table" aria-label="Note properties">
            <For each={properties()}>
              {(prop) => (
                <div class="block-prop" role="row">
                  <span class="block-prop-key" role="rowheader">{prop.key}</span>
                  <span class="block-prop-values" role="cell">
                    <For each={prop.values}>
                      {(v) => <span class="block-prop-value">{v}</span>}
                    </For>
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
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

      <Show when={auto()}>
        {(a) => (
          <div
            class="block-slash-popover"
            style={{ position: "fixed", left: `${a().x}px`, top: `${a().y}px`, "z-index": 55 }}
            onMouseDown={(e) => e.preventDefault() /* keep the surface focused */}
          >
            <Show
              when={autoRows().length > 0}
              fallback={
                <div class="oa-popover block-slash-empty">
                  {a().kind === "wikilink" ? "No notes" : "No tags"}
                </div>
              }
            >
              <PopoverList
                items={autoRows()}
                active={autoNav.active()}
                onActivate={(i) => chooseAuto(i)}
                onHover={(i) => autoNav.setActive(i)}
              />
            </Show>
          </div>
        )}
      </Show>

      <Show when={format()}>
        {(f) => <FormatBar state={f()} />}
      </Show>

      <Show when={builder()}>
        {(b) => (
          <QueryBuilder
            hostPath={props.path ?? undefined}
            initial={b().initial}
            onConfirm={(body) => {
              const id = b().blockId;
              setBuilder(null);
              // Rewrite the target block as a ```query fence carrying the built body. The block
              // model stores the fence body in `text`; regenerateRaw re-emits the ```query fence
              // (renderBlockToMarkdown "code"). reconcile-by-id keeps the rest of the doc stable.
              updateBlock(id, (blk) =>
                regenerateRaw({ ...blk, type: "code", lang: "query", text: body }),
              );
            }}
            onClose={() => setBuilder(null)}
          />
        )}
      </Show>
    </div>
  );

  // --- Per-type block renderers --------------------------------------------
  function renderBlock(block: Block) {
    // A ```query fenced code block renders as a LIVE base view (not a monospace textarea),
    // mirroring the CodeMirror editor/queryBlock.ts mount. An Edit affordance re-opens the
    // visual builder seeded from the parsed body.
    if (block.type === "code" && block.lang === "query") {
      return <QueryBlockBlock block={block} />;
    }
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

  // A text block: a checkbox (tasks) / list marker + the editable content. Rich-text blocks
  // (paragraph/heading/quote/list/task) host a TRUE-WYSIWYG Milkdown surface (RichTextBlock);
  // `code` keeps a monospace textarea (raw is the point).
  function TextBlock(p: { block: Block }) {
    const wrapClass = (): string => {
      let c = "block-text-wrap";
      if (p.block.type === "task" && p.block.checked) c += " block-text-wrap--done";
      return c;
    };
    return (
      <div class={wrapClass()}>
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
        <Show when={isRichText(p.block.type)} fallback={<CodeBlock block={p.block} />}>
          <RichTextBlock block={p.block} />
        </Show>
      </div>
    );
  }

  // The TRUE-WYSIWYG surface for one rich-text block, with VIEWPORT-LAZY mounting.
  //
  // Constructing a ProseMirror EditorView per block is heavy, so we only mount Milkdown for blocks
  // in/near the viewport (the shared IntersectionObserver above). An offscreen block renders a
  // lightweight, read-only `renderNoteBody` static preview into the SAME root; it mounts the live
  // surface on scroll-in (or when focused/navigated to) and unmounts back to the preview once it's
  // far from view AND unfocused. Three-state lifecycle: PREVIEW ⇄ MOUNTED.
  //
  // CRITICAL — the store is the single source of truth: every keystroke flows onChange →
  // onPlainInput → store, synchronously, so by the time a block could unmount its latest text is
  // already in the store. Serialize reads the store, never the DOM, so unmount NEVER loses data and
  // the anti-clobber save contract is untouched. Mounting:
  //   • onChange(md) → onPlainInput(id, md) — the EXISTING granular store + scheduleSave path.
  //   • setMarkdown is driven by a createRenderEffect tracking the block's `text`, bridge-GUARDED
  //     (only replaces the doc when serialized markdown differs — keystroke echoes are no-ops and
  //     the caret never jumps).
  //   • Enter/Backspace-at-start/Arrow-out route to the store's split/merge/focus ops.
  //   • focusById is registered SYNCHRONOUSLY (independent of mount state) to a closure that
  //     force-mounts an unmounted block, then places the caret once the async handle is ready — so
  //     queueFocus/focusSibling/split/merge to an offscreen block mounts-then-places-caret.
  function RichTextBlock(p: { block: Block }) {
    let root!: HTMLDivElement;
    let disposed = false;
    const id = p.block.id;
    // The async-created handle, tracked reactively so the sync effect below attaches once ready.
    const [handle, setHandle] = createSignal<BlockEditorHandle | null>(null);
    // `near` = the observer says this block is in/near the viewport. `forceMount` = focus/navigation
    // pinned it mounted regardless of viewport (so a caret target is always live). A block mounts
    // when EITHER is true; it unmounts only when BOTH are false.
    const [near, setNear] = createSignal(false);
    const [forceMount, setForceMount] = createSignal(false);
    const shouldMount = createMemo(() => near() || forceMount());
    // The caret to apply once the surface finishes its async mount (set when focus is requested on
    // an unmounted block). Consumed by the create()-resolution step below.
    let pendingCaret: CaretHint | undefined;
    let pendingFocus = false;

    /** Begin an async Milkdown create() for this root if not already mounting/mounted. Idempotent:
     *  a second call while a create is in flight is a no-op (mounting flag). */
    let mounting = false;
    const startMount = (): void => {
      if (mounting || handle() || disposed) return;
      mounting = true;
      // Clear the static-preview HTML so Milkdown mounts into an empty node (ProseMirror appends
      // its editable rather than replacing children — a leftover preview would double-render).
      root.innerHTML = "";
      void loadMilkdown().then(({ createBlockEditor }) => {
        if (disposed) {
          mounting = false;
          return;
        }
        return createBlockEditor({
          root,
          value: p.block.text ?? "",
          spellcheck: settings.editor.spellcheck,
          onChange: (md) => onPlainInput(id, md),
          onEnter: (caret) => splitBlock(id, caret),
          onBackspaceAtStart: () => mergeIntoPrevious(id),
          onArrowOut: (dir) => focusSibling(id, dir),
          onSlash: (query, rect) => {
            // Only the rich-text types that host a paragraph-like body trigger the block menu.
            if (p.block.type !== "paragraph" && p.block.type !== "bulletItem" && p.block.type !== "orderedItem") return;
            const open = slash();
            setSlash({ blockId: id, query, x: rect.left, y: rect.bottom + 4 });
            if (!open || open.blockId !== id) slashNav.setActive(0); // reset only on (re)open
          },
          onSlashDismiss: () => {
            if (slash() && slash()!.blockId === id) setSlash(null);
          },
          slashOpen: () => slash()?.blockId === id,
          onSlashKey: (e) => {
            // Consume Arrow/Enter/Escape for the open menu; let any other key fall through.
            if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") {
              slashNav.onKeyDown(e);
              return true;
            }
            return false;
          },
          onAutocomplete: (kind, query, from, rect) => {
            const open = auto();
            const h = handle();
            if (!h) return;
            setAuto({ blockId: id, handle: h, kind, query, from, x: rect.left, y: rect.bottom + 4 });
            if (!open || open.blockId !== id) autoNav.setActive(0); // reset only on (re)open
          },
          onAutocompleteDismiss: () => {
            if (auto() && auto()!.blockId === id) setAuto(null);
          },
          autocompleteOpen: () => auto()?.blockId === id,
          onAutocompleteKey: (e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") {
              autoNav.onKeyDown(e);
              return true;
            }
            return false;
          },
          onSelectionChange: (rect) => {
            const h = handle();
            if (!rect || !h) {
              if (format()) setFormat(null);
              return;
            }
            setFormat({
              x: rect.left + rect.width / 2,
              y: rect.top - 8,
              handle: h,
              onBlockKind: (k) => changeBlockKind(id, k),
            });
          },
        }).then((h) => {
          mounting = false;
          if (disposed) {
            h.destroy();
            return;
          }
          setHandle(h); // arms the sync effect below
          // A focus requested while we were mounting now lands on the live surface. Release the
          // forceMount pin: a focused block stays mounted via the unmount guard's activeElement
          // check, so a later scroll-away + blur is free to unmount it normally.
          if (pendingFocus) {
            pendingFocus = false;
            const caret = pendingCaret;
            pendingCaret = undefined;
            h.focus(caret);
          }
          if (forceMount()) setForceMount(false);
        });
      });
    };

    /** Tear the live Milkdown surface down, dropping back to the static preview. The store already
     *  holds the latest text, so this is data-safe; popovers anchored here are cleared so a stale
     *  handle can't be used. */
    const unmount = (): void => {
      const h = handle();
      if (!h) return;
      if (auto()?.blockId === id) setAuto(null);
      if (slash()?.blockId === id) setSlash(null);
      if (format()?.handle === h) setFormat(null);
      h.destroy(); // editor.destroy() tears down the ProseMirror view + DOM
      setHandle(null); // → preview effect repaints the static body into the now-empty root
      root.innerHTML = ""; // belt-and-braces: drop any residual ProseMirror DOM before the repaint
    };

    // The single per-block focus closure, registered SYNCHRONOUSLY (independent of mount state) so
    // queueFocus always finds it. If the surface is live, focus it directly; if not, pin it mounted
    // (forceMount) and remember the caret so the create()-resolution step applies it on ready.
    focusById.set(id, (caret) => {
      const h = handle();
      if (h) {
        h.focus(caret);
        return;
      }
      pendingFocus = true;
      pendingCaret = caret;
      setForceMount(true); // triggers the mount effect; the resolution step applies pendingCaret
    });

    // Tracks whether focus is within this block's DOM. The unmount guard refuses to tear down a
    // focused surface; without re-running the effect on BLUR, a block focused then scrolled offscreen
    // would stay mounted until the next scroll. focusin/focusout (which bubble from the ProseMirror
    // editable) toggle this so the effect re-evaluates the moment focus leaves.
    const [focused, setFocused] = createSignal(false);

    // Observe viewport proximity once the root is in the DOM; mount/unmount follow `shouldMount`.
    onMount(() => {
      const stop = observeBlock(root, (n) => setNear(n));
      const onIn = () => setFocused(true);
      const onOut = () => setFocused(false);
      root.addEventListener("focusin", onIn);
      root.addEventListener("focusout", onOut);
      onCleanup(() => {
        stop();
        root.removeEventListener("focusin", onIn);
        root.removeEventListener("focusout", onOut);
      });
    });

    // Mount/unmount in step with `shouldMount`. Mounting is async (create()); unmount is sync. Tracks
    // `focused` so a blur re-runs this and an offscreen-but-just-blurred block unmounts promptly.
    createEffect(() => {
      focused();
      if (shouldMount()) startMount();
      else if (handle() && !root.contains(document.activeElement)) unmount();
    });

    // Sync external/programmatic content changes into the LIVE surface (bridge-guarded for caret
    // stability + anti-feedback). Tracks the reactive handle (null while unmounted/mounting) + the
    // block's `text`, so a split/merge/slash-transform/external-reload re-runs it once mounted. A
    // keystroke echo is a no-op. While unmounted the preview reads `text` directly (below), so the
    // store stays the single source of truth either way.
    createRenderEffect(() => {
      const h = handle();
      const v = p.block.text ?? "";
      if (h) h.setMarkdown(v);
    });

    // The static, read-only preview shown while unmounted — the SAME renderNoteBody the rest of the
    // app uses for note bodies, so an offscreen block reads identically to its mounted form. Painted
    // into `root` (reactively) only when there's no live handle; mounting clears it (Milkdown owns
    // the node then). Reserving the preview's rendered height avoids a scroll jump on mount.
    // createEffect (not createRenderEffect): the render-effect variant runs synchronously at
    // creation — BEFORE the `ref` below assigns `root` — so it would throw on `root.innerHTML`.
    // The first paint happens in the ref callback; this only handles REACTIVE repaints (an
    // offscreen block's text changing via split/external-reload, or handle→null on unmount).
    createEffect(() => {
      const h = handle();
      const text = p.block.text ?? "";
      if (h || !root) return; // live surface owns the DOM; or root not yet assigned
      // eslint-disable-next-line solid/no-innerhtml -- sanitized by renderNoteBody (DOMPurify)
      root.innerHTML = text ? renderNoteBody(text) : "";
    });

    onCleanup(() => {
      disposed = true;
      if (focusById.get(id)) focusById.delete(id);
      if (auto()?.blockId === id) setAuto(null);
      if (slash()?.blockId === id) setSlash(null);
      // Drop a format toolbar still pointing at THIS block's (about-to-be-destroyed) handle, so a
      // stale FormatBarState.handle can't route exec()/coords to a torn-down ProseMirror view.
      // FormatBarState carries no block id, so compare the handle identity directly.
      if (format()?.handle === handle()) setFormat(null);
      handle()?.destroy();
      setHandle(null);
    });

    const cls = (): string => {
      let c = "block-rich";
      if (p.block.type === "heading") c += ` block-rich--h${Math.min(6, Math.max(1, p.block.level ?? 1))}`;
      else c += ` block-rich--${p.block.type}`;
      if (!handle()) c += " block-rich--preview"; // read-only static preview state
      return c;
    };
    return (
      <div
        ref={(el) => {
          root = el;
          // Paint the static preview synchronously on assignment — the reactive createEffect runs
          // before this ref is set (so `root` is undefined there on first run). A live mount clears
          // this node (startMount sets root.innerHTML = "").
          // eslint-disable-next-line solid/no-innerhtml -- sanitized by renderNoteBody (DOMPurify)
          if (!handle()) el.innerHTML = p.block.text ? renderNoteBody(p.block.text) : "";
        }}
        class={cls()}
        data-placeholder={richPlaceholder(p.block)}
        onMouseDown={(e) => {
          // Clicking a still-static preview (e.g. mid-async-mount) must mount then focus so the
          // caret lands rather than being swallowed by the read-only DOM. A live surface handles
          // its own pointer events, so this only fires while unmounted.
          if (handle()) return;
          e.preventDefault();
          queueFocus(id);
        }}
      />
    );
  }

  // A `code` block: an autosizing monospace textarea (raw is the point — no WYSIWYG). Keeps the
  // exact textarea behaviour the prior TextBlock had: granular onPlainInput, structural keys,
  // blur-reconcile, and the caret-safe controlled value-sync.
  function CodeBlock(p: { block: Block }) {
    let ta: HTMLTextAreaElement | undefined;
    onMount(() => {
      if (ta) autoGrow(ta);
    });
    onCleanup(() => {
      if (focusById.get(p.block.id)) focusById.delete(p.block.id);
    });
    return (
      <textarea
        ref={(el) => {
          ta = el;
          focusById.set(p.block.id, (caret) => {
            el.focus();
            const pos = typeof caret === "number" ? caret : caret === "start" ? 0 : el.value.length;
            try {
              el.setSelectionRange(pos, pos);
            } catch {
              /* setSelectionRange not applicable */
            }
            autoGrow(el);
          });
          createRenderEffect(() => {
            const v = p.block.text ?? "";
            if (el.value !== v) {
              el.value = v;
              autoGrow(el);
            }
          });
        }}
        class="block-text block-text--code"
        rows={1}
        placeholder="Code"
        spellcheck={false}
        onInput={(e) => onTextInput(p.block, e.currentTarget)}
        onKeyDown={(e) => onTextKeyDown(p.block, e, e.currentTarget)}
        onBlur={() => onTextBlur(p.block.id)}
      />
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

  // A live ```query block: render its body as a BaseView (same flat-vs-config branch as the
  // CodeMirror editor's queryBlock.ts widget), with a pencil overlay that re-opens the visual
  // builder seeded from the parsed body. BaseView is a Solid component and we're inside a Solid
  // component tree, so it mounts directly as JSX (no mountSolid bridge needed here).
  function QueryBlockBlock(p: { block: Block }) {
    const body = createMemo(() => p.block.text ?? "");
    return (
      <div class="block-query">
        {/* The no-code builder can only EDIT a query it can losslessly round-trip; for a richer
            hand-authored config (formulas/filters tree/extra views/tasks-base config form) the Pencil
            is hidden so opening + Save can't clobber it — edit those as source instead. */}
        <Show when={isBuilderRepresentable(body())}>
          <div class="block-query-edit">
            <IconButton
              icon="Pencil"
              size="sm"
              label="Edit query"
              onClick={() => setBuilder({ blockId: p.block.id, initial: parseQueryBlockBody(body()) })}
            />
          </div>
        </Show>
        <Show
          when={looksLikeBaseConfig(body())}
          fallback={<BaseView view={parseQueryBlock(body())} hostPath={props.path ?? undefined} />}
        >
          <BaseView source={body()} hostPath={props.path ?? undefined} />
        </Show>
      </div>
    );
  }
}

/** Cheap relevance score for autocomplete ranking: 0 exact, 1 prefix, 2 substring, -1 no match.
 *  Empty query matches everything at the lowest tier (declared/alpha order then applies). */
function matchScore(hay: string, query: string): number {
  if (!query) return 2;
  if (hay === query) return 0;
  if (hay.startsWith(query)) return 1;
  return hay.includes(query) ? 2 : -1;
}

/** Flatten one parsed frontmatter value into the chip strings the properties strip renders. An
 *  array becomes one chip per item (so `tags: [a, b]` shows two chips); a scalar is a single chip;
 *  an object/null is shown as its compact JSON / a dash. Display-only — never re-serialized into
 *  the note (the verbatim frontmatter prefix is the source of truth). */
function propValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => scalarText(v)).filter((s) => s.length > 0);
  const s = scalarText(value);
  return s.length > 0 ? [s] : [];
}

/** A single frontmatter scalar rendered as display text. */
function scalarText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** The placeholder shown in an EMPTY rich-text block (a CSS ::before reads data-placeholder). */
function richPlaceholder(block: Block): string {
  switch (block.type) {
    case "heading":
      return `Heading ${block.level ?? 1}`;
    case "task":
      return "To-do";
    case "bulletItem":
    case "orderedItem":
      return "List item";
    case "quote":
      return "Quote";
    default:
      return "Type '/' for blocks…";
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
