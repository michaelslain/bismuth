import { createResource, Show, Switch, Match } from "solid-js";
import { readNoteCached } from "./noteCache";
import { parseFrontmatter } from "../../core/src/frontmatter";
import { Editor } from "./Editor";
import { BlockEditor } from "./BlockEditor";
import { getMode, setMode } from "./blocks/editorMode";
import { BaseView } from "./bases/BaseView";
import { Loading } from "./ui/EmptyState";
import { ViewBar, ViewBarSpacer } from "./ui/ViewBar";
import { SegmentedToggle } from "./ui/SegmentedToggle";
import type { EditorMode } from "./blocks/editorMode";
import type { NoteCandidate } from "./editor/wikilink";
import styles from "./FileView.module.css";

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
          {/* A plain note can be edited as raw markdown (the CodeMirror Editor) or as a
              Notion-like stack of blocks (BlockEditor). Both are interchangeable surfaces
              over the SAME file: each gets the already-fetched body() as initialText and the
              SAME onSaved, and each flushes its debounced save on cleanup, so toggling the
              mode never loses an edit. The mode is a per-note localStorage preference
              (blocks/editorMode.ts) — shown only here, never for base files. */}
          <div class={styles.noteShell}>
            <ViewBar>
              <ViewBarSpacer />
              <SegmentedToggle<EditorMode>
                value={getMode(props.path)}
                onChange={(m) => setMode(props.path, m)}
                options={[
                  { id: "source", label: "Source" },
                  { id: "blocks", label: "Blocks" },
                ]}
              />
            </ViewBar>
            <div class={styles.surface}>
              <Show
                when={getMode(props.path) === "blocks"}
                fallback={
                  <Editor path={props.path} initialText={body()} onSaved={props.onSaved} noteNames={props.noteNames} tagNames={props.tagNames} />
                }
              >
                <BlockEditor path={props.path} initialText={body()} onSaved={props.onSaved} noteNames={props.noteNames} tagNames={props.tagNames} />
              </Show>
            </div>
          </div>
        </Match>
      </Switch>
    </Show>
  );
}
