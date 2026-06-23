// app/src/blocks/milkdownEditor.ts
// The Milkdown bridge — the ONLY module (besides inlineNodes.ts) that imports `@milkdown/*`.
// Code-split behind a dynamic import() from BlockEditor.tsx (the sheet/univerSheet.ts pattern)
// so ProseMirror/Milkdown stays out of app boot.
//
// One factory `createBlockEditor` mounts a TRUE-WYSIWYG rich-text surface for ONE text-editable
// block: it seeds from the block's inline markdown (`block.text`), renders bold/italic/code/
// links/wikilinks/tags/math/embeds with NO markdown symbols shown, and serializes back to
// canonical markdown via getMarkdown().
//
// ARCHITECTURE — per-block, inline content only:
//   The block model owns block STRUCTURE (the `#`, `- `, `> `, `- [ ]` prefixes live in
//   blockModel's render). A surface holds only the block's INNER content, so Milkdown serializes
//   inline markdown (`**bold** [[wikilink]] #tag`) — never a list/heading/task wrapper. This
//   sidesteps GFM-task + loose-list serialization drift entirely (verified in
//   milkdownSerialize.test.ts) and keeps the block store the single source of truth.
//
// STRUCTURAL OPS stay in the block store: a ProseMirror keymap maps Enter / Backspace-at-start /
// ArrowUp-at-first-line / ArrowDown-at-last-line to the on* callbacks so split/merge/focus-move
// remain the store's responsibility. Mod+B/I/E/K toggle the commonmark inline marks.
//
// ANTI-CLOBBER: onChange routes the serialized markdown to the caller (→ onPlainInput → granular
// store update → scheduleSave). setMarkdown is guarded by a value-equality check + an
// `applyingExternal` flag so an external/programmatic content set NEVER fires a spurious onChange
// (the feedback loop) and NEVER resets the caret while the user types (the el.value!==v guard's
// ProseMirror equivalent — we only replace the doc when the serialized markdown actually
// differs).

import { Editor, rootCtx, defaultValueCtx, editorViewCtx, parserCtx, serializerCtx, commandsCtx, remarkStringifyOptionsCtx, prosePluginsCtx, editorViewOptionsCtx } from "@milkdown/core";
import { commonmark, toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand, toggleLinkCommand } from "@milkdown/preset-commonmark";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import { keymap } from "@milkdown/prose/keymap";
import type { EditorView } from "@milkdown/prose/view";
import type { Command } from "@milkdown/prose/state";
import { inlineAtoms } from "./inlineNodes";
import { matchWikilinkPrefix } from "../editor/wikilink";
import { matchTagPrefix } from "../editor/tag";

/** Where the caret should land after a programmatic focus. */
export type CaretHint = "start" | "end" | number;

export interface BlockEditorCallbacks {
  /** Fired after every USER edit with the block's serialized inline markdown (never on a
   *  programmatic setMarkdown). Route to the store's onPlainInput. */
  onChange: (markdown: string) => void;
  /** Plain Enter (no shift): split the block at the caret. `caret` is the offset into the
   *  serialized markdown so the store can carry the tail into a new block. */
  onEnter: (caret: number) => void;
  /** Backspace at the very start of the block: merge into the previous block. */
  onBackspaceAtStart: () => void;
  /** Arrow up at the first line / down at the last line: move focus to the sibling block. */
  onArrowOut: (dir: -1 | 1) => void;
  /** A `/` typed as the only content of the block (slash menu trigger). `query` is the text
   *  after the `/`; `rect` is the caret's screen rect so the caller positions the menu. Fired on
   *  every keystroke while the block holds a lone `/query`. */
  onSlash?: (query: string, rect: DOMRect) => void;
  /** The block no longer holds a lone `/query` (content changed away from the trigger) — the
   *  caller should close any open slash menu for this block. */
  onSlashDismiss?: () => void;
  /** Whether the caller's slash menu is currently open for THIS block. While true, the surface's
   *  keymap routes ArrowUp/ArrowDown/Enter/Escape to `onSlashKey` instead of split/focus, so the
   *  menu owns navigation. */
  slashOpen?: () => boolean;
  /** Route a navigation key to the open slash menu. Returns true if the menu consumed it. */
  onSlashKey?: (e: KeyboardEvent) => boolean;

