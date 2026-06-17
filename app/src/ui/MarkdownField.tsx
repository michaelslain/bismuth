import { createEffect, onCleanup, onMount } from "solid-js";
import { EditorView, keymap, drawSelection, placeholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting, indentUnit } from "@codemirror/language";
import { livePreview } from "../editor/livePreview";
import { notePathFacet } from "../editor/tableState";
import { codeHighlightStyle } from "../editor/codeHighlight";

// Theme: transparent, gutterless, prose-flow — so the field reads as rendered-yet-editable
// markdown (like the note editor's live-preview), not a boxed code editor. The host element owns
// the visible box (border/background/padding/min-height) via the caller's `class`. Font is the
// prose editor font (`--editor-font`, like CardEditor) so it looks identical to the note editor's
// markdown — NOT mono; selection/caret tints mirror Editor.tsx so highlighting matches too.
const fieldTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--fg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--editor-font)", fontSize: "14px", lineHeight: "1.55", overflow: "visible" },
  ".cm-content": { caretColor: "var(--fg)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)", borderLeftWidth: "2px" },
  ".cm-placeholder": { color: "var(--faint)", fontStyle: "italic" },
  ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--accent) 38%, transparent)" },
});

/**
 * A standalone, always-live inline markdown editor bound to a plain string (`value` + `onInput`) —
 * the same rendered-yet-editable live-preview the note editor uses (via the shared `livePreview`
 * extension), with zero vault/file coupling. Unlike CardEditor it never touches the API: the
 * caller owns the value and persists it however it likes. Use for small markdown fields (e.g. a
 * calendar event's description) that should edit exactly like the rest of the app's markdown,
 * instead of a render-on-blur textarea.
 *
 * Deliberately lighter than the full note Editor: it keeps live-preview rendering, list/indent
 * editing, and history, but omits wikilink/tag autocomplete, Harper spell/grammar, KaTeX math,
 * `![[…]]` embeds, and click-to-navigate links — overkill for a one-paragraph field. Reach for
 * CardEditor / Editor when those are needed.
 */
export function MarkdownField(props: {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  autofocus?: boolean;
  class?: string;
}) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  // True only while applying an external value→doc sync, so the updateListener doesn't echo that
  // programmatic change straight back out through onInput.
  let syncing = false;

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          history(),
          drawSelection(),
          indentUnit.of("  "),
          EditorState.tabSize.of(2),
          // Tab indents/dedents list items (matches the note editor); the rest is the standard
          // editing + history keymap.
          keymap.of([{ key: "Tab", run: indentMore, shift: indentLess }, ...defaultKeymap, ...historyKeymap]),
          markdown({ codeLanguages: languages }),
          syntaxHighlighting(codeHighlightStyle),
          // livePreview reads this facet (table/embed path resolution); "" = no note context.
          notePathFacet.of(""),
          livePreview, // rendered-yet-editable markdown + checkbox toggle + right-click status menu
          EditorView.lineWrapping,
          fieldTheme,
          ...(props.placeholder ? [placeholder(props.placeholder)] : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !syncing) props.onInput(u.state.doc.toString());
          }),
        ],
      }),
    });
    if (props.autofocus) view.focus();
  });

  // Reflect an out-of-band `value` change (caller reset / swapped record) into the doc. Typing
  // flows value back through onInput, so this no-ops on self-originated edits (next === doc).
  createEffect(() => {
    const next = props.value;
    if (!view || next === view.state.doc.toString()) return;
    const sel = view.state.selection.main;
    const len = next.length;
    syncing = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: { anchor: Math.min(sel.anchor, len), head: Math.min(sel.head, len) },
    });
    syncing = false;
  });

  onCleanup(() => view?.destroy());

  return <div ref={host} class={props.class} />;
}
