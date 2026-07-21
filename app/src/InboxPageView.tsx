// app/src/InboxPageView.tsx
// Chrome for a `type: daemon-page` note (core/src/daemonPages.ts): an action-bar HEADER — the
// page's actions[] as buttons, or a status chip/owner warning once there's nothing left to
// press — rendered ABOVE the standard Editor/BlockEditor body. Chrome, not inline markdown:
// keeps the daemon-authored controls physically separate from the user's editable prose, and
// (being external chrome, not a CM6 widget) it renders regardless of editor.defaultMode — a
// Milkdown-only user would otherwise never see the buttons at all.
import { createResource, createSignal, Show, For, Match, Switch } from "solid-js";
import { Editor } from "./Editor";
import { BlockEditor } from "./BlockEditor";
import { settings } from "./settings";
import { api } from "./api";
import { flushEditorByPath } from "./editorRegistry";
import { pushToast } from "./Toast";
import { ViewBar, Crumb, ViewBarSpacer } from "./ui/ViewBar";
import { TextButton } from "./ui/TextButton";
import { relTimeISO } from "./relTime";
import { inboxPages, refreshDaemonPages } from "./daemonInbox";
import type { NoteCandidate } from "./editor/wikilink";
import type { MemoryCandidate } from "../../core/src/memoryRef";
import "./InboxPageView.css";

// A page reading "working" for longer than this is presumed stuck (the daemon process itself
// died mid-run, no writer left to ever settle it) — plan §5's belt-and-suspenders client check.
const STUCK_WORKING_MS = 10 * 60 * 1000;

export function InboxPageView(props: {
  path: string;
  initialText?: string;
  onSaved: () => void;
  noteNames: () => NoteCandidate[];
  memoryNames: () => MemoryCandidate[];
  tagNames: () => string[];
}) {
  // The live page record (actions/status) comes from the shared poll (daemonInbox.ts), which
  // App.tsx keeps running whenever the daemon is enabled — this just looks up OUR path in it.
  const page = () => inboxPages().find((p) => p.path === props.path);
  const visualMode = () => settings.editor.defaultMode === "visual";
  const [pressingId, setPressingId] = createSignal<string | null>(null);

  // Am I the owner device? Approving a page on a non-owner device would silently do nothing
  // (the daemon consumes the trigger without firing) — surface that instead of letting the user
  // wonder why "Send" appeared to work. Fetched once per mount, like DaemonSetupModal does.
  const [status] = createResource(() => api.daemonStatus());
  const notOwner = () => {
    const s = status();
    return !!s && s.owner !== null && s.owner.ownerDeviceId !== s.thisDeviceId;
  };

  const stuck = () => {
    const p = page();
    if (!p || p.status !== "working" || !p.pressedAt) return false;
    return Date.now() - Date.parse(p.pressedAt) > STUCK_WORKING_MS;
  };

  async function press(actionId: string): Promise<void> {
    setPressingId(actionId);
    try {
      // Flush THIS page's buffer to disk FIRST, so the daemon acts on exactly what's on
      // screen — not a stale, still-debounced autosave. Scoped by path: in a split layout the
      // last-focused view can be a DIFFERENT note, so a focused-editor flush would persist the
      // wrong buffer and skip this one. (CodeMirror only; BlockEditor doesn't register with
      // editorRegistry — the same pre-existing gap the rename flow (NoteTitle.tsx) already has.)
      await flushEditorByPath(props.path);
      const res = await api.resolveDaemonPage(props.path, actionId);
      if (res.alreadyResolved) pushToast("Already resolved");
      await refreshDaemonPages();
    } catch (e) {
      pushToast(`Couldn't resolve: ${(e as Error).message}`);
    } finally {
      setPressingId(null);
    }
  }

  async function markFailed(): Promise<void> {
    try {
      await api.markDaemonPageFailed(props.path);
      await refreshDaemonPages();
    } catch (e) {
      // The escape hatch itself needs an escape hatch: with the backend unreachable a silent
      // no-op looks like the button is broken. Say what happened.
      pushToast(`Couldn't mark failed: ${(e as Error).message}`);
    }
  }

  return (
    <div class="inbox-page-host">
      <ViewBar class="inbox-page-bar">
        <Crumb icon="Inbox">Daemon inbox</Crumb>
        <ViewBarSpacer />
        {/* Stays visible through "working" — a non-owner press is exactly when the user most
            needs to know the daemon will consume the trigger without firing. */}
        <Show when={notOwner() && (page()?.status === "pending" || page()?.status === "working")}>
          <span class="inbox-page-note inbox-page-note-warn">
            This device isn't the daemon owner — approving here won't fire.
          </span>
        </Show>
        <Show when={page()} keyed>
          {(p) => (
            <Switch>
              <Match when={stuck()}>
                <span class="inbox-page-note inbox-page-note-warn">
                  {notOwner()
                    ? "This device isn't the daemon owner — the approval never fired. Approve from the owner device."
                    : "No response — daemon may be offline."}
                </span>
                <TextButton onClick={markFailed}>MARK FAILED</TextButton>
              </Match>
              <Match when={p.status === "pending" || p.status === "working"}>
                <For each={p.actions}>
                  {(a) => (
                    <TextButton
                      variant={a.kind === "primary" ? "selected" : "normal"}
                      danger={a.kind === "danger"}
                      disabled={p.status === "working" || pressingId() !== null}
                      onClick={() => press(a.id)}
                    >
                      {p.status === "working" && pressingId() === a.id ? "WORKING…" : a.label.toUpperCase()}
                    </TextButton>
                  )}
                </For>
              </Match>
              <Match when={p.status === "done"}>
                <span class="inbox-page-note">Done{p.daemonNote ? ` — ${p.daemonNote}` : ""}</span>
              </Match>
              <Match when={p.status === "failed"}>
                <span class="inbox-page-note inbox-page-note-failed">
                  Failed{p.daemonNote ? `: ${p.daemonNote}` : ""}
                </span>
                {/* A failed page keeps its buttons live — pressing again re-runs the round-trip. */}
                <For each={p.actions}>
                  {(a) => (
                    <TextButton variant={a.kind === "primary" ? "selected" : "normal"} danger={a.kind === "danger"} onClick={() => press(a.id)}>
                      {a.label.toUpperCase()}
                    </TextButton>
                  )}
                </For>
              </Match>
              <Match when={p.status === "dismissed"}>
                <span class="inbox-page-note">Dismissed{p.pressedAt ? ` — ${relTimeISO(p.pressedAt)}` : ""}</span>
              </Match>
            </Switch>
          )}
        </Show>
      </ViewBar>
      <div class="inbox-page-body">
        <Show
          when={visualMode()}
          fallback={
            <Editor path={props.path} initialText={props.initialText} onSaved={props.onSaved} noteNames={props.noteNames} memoryNames={props.memoryNames} tagNames={props.tagNames} />
          }
        >
          <BlockEditor path={props.path} initialText={props.initialText} onSaved={props.onSaved} noteNames={props.noteNames} tagNames={props.tagNames} />
        </Show>
      </div>
    </div>
  );
}