  /** Fired while the caret sits inside an OPEN `[[…` wikilink or a `#tag` token (no closing
   *  bracket / terminating char yet). `kind` says which source to feed; `query` is the text
   *  typed so far; `from` is the markdown offset where the QUERY starts (so applyAutocomplete
   *  can replace `[query → label]`); `rect` is the caret rect for popover placement. Mirrors the
   *  CodeMirror wikilink/tag autocomplete trigger (matchWikilinkPrefix / matchTagPrefix). */
  onAutocomplete?: (kind: "wikilink" | "tag", query: string, from: number, rect: DOMRect) => void;
  /** The caret left any wikilink/tag trigger — the caller should close the autocomplete popover. */
  onAutocompleteDismiss?: () => void;
  /** Whether the caller's autocomplete popover is open for THIS block. While true the keymap
   *  routes ArrowUp/Down/Enter/Escape to `onAutocompleteKey` (the menu owns navigation). */
  autocompleteOpen?: () => boolean;
  /** Route a navigation key to the open autocomplete menu. Returns true if it consumed the key. */
  onAutocompleteKey?: (e: KeyboardEvent) => boolean;

  /** Fired whenever the selection changes. `rect` is the selection's bounding rect when it's a
   *  NON-empty range (so the host can float a format toolbar above it), or null when the caret is
   *  collapsed / the surface lost selection — the host hides the toolbar then. */
  onSelectionChange?: (rect: DOMRect | null) => void;
}

export interface BlockEditorHandle {
  /** Replace the surface's content from external markdown (SSE reload / split-merge result).
   *  No-op (no onChange, no caret reset) when the serialized doc already equals `md`. */
  setMarkdown: (md: string) => void;
  /** Current serialized inline markdown (no trailing newline). */
  getMarkdown: () => string;
  /** Focus the surface, optionally placing the caret. */
  focus: (caret?: CaretHint) => void;
  /** Run a named inline-mark toggle (the toolbar / keybinding hook). */
  exec: (command: "bold" | "italic" | "code" | "link") => void;
  /** Replace the inline text from markdown offset `from` to the caret with `text`, then place the
   *  caret `caretAfter` chars into the inserted text (default: end). Re-parses `text` as inline
   *  markdown so a chosen `[[Note]]`/`#tag` lands as a live atom chip, not literal characters.
   *  Used by the host's wikilink/tag autocomplete to commit a chosen candidate. Fires onChange. */
  applyAutocomplete: (from: number, text: string, caretAfter?: number) => void;
  /** Whether the caret is at doc start (offset 0) — used by the host to disambiguate keys. */
  destroy: () => void;
}

export interface CreateBlockEditorOptions extends BlockEditorCallbacks {
  /** The mount node (a stable per-block div). */
  root: HTMLElement;
  /** The block's initial inline markdown. */
  value: string;
  /** Whether the user can type (always true for our text blocks; here for completeness). */
  editable?: boolean;
  /** Spellcheck toggle (settings.editor.spellcheck). */
  spellcheck?: boolean;
}

// A minimal `text`-node handler that writes plain text VERBATIM instead of letting
// mdast-util-to-markdown apply its (very conservative) punctuation escaping. The default
// serializer escapes `_`/`[`/`*`/`&` etc. defensively (`snake_case` → `snake\_case`,
// `array[0]` → `array\[0]`, a literal `*` → `\*`, `R&D` → `R\&D`) — which is technically
// valid markdown but DIVERGES byte-for-byte from what the block model + CodeMirror Editor
// keep (both store inline text verbatim). That divergence would rewrite the .md on the first
// visual edit and ping-pong the two surfaces. Since this surface serializes INLINE content
// only and every Obsidian-flavoured construct that needs protection (`[[wikilink]]`, `#tag`,
// `$math$`, `![[embed]]`, bare URLs) is already pulled OUT into verbatim `html` atom nodes
// (inlineNodes.ts), a residual `text` node is genuinely literal prose — emitting it raw
// round-trips exactly. The marks (`**bold**`, `*italic*`, `` `code` ``, `[a](b)`) are emitted
// by their OWN handlers, not this one, so disabling text-escaping never touches them.
//
// ACCEPTED NORMALIZATION (documented, same class as `_`→`*` / `__`→`**`): a source backslash
// escape inside prose (`snake\_case`, a literal `\*`) is dropped on round-trip because the
// parser already consumed the backslash before we ever see the text node — the bare char is
// what re-parses, and a lone unpaired `*`/`_`/`[`/`&`/`]`/`(`/`)` in inline text re-parses as
// itself (no construct), so verbatim output is idempotent. HTML entities (`&amp;`) likewise
// decode to their character at parse time and can't be recovered (a doc-model limitation).
const verbatimText: (node: { value?: string }) => string = (node) => node.value ?? "";

