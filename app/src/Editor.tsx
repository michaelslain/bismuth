// app/src/Editor.tsx
import { createEffect, onCleanup } from "solid-js";
import { EditorView, keymap, drawSelection, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { api } from "./api";
import { livePreview } from "./editor/livePreview";
import { tasksQuery } from "./editor/tasksQuery";
import { vaultCompletion } from "./editor/autocomplete";
import type { NoteCandidate } from "./editor/wikilink";
import { settings } from "./settings";

// Prose font/size and selection tint come from CSS variables (set by App.tsx from
// the Appearance settings), so they update live without rebuilding the editor.
const editorTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--fg)", height: "100%" },
  ".cm-scroller": { fontFamily: "var(--editor-font)", fontSize: "var(--editor-font-size)", lineHeight: "1.65", overflow: "auto" },
  ".cm-content": { caretColor: "var(--fg)", padding: "12px 16px" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--fg)",
    borderLeftWidth: "2px",
    transition: "left 70ms ease-out, top 70ms ease-out", // smooth glide
  },
  ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)" },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--accent) 38%, transparent)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "color-mix(in srgb, var(--fg) 35%, transparent)" },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "1px solid var(--border)",
    borderRadius: "8px",
    backgroundColor: "var(--bg)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
    fontFamily: "'Monaspace Xenon', monospace",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    padding: "3px 10px",
    fontSize: "13px",
    lineHeight: "1.5",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent)",
    color: "var(--fg)",
  },
  ".cm-completionDetail": {
    marginLeft: "8px",
    opacity: "0.5",
    fontStyle: "normal",
  },
});

export function Editor(props: { path: string | null; onSaved: () => void; noteNames: () => NoteCandidate[]; tagNames: () => string[] }) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const save = async (path: string, text: string) => {
    await api.write(path, text);
    props.onSaved();
    if (settings.vault.backupOnSave) api.backup(); // local-git snapshot; no-op when nothing changed
  };

  createEffect(async () => {
    const path = props.path;
    // Destroy the previous view when this effect re-runs (path changed or cleanup).
    onCleanup(() => view?.destroy());
    if (!path) return;

    // Treat a missing file as an empty note (new, not yet written).
    let text = "";
    try {
      text = await api.read(path);
    } catch {
      text = "";
    }
    // Guard: if the path changed while we were awaiting, discard this run.
    if (path !== props.path) return;

    // Read editor settings here so this effect re-runs (rebuilding the view) when
    // any of them change — that re-applies live preview / gutter / wrapping toggles.
    const ed = settings.editor;
    const extensions = [
      history(),
      drawSelection(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      vaultCompletion({ getNotes: props.noteNames, getTags: props.tagNames }),
      editorTheme,
      ...(ed.lineWrapping ? [EditorView.lineWrapping] : []),
      ...(ed.lineNumbers ? [lineNumbers()] : []),
      ...(ed.livePreview ? [livePreview, tasksQuery] : []),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => save(path, u.state.doc.toString()), settings.editor.autoSaveDelay);
      }),
    ];

    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text,
        extensions: [
          ...extensions,
          EditorView.domEventHandlers({
            mousedown: (e, view) => {
              const pos = view.posAtCoords({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
              if (pos == null) return false;
              const line = view.state.doc.lineAt(pos);
              for (const m of line.text.matchAll(/\[\[([^\]]+?)\]\]/g)) {
                const s = line.from + (m.index ?? 0), en = s + m[0].length;
                if (pos >= s && pos <= en) {
                  // Strip an optional "|alias" and "#heading" to get the target note name.
                  const target = m[1].split("|")[0].split("#")[0].trim();
                  // A missing target opens as a new empty note (read falls back to "" above).
                  window.dispatchEvent(new CustomEvent("oa-open", { detail: target + ".md" }));
                  return true;
                }
              }
              return false;
            },
          }),
        ],
      }),
    });
  });
  return <div ref={host} style={{ height: "100%", overflow: "auto" }} />;
}
