// app/src/ChatComposer.tsx
//
// The visual Claude chat COMPOSER — a single-purpose CodeMirror editor that live-previews the draft
// message exactly the way the note editor does (bold/italic/lists/`code`/```fences```/[[wikilinks]]
// render as-you-type), while still behaving as a plain text input: Enter sends, Shift+Enter inserts a
// newline, paste + drop-to-mention keep working, and the value round-trips as raw MARKDOWN SOURCE
// (never rendered HTML) so the backend receives what the user typed (Row 77).
//
// It reuses the SAME shared markdown stack the note editor and table cells run
// (`markdownEditingExtensions` — livePreview + markdown + math + wikilink/tag/emoji autocomplete +
// bold/italic toggles), so live preview is permanent parity with the editor, not a re-implementation.
// The composer adds only: a submit-on-Enter key handler (delegated back to ChatView so slash-command
// nav / stop-on-Escape stay owned there), two-way binding to a `value`/`onInput` signal pair, and an
// imperative `{ focus, scrollIntoView }` handle for the reply / mention / slash-pick flows.
import { onMount, onCleanup, createEffect } from "solid-js";
import { EditorView, keymap, drawSelection, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState, Prec, Compartment } from "@codemirror/state";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { startCompletion, closeBrackets, closeBracketsKeymap, completionStatus } from "@codemirror/autocomplete";
import { markdownEditingExtensions } from "./editor/cellEditorExtensions";
import { wrapSelection } from "./editor/wrapSelection";
import { settings } from "./settings";
import { api } from "./api";
import type { NoteCandidate } from "./editor/wikilink";

/** Imperative handle ChatView drives the composer through — mirrors the old `ta?.focus()` /
 *  `ta?.scrollIntoView()` calls it made against the raw textarea. */
export interface ComposerHandle {
  focus: () => void;
  scrollIntoView: () => void;
}

// Composer chrome: transparent (the .chat-composer-inner wrapper is the visible surface), inheriting
// the editor prose font so live-preview tokens read exactly like the note body, capped at 200px with
// its own scroll (replacing the textarea's max-height + autoGrow). Not nested inside a note editor's
// DOM, so — unlike cellEditorTheme — no high-specificity reset of leaked `.cm-…` rules is needed.
const composerTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--fg)" },
  "&.cm-editor.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--editor-font, 'Lora', serif)",
    fontSize: "var(--editor-font-size, 18px)",
    lineHeight: "1.45",
    overflowY: "auto",
    maxHeight: "200px",
    padding: "0",
  },
  ".cm-content": { padding: "5px 0", minHeight: "28px", caretColor: "var(--fg)", maxWidth: "none" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)", borderLeftWidth: "2px" },
  ".cm-placeholder": { color: "var(--text-muted)", fontStyle: "normal" },
  ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--accent) 38%, transparent)" },
});

export interface ChatComposerProps {
  /** Reactive draft (the ChatView `draft()` signal) — the raw markdown SOURCE. */
  value: () => string;
  /** Called on every document change with the new raw source (ChatView `setDraft`). */
  onInput: (value: string) => void;
  placeholder: () => string;
  getNotes: () => NoteCandidate[];
  getTags: () => string[];
  /** Clipboard paste (image intake) — ChatView's `onComposerPaste`. Returns nothing; never consumes
   *  text paste, so pasting markdown lands in the doc normally. */
  onPaste: (e: ClipboardEvent) => void;
  /** Delegated keydown for the composer's OWN keys (Enter=send, Shift+Enter=newline, Escape=stop,
   *  slash-popover nav). Returns true when it fully handled the event so CodeMirror stops — false to
   *  let CodeMirror handle it (a plain newline, ordinary typing). NOT called for keys the vault
   *  autocomplete popup owns while it's open (those go straight to CodeMirror). */
  onKeyDown: (e: KeyboardEvent) => boolean;
  /** Receives the imperative handle once the view is mounted. */
  onReady: (handle: ComposerHandle) => void;
}

export function ChatComposer(props: ChatComposerProps) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  const placeholderComp = new Compartment();

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.value(),
        extensions: [
          history(),
          drawSelection(),
          // 4-space Tab so list nesting clears the `1. ` marker uniformly — matches the note editor.
          indentUnit.of("    "),
          EditorState.tabSize.of(4),
          // Auto-close brackets/quotes + `$` for inline math, like the note editor.
          EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{", "'", "\"", "$"] } }]),
          closeBrackets(),
          ...(settings.editor.wrapSelection ? [wrapSelection(() => settings.editor.wrapSelectionChars)] : []),
          // Highest-precedence input handlers so the composer's own keys (Enter=send, etc.) win
          // BEFORE CodeMirror's keymaps — EXCEPT when the vault autocomplete popup is open, where we
          // defer so its keymap owns Arrow/Enter/Escape/Tab (accept + navigate the [[wikilink]] menu).
          Prec.highest(EditorView.domEventHandlers({
            keydown: (e, v) => {
              if (completionStatus(v.state) === "active" && ["Enter", "ArrowDown", "ArrowUp", "Escape", "Tab"].includes(e.key)) {
                return false;
              }
              return props.onKeyDown(e);
            },
            paste: (e) => {
              props.onPaste(e);
              return false; // never consume — text paste still lands in the doc
            },
          })),
          // The SAME shared stack the note editor + table cells run: live preview, markdown, math,
          // wikilink/tag/emoji autocomplete, bold/italic toggles (#15/#49). A composer has no
          // frontmatter, so the frontmatter-gated completion sources get inert inputs.
          ...markdownEditingExtensions({
            completion: {
              getNotes: props.getNotes,
              getTags: props.getTags,
              getSchema: () => ({}),
              getIconNames: () => [],
              inFrontmatter: () => false,
              readNote: (p) => api.read(p),
            },
            livePreview: settings.editor.livePreview,
          }),
          // Basic editing + history at default precedence (enterKeymap in the shared stack owns Enter
          // for list continuation; the domEventHandler above owns plain-Enter=send).
          keymap.of([{ key: "Ctrl-Space", run: startCompletion }, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          composerTheme,
          placeholderComp.of(cmPlaceholder(props.placeholder())),
          // Doc → signal. The external-sync effect below no-ops when value already equals the doc,
          // so this can't loop.
          EditorView.updateListener.of((u) => {
            if (u.docChanged) props.onInput(u.state.doc.toString());
          }),
        ],
      }),
    });
    props.onReady({
      focus: () => view?.contentDOM.focus(),
      scrollIntoView: () => host?.scrollIntoView({ block: "nearest" }),
    });
  });

  // Signal → doc: reflect EXTERNAL draft changes (send-clear, slash pick, reply quote, drop-mention)
  // into the editor, parking the caret at the end. When the change originated from typing, value
  // already equals the doc, so this is a no-op (no feedback loop).
  createEffect(() => {
    const next = props.value();
    if (!view) return;
    const cur = view.state.doc.toString();
    if (next === cur) return;
    view.dispatch({ changes: { from: 0, to: cur.length, insert: next }, selection: { anchor: next.length } });
  });

  // Reactive placeholder (persona name can change when the daemon toggles).
  createEffect(() => {
    const text = props.placeholder();
    if (view) view.dispatch({ effects: placeholderComp.reconfigure(cmPlaceholder(text)) });
  });

  onCleanup(() => view?.destroy());

  return <div class="chat-input-cm" ref={host} />;
}
