import { createResource, Show, Switch, Match } from "solid-js";
import { readNoteCached } from "./noteCache";
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
    // Read through the note-body cache: a reopen of an unchanged note resolves
    // synchronously (no spinner). A missing/unreadable file is treated as an empty
    // note (a new, not-yet-written file routes to the Editor), matching how the
    // Editor handles a failed read.
    (p) => {
      const r = readNoteCached(p);
      return typeof r === "string" ? r : r.catch(() => "");
    },
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
          {/* Hand the already-fetched body to the Editor so it doesn't re-read the
              same file over HTTP — FileView's read above is the single round-trip.
              External edits still reload via the Editor's SSE reconcile effect. */}
          <Editor path={props.path} initialText={body()} onSaved={props.onSaved} noteNames={props.noteNames} tagNames={props.tagNames} />
        </Match>
      </Switch>
    </Show>
  );
}
