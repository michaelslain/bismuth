import { createResource, Show } from "solid-js";
import { api } from "./api";
import { Editor } from "./Editor";
import { BaseView } from "./bases/BaseView";
import type { NoteCandidate } from "./editor/wikilink";

/**
 * Routes a `.md` file to the right view: a `type: base` file renders as a BaseView,
 * everything else as the text Editor. The Editor is the fallback, so ordinary notes
 * render immediately with no delay; only a base file swaps in once its meta resolves.
 */
export function FileView(props: {
  path: string;
  onSaved: () => void;
  onOpen: (path: string) => void;
  noteNames: () => NoteCandidate[];
  tagNames: () => string[];
}) {
  const [meta] = createResource(
    () => props.path,
    (p) => api.meta(p) as Promise<Record<string, unknown>>,
  );
  return (
    <Show
      when={meta()?.type === "base"}
      fallback={
        <Editor path={props.path} onSaved={props.onSaved} noteNames={props.noteNames} tagNames={props.tagNames} />
      }
    >
      <BaseView path={props.path} onOpen={props.onOpen} />
    </Show>
  );
}
