// app/src/editor/cellEditor.ts
//
// The nested CodeMirror EDIT FACE for a GFM table cell (#15 / #49). When a cell enters edit mode,
// tableWidget.ts mounts a REAL EditorView inside it, configured with the SAME shared markdown +
// live-preview + autocomplete stack (`markdownEditingExtensions`) the note body uses. This is what
// makes editing a cell reveal raw markdown per-token — bold/heading/list/math render, only the
// token under the caret shows its delimiters — EXACTLY like the note editor (#15), and pop the EXACT
// same emoji / wikilink / tag autocomplete with the full library (#49): one code path, permanent
// parity, no contenteditable read-back to go wrong across engines (WebKit `<div>` line-wrapping etc).
//
// A cell's stored source is a single GFM line with `<br>` break markers; we feed the nested editor a
// multi-line doc (`<br>`→`\n`, `cellSourceToBlockMarkdown`) and commit it back `<br>`-joined
// (`cmDocToCellSource`) — a lossless round-trip (see cellBlockRender.test.ts). The widget owns
// commit + cell navigation via the hook callbacks below; this module owns only the editor + the
// key reconciliation that keeps cell-nav (Tab / Enter-grows-row / Escape) working at the right
// precedence while list-continuation Enter and the completion popup still work inside the cell.
//
// Loaded DYNAMICALLY by tableWidget.ts (it imports `livePreview`'s Solid `.tsx`, which bun's headless
// test transform can't compile) so the widget's unit tests never pull it into their static graph.
import { EditorView, keymap, drawSelection, tooltips } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import {
  acceptCompletion,
  startCompletion,
  completionStatus,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { markdownEditingExtensions } from "./cellEditorExtensions";
import { wrapSelection } from "./wrapSelection";
import { settings } from "../settings";
import { api } from "../api";
import { cellSourceToBlockMarkdown } from "./cellBlockRender";
import type { NoteCandidate } from "./wikilink";

/** Callbacks the table widget wires the in-cell editor to. The editor owns text + live preview +
 *  autocomplete; the widget owns everything structural (commit, cell-to-cell navigation, blur). */
export interface CellEditorHooks {
  /** The cell element the editor mounts inside. */
  parent: HTMLElement;
  /** The cell's stored `<br>`-joined source (loaded as a multi-line doc). */
  source: string;
  /** The OUTER editor's DOM — the completion popup mounts here so it isn't clipped by the tiny cell
   *  and the shared completion theme (present on the outer root) styles it identically (#49). */
  popupParent: HTMLElement;
  getNotes: () => NoteCandidate[];
  getTags: () => string[];
  /** True when this cell is on the table's LAST row — where a plain Enter grows the table (#42). */
  isLastRow: boolean;
  /** Tab / Shift-Tab: move to the next / previous cell (wraps rows; commits past the last cell). */
  onNav: (dir: "next" | "prev") => void;
  /** Escape: blur the cell (which commits the table). */
  onEscape: () => void;
  /** Enter on the last row, not in a list: append a blank row and drop the caret into it (#42). */
  onGrowRow: () => void;
  /** Optional click coordinates, so the caret lands where the user clicked (else at doc end). */
  atCoords?: { x: number; y: number };
}

// A caret line that Enter should CONTINUE as list/blockquote markup (so it must NOT grow the table
// even on the last row) — `enterKeymap` in the shared stack handles the actual continuation. Covers
// unordered (`-`/`*`/`+`), ordered (`1.`/`2)`), and blockquote (`>`) lines, empty or not.
const LIST_OR_QUOTE_LINE = /^\s*(?:[-*+]|\d+[.)])(?:\s|$)|^\s*>/;

// In-cell editor chrome: transparent, gutterless, auto-height, inheriting the cell's font — so the
// edit face sits exactly where the rendered display face did, growing with its content (no inner
// scrollbar). Selection/caret tint mirror the note editor + card editor.
//
// CRITICAL: this editor is nested INSIDE the note editor's DOM, so the note editor's own
// `editorTheme` rules (`.scope .cm-scroller { padding: 0 40px; justify-content: center }`,
// `.scope .cm-content { padding: 8px 0 80px; max-width: 680px }`) match the nested scroller/content
// as descendants and would inset + center + balloon the cell. The `&.cm-editor .cm-…` selectors
// below carry HIGHER specificity (0,3,0) than that leaked `.scope .cm-…` (0,2,0), so they win and
// reset the geometry — the cell hugs its content, one line tall for a one-line cell.
const cellEditorTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "inherit" },
  "&.cm-editor.cm-focused": { outline: "none" },
  "&.cm-editor .cm-scroller": {
    // Line-height MUST equal the display face's, or the cell's line box changes height the instant
    // focus enters/leaves and the whole row jumps (#62 "line height reduces when I click off"). Both
    // faces read the SAME `--cm-td-lh` variable the table wrap sets (1.5, or 1.3 in compact — which
    // is always-on) so the EDIT and DISPLAY line boxes are pixel-identical; the 1.5 fallback is the
    // uncompacted default. See livePreview.ts `.cm-table-rendered` / `.cm-table-compact`.
    fontFamily: "inherit", fontSize: "inherit", lineHeight: "var(--cm-td-lh, 1.5)",
    overflow: "visible", padding: "0", justifyContent: "flex-start", overflowAnchor: "auto",
  },
  "&.cm-editor .cm-content": {
    padding: "0", margin: "0", minHeight: "0", maxWidth: "none", width: "100%",
    boxSizing: "border-box", caretColor: "var(--fg)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)", borderLeftWidth: "2px" },
  ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--accent) 38%, transparent)" },
});

