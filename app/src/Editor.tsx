// app/src/Editor.tsx
import { createEffect, onCleanup } from "solid-js";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { api } from "./api";
import { livePreview } from "./editor/livePreview";

// Dark theme: prose in Lora, a bright caret that glides between positions (VSCode-style).
const editorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "#dcdcdc", height: "100%" },
    ".cm-scroller": { fontFamily: "'Lora', serif", fontSize: "16px", lineHeight: "1.65", overflow: "auto" },
    ".cm-content": { caretColor: "#e8e8e8", padding: "12px 16px" },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#e8e8e8",
      borderLeftWidth: "2px",
      transition: "left 70ms ease-out, top 70ms ease-out", // smooth glide
    },
    ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "rgba(100,150,255,0.30)" },
    "&.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(100,150,255,0.35)" },
  },
  { dark: true },
);

export function Editor(props: { path: string | null; onSaved: () => void }) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const save = async (path: string, text: string) => {
    await api.write(path, text);
    props.onSaved();
    api.backup();           // local-git snapshot; no-op when nothing changed
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

    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text,
        extensions: [
          history(),
          drawSelection(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          editorTheme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => save(path, u.state.doc.toString()), 800);
          }),
          livePreview,
          EditorView.domEventHandlers({
            mousedown: (e, view) => {
              const pos = view.posAtCoords({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
              if (pos == null) return false;
              const line = view.state.doc.lineAt(pos);
              for (const m of line.text.matchAll(/\[\[([^\]]+?)\]\]/g)) {
                const s = line.from + (m.index ?? 0), en = s + m[0].length;
                if (pos >= s && pos <= en) {
                  const target = m[1].split("|")[0].split("#")[0].trim();
                  // Just dispatch; Editor.tsx FIX 2 try/catch + server FIX 3 handle missing files.
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
