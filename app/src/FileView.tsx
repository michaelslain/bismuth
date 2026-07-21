import { createResource, Show, Switch, Match } from "solid-js";
import { readNoteCached } from "./noteCache";
import { parseFrontmatter } from "../../core/src/frontmatter";
import { Editor } from "./Editor";
import { BlockEditor } from "./BlockEditor";
import { BaseView } from "./bases/BaseView";
import { InboxPageView } from "./InboxPageView";
import { Loading } from "./ui/EmptyState";
import { settings } from "./settings";
import { isConfigBuffer } from "./editor/settingsBuffer";
import type { NoteCandidate } from "./editor/wikilink";
import type { MemoryCandidate } from "../../core/src/memoryRef";

/**
 * Routes a `.md` file to the right view: a `type: base` file renders as a BaseView,
 * everything else as an editor. Both branches need the file body, so FileView fetches it
 * once and parses the frontmatter client-side (same `parseFrontmatter` the backend's /meta
 * used) to branch — no separate /meta round-trip, and the already-read body is handed to
 * BaseView so it doesn't re-read. While the body is loading we show a neutral spinner.
 *
 * A plain note renders as either the CodeMirror `Editor` (raw markdown) or the Notion-like
 * `BlockEditor`, chosen ENTIRELY by the `editor.defaultMode` setting — there is no per-note UI
 * toggle. `settings` is reactive, so flipping `editor.defaultMode` in settings.yaml swaps every
 * open note's surface live. Both surfaces are interchangeable over the SAME file (same `body()`
 * as initialText, same `onSaved`), so the swap never loses an edit.
 */
export function FileView(props: {
  path: string;
  onSaved: () => void;
  onOpen: (path: string) => void;
  noteNames: () => NoteCandidate[];
  memoryNames: () => MemoryCandidate[];
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
  // A daemon-authored inbox page (core/src/daemonPages.ts) — routes to InboxPageView, which
  // wraps the SAME Editor/BlockEditor body in an action-bar header. Same idiom as isBase() above.
  const isDaemonPage = () => {
    const text = body();
    return text !== undefined && parseFrontmatter(text).data.type === "daemon-page";
  };
  // Visual (Milkdown) mode is for real prose notes only. A YAML CONFIG buffer — the app
  // `.settings` file, or any `.yaml`/`.yml` — must ALWAYS open in the CodeMirror source Editor:
  // that's where the schema-driven settings autocomplete + lint live (isSettingsBuffer), and where
  // the YAML round-trips losslessly. Routing `.settings` to the BlockEditor is what silently killed
  // settings autocomplete (and would mangle the YAML on save) whenever defaultMode was `visual`.
  const visualMode = () => settings.editor.defaultMode === "visual" && !isConfigBuffer(props.path);
  return (
    <Show when={body.state === "ready"} fallback={<Loading />}>
      <Switch>
        <Match when={isBase()}>
          <BaseView path={props.path} body={body()} onOpen={props.onOpen} />
        </Match>
        <Match when={isDaemonPage()}>
          <InboxPageView path={props.path} initialText={body()} onSaved={props.onSaved} noteNames={props.noteNames} memoryNames={props.memoryNames} tagNames={props.tagNames} />
        </Match>
        <Match when={!isBase() && !isDaemonPage()}>
          <Show
            when={visualMode()}
            fallback={
              <Editor path={props.path} initialText={body()} onSaved={props.onSaved} noteNames={props.noteNames} memoryNames={props.memoryNames} tagNames={props.tagNames} />
            }
          >
            <BlockEditor path={props.path} initialText={body()} onSaved={props.onSaved} noteNames={props.noteNames} tagNames={props.tagNames} />
          </Show>
        </Match>
      </Switch>
    </Show>
  );
}
