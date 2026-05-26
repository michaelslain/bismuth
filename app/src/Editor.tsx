// app/src/Editor.tsx
import { createEffect, onCleanup } from "solid-js";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { api } from "./api";

export function Editor(props: { path: string | null; onSaved: () => void }) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const save = async (path: string, text: string) => {
    await api.write(path, text);
    props.onSaved();
  };

  createEffect(async () => {
    const path = props.path;
    view?.destroy();
    if (!path) return;
    const text = await api.read(path);
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => save(path, u.state.doc.toString()), 800);
          }),
        ],
      }),
    });
  });

  onCleanup(() => view?.destroy());
  return <div ref={host} style={{ height: "100%" }} />;
}