// Canonical remark-stringify options so the visual surface writes the SAME bytes the block model
// + CodeMirror Editor write — `-` bullets, `*` emphasis/strong, fenced code, `-` rules, verbatim
// text (no over-escaping), and `<url>` autolinks kept as autolinks. Verified against the
// project's canonical output by milkdownSerialize.test.ts. (Lists/headings/tasks are never
// serialized here — only inline content — so list-tightness options are moot.)
const STRINGIFY_OPTIONS = {
  bullet: "-",
  emphasis: "*",
  strong: "*",
  fence: "`",
  fences: true,
  listItemIndent: "one",
  rule: "-",
  ruleRepetition: 3,
  ruleSpaces: false,
  incrementListMarker: true,
  // FALSE so an explicit `<https://x>` autolink round-trips as `<https://x>` (the autolink form)
  // rather than being rewritten to `[https://x](https://x)`. A real `[text](url)` link still
  // serializes as a resource link because its text differs from its url (formatLinkAsAutolink
  // only collapses to `<url>` when the link's sole text child equals its url + has no title).
  resourceLink: false,
  // Override the `text` node handler with the verbatim emitter above (see its comment).
  handlers: { text: verbatimText },
} as const;

const onChangeKey = new PluginKey("oa-block-onchange");

/**
 * Create a Milkdown WYSIWYG surface bound to one block. Async because Editor.create() is async;
 * BlockEditor.tsx awaits it inside onMount and stores the handle.
 */
