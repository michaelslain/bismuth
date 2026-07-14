// app/src/ui/MilkdownField.tsx
// A standalone TRUE-WYSIWYG rich-text field bound to a plain markdown string — the SAME
// Milkdown surface the note block-editor uses (bold renders bold, lists/headings render as
// blocks, `[[wikilinks]]`/`#tags` become chips, no markdown symbols shown), with zero
// vault/file coupling. Unlike the CodeMirror `MarkdownField` (live-preview / per-token
// reveal), this is Milkdown WYSIWYG; use it where a markdown property should edit exactly
// like a note in block mode (e.g. a kanban card's `description` — CardEditModal.tsx).
//
// The heavy Milkdown/ProseMirror bridge is code-split (dynamic import) like BlockEditor, so it
// stays out of app boot. The caller owns the value: `onChange` fires per edit with the whole
// document's markdown, `onBlur` fires when the editable loses focus — commit there.
import { onCleanup, onMount } from "solid-js";
import { settings } from "../settings";
import type { DocEditorHandle, createDocEditor as CreateDocEditorFn } from "../blocks/milkdownEditor";
import "../BlockEditor.css";

// Module-scoped so concurrent first mounts share one import (ES module caching also dedupes
// with BlockEditor's own loader — the chunk loads once regardless).
let docModule: Promise<{ createDocEditor: typeof CreateDocEditorFn }> | null = null;
function loadDocEditor(): Promise<{ createDocEditor: typeof CreateDocEditorFn }> {
  if (!docModule) docModule = import("../blocks/milkdownEditor");
  return docModule;
}

export function MilkdownField(props: {
  /** Initial markdown. Treated as SEED-only — the field owns its buffer after mount, so an
   *  in-flight external change can't clobber a mid-edit caret. Pass a stable snapshot. */
  value: string;
  /** Fired per edit with the whole document's serialized markdown. */
  onChange: (markdown: string) => void;
  /** Fired when the editable loses focus (commit the draft here). */
  onBlur?: () => void;
  /** Focus + place the caret at the end once the (async) surface mounts. */
  autofocus?: boolean;
  class?: string;
}) {
  let root!: HTMLDivElement;
  let handle: DocEditorHandle | null = null;
  let disposed = false;

  onMount(() => {
    void loadDocEditor().then(({ createDocEditor }) => {
      if (disposed) return;
      return createDocEditor({
        root,
        value: props.value ?? "",
        spellcheck: settings.editor.spellcheck,
        onChange: (md) => props.onChange(md),
        onBlur: () => props.onBlur?.(),
      }).then((h) => {
        if (disposed) {
          h.destroy();
          return;
        }
        handle = h;
        if (props.autofocus) h.focus("end");
      });
    });
  });

  onCleanup(() => {
    disposed = true;
    handle?.destroy();
    handle = null;
  });

  return <div ref={root} class={props.class} />;
}
