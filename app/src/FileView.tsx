import { createResource, Show, Switch, Match } from "solid-js";
import { api } from "./api";
import { parseFrontmatter } from "../../core/src/frontmatter";
import { Editor } from "./Editor";
import { BaseView } from "./bases/BaseView";
import { Loading } from "./ui/EmptyState";
import type { NoteCandidate } from "./editor/wikilink";

/**
 * Routes a `.md` file to the right view: a `type: base` file renders as a BaseView,
 * everything else as the text Editor. Both branches need the file body, so FileView
 * fetches it once and parses the frontmatter client-side (same `parseFrontmatter` the
 * backend's /meta used) to branch — no separate /meta round-trip, and the already-read
 * body is handed to BaseView so it doesn't re-read. While the body is loading we show a
 * neutral spinner rather than the editor, so a base never flashes the raw editor first.
 */
export function FileView(props: {
  path: string;
  onSaved: () => void;
  onOpen: (path: string) => void;
  noteNames: () => NoteCandidate[];
  tagNames: () => string[];
}) {
  const [body] = createResource(
    () => props.path,
    // A missing/unreadable file is treated as an empty note (a new, not-yet-written
    // file routes to the Editor), matching how the Editor handles a failed read.
    (p) => api.read(p).catch(() => ""),
  );
  const isBase = () => {
    const text = body();
    return text !== undefined && parseFrontmatter(text).data.type === "base";
  };
  return (
    <Show when={body.state === "ready"} fallback={<Loading />}>
      <Switch>
        <Match when={isBase()}>
          <BaseView path={props.path} body={body()} onOpen={props.onOpen} />
        </Match>
        <Match when={!isBase()}>
          <Editor path={props.path} onSaved={props.onSaved} noteNames={props.noteNames} tagNames={props.tagNames} />
        </Match>
      </Switch>
    </Show>
  );
}