export async function createBlockEditor(opts: CreateBlockEditorOptions): Promise<BlockEditorHandle> {
  // True while a programmatic doc replace is in flight, so the onChange plugin suppresses the
  // resulting transaction (it isn't a user edit). The serialize-equality check is the primary
  // guard; this flag covers the brief multi-transaction window of a replace.
  let applyingExternal = false;
  // The last markdown we emitted/seeded, so onChange can dedupe (a transaction that doesn't
  // change the serialized output — e.g. a selection move — must not call onChange).
  let lastEmitted = opts.value;

  let view: EditorView | null = null;

  const serialize = (): string => {
    if (!view) return lastEmitted;
    const md = editor.action((ctx) => ctx.get(serializerCtx)(view!.state.doc));
    // The serializer always appends a trailing "\n"; block `text` is single-line-ish inline
    // content, so strip exactly one trailing newline to match what the store stores.
    return md.endsWith("\n") ? md.slice(0, -1) : md;
  };

  /** The caret offset measured in the SAME markdown the store stores — the index `splitBlock`
   *  slices `block.text` at. We CANNOT use a raw ProseMirror position: an inline atom counts as
   *  1 PM unit but many markdown chars, and a `**`/`*`/`` ` `` mark adds markdown chars that
   *  aren't in the doc's text content at all. So we serialize the doc CUT to the content before
   *  the caret (`doc.cut(0, head)`) and take its length — the exact markdown prefix, marks +
   *  atoms included. Clamped to a collapsed caret; a non-empty selection uses its head. */
  const markdownCaretOffset = (v: EditorView): number => {
    const head = v.state.selection.head;
    // Caret at (or before) the textblock's content start → offset 0. Guarded explicitly because
    // `doc.cut(0, start)` is an EMPTY paragraph, which the serializer renders as a `<br />`
    // placeholder (non-zero length) rather than "".
    const start = v.state.doc.resolve(head).start();
    if (head <= start) return 0;
    const before = editor.action((ctx) => ctx.get(serializerCtx)(v.state.doc.cut(0, head)));
    // The serializer appends a trailing "\n" for the (single) block; strip it so the length is
    // the inline-text prefix only (matching `serialize()`'s single-newline strip).
    const prefix = before.endsWith("\n") ? before.slice(0, -1) : before;
    return prefix.length;
  };

  // (A) onChange plugin: after any doc-changing transaction that ISN'T a programmatic replace,
  // serialize and notify — but only when the serialized markdown actually changed (so caret
  // moves / mark-only no-ops don't churn the store + save). Also detects the lone-`/` slash
  // trigger and fires onSlash / onSlashDismiss.
  const onChangePlugin = new Plugin({
    key: onChangeKey,
    view: () => ({
      update: (v, prevState) => {
        if (applyingExternal) return;
        const docChanged = !v.state.doc.eq(prevState.doc);
        const selChanged = !v.state.selection.eq(prevState.selection);
        // Selection-only moves still update the format toolbar; doc changes also re-run the
        // slash / autocomplete detectors + emit onChange.
        if (selChanged || docChanged) reportSelection(v);
        if (!docChanged) return; // no structural/content change → nothing else to do
        const md = serialize();
        if (md !== lastEmitted) {
          lastEmitted = md;
          opts.onChange(md);
        }
        detectSlash(v);
        detectAutocomplete(v);
      },
    }),
  });

  /** Report the current selection's rect (non-empty range) or null (collapsed) to the host so it
   *  can float / hide the format toolbar. */
  function reportSelection(v: EditorView): void {
    if (!opts.onSelectionChange) return;
    const sel = v.state.selection;
    if (sel.empty || !v.hasFocus()) {
      opts.onSelectionChange(null);
      return;
    }
    try {
      const a = v.coordsAtPos(sel.from);
      const b = v.coordsAtPos(sel.to);
      const left = Math.min(a.left, b.left);
      const right = Math.max(a.right ?? a.left, b.right ?? b.left);
      const top = Math.min(a.top, b.top);
      opts.onSelectionChange(new DOMRect(left, top, right - left, 0));
    } catch {
      opts.onSelectionChange(v.dom.getBoundingClientRect());
    }
  }

  /** Fire onSlash when the block's whole content is a lone `/query` (the only content, no marks
   *  or atoms), else onSlashDismiss. Mirrors the textarea matchSlashPrefix behaviour. */
  function detectSlash(v: EditorView): void {
    if (!opts.onSlash) return;
    const text = v.state.doc.textContent;
    const m = /^\/(\S*)$/.exec(text);
    if (m && v.state.doc.childCount === 1) {
      const head = v.state.selection.head;
      let rect: DOMRect;
      try {
        const c = v.coordsAtPos(head);
        rect = new DOMRect(c.left, c.top, 0, c.bottom - c.top);
      } catch {
        rect = v.dom.getBoundingClientRect();
      }
      opts.onSlash(m[1], rect);
    } else {
      opts.onSlashDismiss?.();
    }
  }

  /** The text of the current textblock UP TO the caret (collapsed selection only). Atoms count as
   *  their raw source so an offset matches the serialized markdown the store stores. Returns null
   *  when the selection isn't an empty caret in a single textblock. */
  function textBeforeCaret(v: EditorView): string | null {
    const sel = v.state.selection;
    if (!sel.empty) return null;
    if (!v.state.doc.resolve(sel.head).parent.isTextblock) return null;
    return textUpToCaret(v);
  }

  /** Fire onAutocomplete when the caret sits inside an open `[[…` or a `#tag`, else dismiss.
   *  Reuses the SAME matchers as the CodeMirror editor (matchWikilinkPrefix / matchTagPrefix) so
   *  the trigger rules are identical across the two surfaces. `from` is the markdown offset where
   *  the QUERY starts (not the `[[`/`#`), so applyAutocomplete replaces only the typed query. */
  function detectAutocomplete(v: EditorView): void {
    if (!opts.onAutocomplete) return;
    const text = textBeforeCaret(v);
    if (text === null) {
      opts.onAutocompleteDismiss?.();
      return;
    }
    const wl = matchWikilinkPrefix(text);
    if (wl) {
      opts.onAutocomplete("wikilink", wl.query, wl.from, caretRect(v));
      return;
    }
    const tg = matchTagPrefix(text);
    if (tg) {
      opts.onAutocomplete("tag", tg.query, tg.from, caretRect(v));
      return;
    }
    opts.onAutocompleteDismiss?.();
  }

  function caretRect(v: EditorView): DOMRect {
    try {
      const c = v.coordsAtPos(v.state.selection.head);
      return new DOMRect(c.left, c.top, 0, c.bottom - c.top);
    } catch {
      return v.dom.getBoundingClientRect();
    }
  }

  // (B) Structural keymap: hand Enter / Backspace-at-start / Arrow-out / slash to the store.
  // HIGH priority (injected first) so it wins over commonmark's list/hardbreak handlers — there
  // are no lists here (inline-only), so Enter is always a block split.
  // Route a key to the open slash menu (if any). Returns true when the menu consumed it, so the
  // keymap stops before the structural handler runs. Synthesises a KeyboardEvent the caller's nav
  // helper recognises (it reads e.key / preventDefault).
  function slashConsumed(key: string): boolean {
    if (!opts.slashOpen?.() || !opts.onSlashKey) return false;
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    return opts.onSlashKey(e);
  }

  /** Route a key to the open wikilink/tag autocomplete menu (if any). Returns true when consumed,
   *  so the keymap stops before the structural handler. Mirrors slashConsumed. */
  function autocompleteConsumed(key: string): boolean {
    if (!opts.autocompleteOpen?.() || !opts.onAutocompleteKey) return false;
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    return opts.onAutocompleteKey(e);
  }

  const structuralKeymap = keymap({
    Enter: blockCmd((v) => {
      if (autocompleteConsumed("Enter")) return true; // wikilink/tag menu picks the candidate
      if (slashConsumed("Enter")) return true; // slash menu picks the active item
      const caret = markdownCaretOffset(v);
      opts.onEnter(caret);
      return true;
    }),
    "Shift-Enter": blockCmd(() => {
      // Shift+Enter = a hard line break WITHIN the block (a literal newline in the inline text).
      // Let commonmark's hardbreak handle it; returning false falls through.
      return false;
    }),
    Backspace: blockCmd((v) => {
      // Only intercept at the very start of an empty selection; else let commonmark delete.
      const { empty, from } = v.state.selection;
      if (empty && from === 1) {
        opts.onBackspaceAtStart();
        return true;
      }
      return false;
    }),
    ArrowUp: blockCmd((v) => {
      if (autocompleteConsumed("ArrowUp")) return true;
      if (slashConsumed("ArrowUp")) return true;
      if (atFirstLine(v)) {
        opts.onArrowOut(-1);
        return true;
      }
      return false;
    }),
    ArrowDown: blockCmd((v) => {
      if (autocompleteConsumed("ArrowDown")) return true;
      if (slashConsumed("ArrowDown")) return true;
      if (atLastLine(v)) {
        opts.onArrowOut(1);
        return true;
      }
      return false;
    }),
    Escape: blockCmd(() => autocompleteConsumed("Escape") || slashConsumed("Escape")),
    "Mod-b": runCommand(toggleStrongCommand.key),
    "Mod-i": runCommand(toggleEmphasisCommand.key),
    "Mod-e": runCommand(toggleInlineCodeCommand.key),
    "Mod-k": runCommand(toggleLinkCommand.key),
  });

  function blockCmd(fn: (v: EditorView) => boolean): Command {
    return (_state, _dispatch, viewArg) => (viewArg ? fn(viewArg) : false);
  }

  function runCommand(key: unknown): Command {
    return () => {
      editor.action((ctx) => ctx.get(commandsCtx).call(key as never));
      return true;
    };
  }

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, opts.root);
      ctx.set(defaultValueCtx, opts.value);
      ctx.set(remarkStringifyOptionsCtx, STRINGIFY_OPTIONS as unknown as Record<string, unknown>);
      // Inject our prose plugins (structural keymap first = highest priority, then onChange).
      ctx.update(prosePluginsCtx, (prev) => [structuralKeymap, onChangePlugin, ...prev]);
      // Single-line-ish surface: no outer scroll, spellcheck per setting, editable flag.
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        editable: () => opts.editable !== false,
        attributes: {
          class: "oa-block-milkdown",
          spellcheck: opts.spellcheck ? "true" : "false",
        },
      }));
    })
    .use(commonmark)
    .use(inlineAtoms)
    .create();

  view = editor.ctx.get(editorViewCtx);

  return {
    getMarkdown: serialize,

    setMarkdown: (md: string) => {
      if (!view) return;
      // CARET STABILITY + FEEDBACK-LOOP GUARD: only touch the doc when the serialized content
      // actually differs from `md`. While the user types, the store's value === our last emit,
      // so this is a no-op and the caret never jumps; a real external change replaces the doc.
      if (serialize() === md) {
        lastEmitted = md;
        return;
      }
      applyingExternal = true;
      try {
        editor.action((ctx) => {
          const v = ctx.get(editorViewCtx);
          const parser = ctx.get(parserCtx);
          const doc = parser(md);
          if (!doc) return;
          const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, doc.content);
          tr.setMeta("addToHistory", false); // an external reload isn't a user undo step
          v.dispatch(tr);
        });
        lastEmitted = md;
      } finally {
        applyingExternal = false;
      }
    },

    focus: (caret?: CaretHint) => {
      if (!view) return;
      const v = view;
      v.focus();
      const size = v.state.doc.content.size;
      let pos = size; // default: end
      if (caret === "start") pos = 0;
      else if (caret === "end") pos = size;
      else if (typeof caret === "number") pos = mdOffsetToDocPos(v, caret);
      placeCaret(v, pos);
    },

    exec: (command) => {
      const key =
        command === "bold" ? toggleStrongCommand.key
        : command === "italic" ? toggleEmphasisCommand.key
        : command === "code" ? toggleInlineCodeCommand.key
        : toggleLinkCommand.key;
      editor.action((ctx) => ctx.get(commandsCtx).call(key as never));
      view?.focus();
    },

    applyAutocomplete: (from, text, caretAfter) => {
      if (!view) return;
      const v = view;
      const toPos = v.state.selection.head; // the caret (end of the typed query)
      // `from` is a TEXT offset within the caret's textblock; the typed `[[query`/`#query` right
      // before the caret is plain text (no atoms), so the query length in TEXT chars equals its
      // length in DOC positions. Anchor backwards from the caret by that span — robust regardless
      // of any atoms earlier in the block.
      const caretTextOffset = caretOffsetText(v);
      const fromPos = toPos - (caretTextOffset - from);
      // Parse `text` as inline markdown so a chosen `[[Note]]`/`#tag` becomes a live atom node,
      // then splice ONLY its inline content into [fromPos, toPos] — leaving the rest of the block
      // (and surrounding marks) intact. This is a user edit, so onChange fires normally.
      editor.action((ctx) => {
        const parser = ctx.get(parserCtx);
        const doc = parser(text);
        if (!doc) return;
        // The parsed doc is a single paragraph; take its inline children as the replacement slice.
        const inline = doc.firstChild ? doc.firstChild.content : doc.content;
        const tr = v.state.tr.replaceWith(fromPos, toPos, inline);
        const caretPos = fromPos + (typeof caretAfter === "number" ? caretAfter : inline.size);
        try {
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(caretPos, tr.doc.content.size))));
        } catch {
          /* selection clamp */
        }
        v.dispatch(tr);
      });
      v.focus();
    },

    destroy: () => {
      view = null;
      void editor.destroy();
    },
  };
}

