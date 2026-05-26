// app/src/Editor.tsx
import { createEffect, onCleanup, createSignal } from "solid-js";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { api } from "./api";

export function Editor(props: { path: string | null; onSaved: () => void }) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const [meta, setMeta] = createSignal<Record<string, unknown>>({});

  const save = async (path: string, text: string) => {
    await api.write(path, text);
    props.onSaved();
    api.backup();           // local-git snapshot; no-op when nothing changed
    setMeta(await api.meta(path)); // frontmatter may have changed
  };

  createEffect(async () => {
    const path = props.path;
    view?.destroy();
    if (!path) return;
    const text = await api.read(path);
    setMeta(await api.meta(path));
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
  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column" }}>
      {(meta().status || meta().priority || meta().tags) && (
        <div style={{ padding: "4px 8px", "border-bottom": "1px solid #2a2a2a", "font-size": "12px", opacity: 0.8 }}>
          {meta().status ? `● ${String(meta().status)}` : ""}
          {meta().priority != null ? `  ·  P${String(meta().priority)}` : ""}
          {Array.isArray(meta().tags) ? `  ·  ${(meta().tags as string[]).map((t) => "#" + t).join(" ")}` : ""}
        </div>
      )}
      <div ref={host} style={{ flex: "1", overflow: "auto" }} />
    </div>
  );
}