/** Mount a nested CodeMirror editor inside a table cell and return the view. The caller stashes it
 *  on the cell and destroys it on blur / widget teardown. */
export function mountCellEditor(h: CellEditorHooks): EditorView {
  const view = new EditorView({
    parent: h.parent,
    state: EditorState.create({
      doc: cellSourceToBlockMarkdown(h.source),
      extensions: [
        history(),
        drawSelection(),
        // Match the note editor: a 4-space Tab so list nesting clears the `1. ` marker uniformly.
        indentUnit.of("    "),
        EditorState.tabSize.of(4),
        // Auto-close brackets/quotes + `$` for inline math, like the note editor.
        EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{", "'", "\"", "$"] } }]),
        closeBrackets(),
        // Wrap a selection in a formatting char (`*text*`, backticks, …) instead of replacing it —
        // the SAME extension the note editor uses (#45), read lazily so the live setting applies.
        ...(settings.editor.wrapSelection ? [wrapSelection(() => settings.editor.wrapSelectionChars)] : []),
        // ── Cell navigation, at HIGHEST precedence so Tab/Enter/Escape drive the cell — but each
        // handler DEFERS (returns false) when the completion popup is open, or (for Enter) when the
        // caret is on a list line, so the shared completion keymap + enterKeymap still run. Deferred
        // work is queued to a microtask so we never tear the view down mid-keydispatch.
        Prec.highest(keymap.of([
          {
            key: "Tab",
            // Popup open → accept the completion (like the note editor's Tab); else move to the next cell.
            run: (v) => { if (acceptCompletion(v)) return true; queueMicrotask(() => h.onNav("next")); return true; },
            shift: () => { queueMicrotask(() => h.onNav("prev")); return true; },
          },
          {
            key: "Escape",
            // Let the completion keymap close an open popup; otherwise blur/commit the cell.
            run: (v) => { if (completionStatus(v.state) != null) return false; queueMicrotask(() => h.onEscape()); return true; },
          },
          {
            key: "Enter",
            run: (v) => {
              if (completionStatus(v.state) != null) return false; // completion keymap accepts the option (#49)
              if (!h.isLastRow) return false; // non-last row → enterKeymap: list continuation or a plain in-cell newline
              const line = v.state.doc.lineAt(v.state.selection.main.head);
              if (LIST_OR_QUOTE_LINE.test(line.text)) return false; // in a list → enterKeymap continues it
              queueMicrotask(() => h.onGrowRow()); // last row, plain line → grow the table by a row (#42)
              return true;
            },
          },
          { key: "Ctrl-Space", run: startCompletion },
        ])),
        // The shared markdown stack (live preview + markdown + autocomplete + math + bold/italic) —
        // the SAME code the note editor runs, so the cell reads + completes identically (#15/#49).
        ...markdownEditingExtensions({
          completion: {
            getNotes: h.getNotes,
            getTags: h.getTags,
            // A cell has no frontmatter, so the frontmatter-gated sources (property/enum/icon/tag-list)
            // never fire — feed them inert inputs. The BODY sources (wikilink/tag/emoji) use the real
            // getters above.
            getSchema: () => ({}),
            getIconNames: () => [],
            inFrontmatter: () => false,
            readNote: (p) => api.read(p),
          },
          livePreview: settings.editor.livePreview,
        }),
        // Basic editing + history at default precedence (enterKeymap above already owns Enter).
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        cellEditorTheme,
        // Host the autocomplete popup in the OUTER editor root (not the cell) so it isn't clipped and
        // the shared completion theme styles it identically to the note editor's popup (#49).
        tooltips({ parent: h.popupParent }),
      ],
    }),
  });
  // Focus with preventScroll so entering a cell never yanks the viewport to it (#50); place the caret
  // where the user clicked, else at the end.
  view.contentDOM.focus({ preventScroll: true });
  const pos = h.atCoords ? view.posAtCoords(h.atCoords) : null;
  view.dispatch({ selection: { anchor: pos ?? view.state.doc.length } });
  return view;
}