// ---------------------------------------------------------------------------------------
// Caret / position helpers (ProseMirror equivalents of textarea selection math)
// ---------------------------------------------------------------------------------------

/** The textblock's content from its start UP TO the caret, with custom inline atoms counted as
 *  their raw source (so a `[[Note]]` chip contributes its full `[[Note]]` length). This is the
 *  unit the wikilink/tag matchers + applyAutocomplete's offset arithmetic share. */
function textUpToCaret(v: EditorView): string {
  const head = v.state.selection.head;
  const start = v.state.doc.resolve(head).start();
  let text = "";
  v.state.doc.nodesBetween(start, head, (node, pos) => {
    if (node.isText) {
      text += (node.text ?? "").slice(Math.max(0, start - pos));
    } else if (node.isAtom && node.type.name.startsWith("oa")) {
      text += (node.attrs.raw as string) ?? "";
    }
  });
  return text;
}

/** The caret's offset in the same TEXT units as textUpToCaret, so it lines up with `from`. */
function caretOffsetText(v: EditorView): number {
  return textUpToCaret(v).length;
}

/** Map a markdown/text offset back to a ProseMirror doc position within the (single) textblock —
 *  the INVERSE of `textUpToCaret().length`. A naive `start + offset` is wrong whenever the block
 *  holds an inline ATOM (`[[wikilink]]`/`#tag`/`$math$`/embed/url): the atom spans many markdown
 *  chars but ONE PM position, so a markdown offset past an atom would over-shoot. We walk the
 *  textblock's nodes accumulating markdown length (plain text char-by-char, an atom by its full
 *  `raw` length → one PM step) and return the PM position once we reach `offset`. An offset that
 *  lands INSIDE an atom snaps to the atom's far boundary (atoms are indivisible). Marks are
 *  counted by their text content (the `**`/`*` markers aren't doc positions) — consistent with
 *  `textUpToCaret`, so the two stay inverses for non-mark offsets. */
function mdOffsetToDocPos(v: EditorView, offset: number): number {
  const head0 = v.state.selection.head;
  const $ = v.state.doc.resolve(head0);
  const start = $.start();
  const end = $.end();
  const target = Math.max(0, offset);
  let acc = 0; // markdown chars consumed so far
  let result = start; // PM position of the last boundary at/before `target`
  v.state.doc.nodesBetween(start, end, (node, pos) => {
    if (acc >= target) return false; // already reached the offset
    if (node.isText) {
      const text = (node.text ?? "");
      // The node may start before `start` (shouldn't here, single block) — clamp.
      const skip = Math.max(0, start - pos);
      for (let i = skip; i < text.length; i++) {
        if (acc >= target) return false;
        acc += 1;
        result = pos + i + 1; // PM pos just after this character
      }
    } else if (node.isAtom && node.type.name.startsWith("oa")) {
      const rawLen = ((node.attrs.raw as string) ?? "").length;
      acc += rawLen; // the whole atom is consumed as one unit
      result = pos + node.nodeSize; // PM pos just after the atom
    }
    return undefined;
  });
  return Math.min(result, v.state.doc.content.size);
}

function placeCaret(v: EditorView, pos: number): void {
  try {
    const clamped = Math.min(Math.max(0, pos), v.state.doc.content.size);
    const tr = v.state.tr.setSelection(textSelectionNear(v, clamped));
    v.dispatch(tr);
  } catch {
    /* selection not applicable (empty doc) */
  }
}

function textSelectionNear(v: EditorView, pos: number) {
  // TextSelection.near clamps `pos` to the nearest valid text position.
  return TextSelection.near(v.state.doc.resolve(pos));
}

/** True when the selection sits on the first visual line (no newline before the caret in the
 *  block's inline text) — so ArrowUp should leave the block. Inline blocks are usually one line;
 *  this also handles a Shift+Enter hardbreak by checking for a preceding break node. */
function atFirstLine(v: EditorView): boolean {
  const { head, empty } = v.state.selection;
  if (!empty) return false;
  const $head = v.state.doc.resolve(head);
  // No hard-break before the caret in this textblock → first line.
  let hasBreakBefore = false;
  v.state.doc.nodesBetween($head.start(), head, (node) => {
    if (node.type.name === "hardbreak" || node.type.name === "hard_break") hasBreakBefore = true;
  });
  return !hasBreakBefore;
}

/** True when the selection sits on the last visual line (no hardbreak after the caret). */
function atLastLine(v: EditorView): boolean {
  const { head, empty } = v.state.selection;
  if (!empty) return false;
  const $head = v.state.doc.resolve(head);
  let hasBreakAfter = false;
  v.state.doc.nodesBetween(head, $head.end(), (node) => {
    if (node.type.name === "hardbreak" || node.type.name === "hard_break") hasBreakAfter = true;
  });
  return !hasBreakAfter;
}
