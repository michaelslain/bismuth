// app/src/PreviewView.tsx
// Read-only PREVIEW tab for non-note files: images, PDFs, and code/text open here by default
// (a lighter alternative to the `.draw` markup surface). Images + PDFs expose an "Annotate"
// button that hands off to that markup surface (::annotate:); every kind exposes "Open in
// default app" / "Reveal" (Tauri) so binary formats we can't render (PSD/Figma/…) are still
// reachable in Photoshop/Figma/etc. Routing lives in PaneContent; classification in previewKind.
//
// Find (Cmd/Ctrl+F, rebindable via settings.keybindings.find — same key the editor uses) is
// handled per content kind, on a capture-phase keydown of the preview root (App.tsx has NO
// global find handler, and the editor only binds it when the editor is focused, so mirroring
// that here is what makes Cmd+F work when a preview tab is focused):
//   • code/text — a real find bar: highlight every match, next/prev + count, scroll-to-active.
//   • pdf       — the embedded viewer owns text search (we can't reach an <iframe> PDF's text
//                 layer), so Find focuses the document + shows a one-line note pointing at the
//                 browser/viewer's own find. DOCUMENTED LIMITATION: no in-app PDF text search.
//   • image / external — no searchable text, so Find is a graceful no-op (never crashes).
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";
import { api } from "./api";
import { previewKind, type PreviewKind } from "./preview/previewKind";
import { findMatches, segmentText, stepMatchIndex } from "./preview/findMatches";
import { annotatePath } from "./tabIds";
import { Icon } from "./icons/Icon";
import { IconButton } from "./ui/IconButton";
import { IconTextButton } from "./ui/IconTextButton";
import { EmptyState, Loading } from "./ui/EmptyState";
import { isTauri } from "./nativeMenu";
import { openPathInDefaultApp, revealPath } from "./appWindow";
import { pushToast } from "./Toast";
import { settings } from "./settings";
import { matchesKeybinding } from "./keybindings";
import "./PreviewView.css";

const HEADER_ICON: Record<PreviewKind, string> = {
  image: "Image",
  pdf: "FileText",
  code: "Code",
  external: "File",
};

// Cap highlighted matches so a 1-char query in a huge file can't explode the DOM / stall
// the count. Beyond this we still show a "…+" count and highlight the first N.
const MAX_MATCHES = 2000;

export function PreviewView(props: { path: string; onOpen: (path: string) => void }) {
  const kind = (): PreviewKind => previewKind(props.path) ?? "external";
  const name = () => props.path.split("/").pop() ?? props.path;
  const assetUrl = () => api.assetUrl(props.path);
  const annotatable = () => kind() === "image" || kind() === "pdf";

  // Fetch the text body only for code/text kinds (GET /file returns "" for a missing file).
  const [code] = createResource(
    () => (kind() === "code" ? props.path : undefined),
    (p) => api.read(p).catch(() => ""),
  );

  // --- Find state (code/text bar + pdf note) ---------------------------------------------
  const [findOpen, setFindOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [caseSensitive, setCaseSensitive] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);

  let rootRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let codeRef: HTMLPreElement | undefined;
  let pdfRef: HTMLIFrameElement | undefined;

  // Matches + segmented render, only for code/text with a live query.
  const matches = createMemo(() =>
    kind() === "code" && query() ? findMatches(code() ?? "", query(), caseSensitive(), MAX_MATCHES) : [],
  );
  const capped = () => matches().length >= MAX_MATCHES;
  const segments = createMemo(() =>
    kind() === "code" && query() && matches().length ? segmentText(code() ?? "", matches()) : null,
  );

  // Reset the active match when the file (or its text) changes so stale state never lingers.
  createEffect(on([() => props.path, code], () => setActiveIndex(0)));
  // Keep the active index in range as the query narrows the match set.
  createEffect(() => {
    if (activeIndex() >= matches().length) setActiveIndex(0);
  });
  // Scroll the active match into view whenever it (or the query) changes.
  createEffect(() => {
    activeIndex();
    segments();
    if (kind() !== "code" || !findOpen()) return;
    queueMicrotask(() =>
      codeRef?.querySelector<HTMLElement>(".preview-find-match.is-active")?.scrollIntoView({
        block: "center",
        inline: "nearest",
      }),
    );
  });

  const step = (dir: 1 | -1) => {
    const n = matches().length;
    if (n) setActiveIndex(stepMatchIndex(activeIndex(), n, dir));
  };

  const closeFind = () => {
    setFindOpen(false);
    rootRef?.focus();
  };

  const countLabel = () => {
    if (!query()) return "";
    const n = matches().length;
    if (n === 0) return "No results";
    return `${activeIndex() + 1}/${n}${capped() ? "+" : ""}`;
  };

  // Focus the input whenever the code find bar opens (element mounts after the signal flips).
  createEffect(() => {
    if (findOpen() && kind() === "code") {
      queueMicrotask(() => {
        inputRef?.focus();
        inputRef?.select();
      });
    }
  });

  // Cmd/Ctrl+F on the focused preview. Capture phase + stop/preventDefault so it wins before
  // App.tsx's window-level shortcut handler and (dev) the browser's native find.
  const onFindKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (!matchesKeybinding(e, settings.keybindings.find)) return;
    const k = kind();
    if (k === "image" || k === "external") return; // no text — graceful no-op

    e.preventDefault();
    e.stopPropagation();
    if (k === "pdf") {
      setFindOpen(true);
      pdfRef?.focus(); // hand the keyboard to the embedded viewer so its own find can engage
      return;
    }
    // code/text
    if (findOpen()) {
      inputRef?.focus();
      inputRef?.select();
    } else {
      setFindOpen(true);
    }
  };
  onMount(() => {
    rootRef?.addEventListener("keydown", onFindKey, true);
    onCleanup(() => rootRef?.removeEventListener("keydown", onFindKey, true));
    // Focus the root so Cmd+F works immediately, before any click (mirrors Editor.tsx).
    queueMicrotask(() => rootRef?.focus());
  });

  // Resolve to an absolute path (backend, filename-first) then hand off to the OS opener.
  async function openExternal(reveal: boolean) {
    try {
      const { path } = await api.absPath(props.path);
      const ok = await (reveal ? revealPath(path) : openPathInDefaultApp(path));
      if (!ok) pushToast("Couldn't open — see console");
    } catch (e) {
      pushToast(`Couldn't open: ${(e as Error).message}`);
    }
  }

  return (
    <div class="preview-app" tabindex={-1} ref={rootRef}>
      <div class="preview-bar">
        <span class="preview-name">
          <Icon value={HEADER_ICON[kind()]} size={14} />
          <span class="preview-name-text">{name()}</span>
        </span>
        <div class="preview-actions">
          <Show when={annotatable()}>
            <IconTextButton icon="PenTool" onClick={() => props.onOpen(annotatePath(props.path))}>
              ANNOTATE
            </IconTextButton>
          </Show>
          <Show when={isTauri()}>
            <IconTextButton icon="ExternalLink" onClick={() => void openExternal(false)}>
              OPEN IN DEFAULT APP
            </IconTextButton>
            <IconTextButton icon="FolderOpen" onClick={() => void openExternal(true)}>
              REVEAL
            </IconTextButton>
          </Show>
        </div>
      </div>

      <div class="preview-body">
        {/* Find bar / note, overlaid top-right of the body (never for image/external). */}
        <Show when={findOpen() && (kind() === "code" || kind() === "pdf")}>
          <Switch>
            <Match when={kind() === "code"}>
              <div class="preview-find" onKeyDown={(e) => e.stopPropagation()}>
                <input
                  ref={inputRef}
                  class="preview-find-input"
                  placeholder="Find"
                  aria-label="Find in file"
                  value={query()}
                  onInput={(e) => {
                    setActiveIndex(0);
                    setQuery(e.currentTarget.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      step(e.shiftKey ? -1 : 1);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      closeFind();
                    }
                  }}
                />
                <span
                  class="preview-find-count"
                  classList={{ "is-empty": query() !== "" && matches().length === 0 }}
                >
                  {countLabel()}
                </span>
                <IconButton
                  icon="ChevronUp"
                  label="Previous match (Shift+Enter)"
                  iconSize={15}
                  disabled={matches().length === 0}
                  onClick={() => {
                    step(-1);
                    inputRef?.focus();
                  }}
                />
                <IconButton
                  icon="ChevronDown"
                  label="Next match (Enter)"
                  iconSize={15}
                  disabled={matches().length === 0}
                  onClick={() => {
                    step(1);
                    inputRef?.focus();
                  }}
                />
                <button
                  type="button"
                  class="preview-find-case"
                  classList={{ "is-active": caseSensitive() }}
                  title="Match case"
                  aria-label="Match case"
                  aria-pressed={caseSensitive()}
                  onClick={() => {
                    setCaseSensitive((v) => !v);
                    inputRef?.focus();
                  }}
                >
                  Aa
                </button>
                <IconButton icon="X" label="Close (Esc)" iconSize={15} onClick={closeFind} />
              </div>
            </Match>
            <Match when={kind() === "pdf"}>
              {/* No text-layer access to an <iframe> PDF — point at the viewer's own find. */}
              <div class="preview-find preview-find-note" onKeyDown={(e) => e.stopPropagation()}>
                <Icon value="Search" size={14} />
                <span class="preview-find-note-text">
                  Search the PDF with the viewer's own Find — click the document, then Cmd/Ctrl+F.
                </span>
                <IconButton icon="X" label="Dismiss" iconSize={15} onClick={closeFind} />
              </div>
            </Match>
          </Switch>
        </Show>

        <Switch>
          <Match when={kind() === "image"}>
            <img class="preview-image" src={assetUrl()} alt={name()} />
          </Match>
          <Match when={kind() === "pdf"}>
            {/* Full-pane embed of the browser's native PDF viewer (FitH so it fills width). */}
            <iframe ref={pdfRef} class="preview-pdf" src={`${assetUrl()}#view=FitH`} title={name()} />
          </Match>
          <Match when={kind() === "code"}>
            <Show when={!code.loading} fallback={<Loading />}>
              <pre class="preview-code" tabindex={0} ref={codeRef}>
                <Show when={segments()} fallback={code() ?? ""}>
                  <For each={segments()!}>
                    {(seg) =>
                      seg.matchIndex >= 0 ? (
                        <mark
                          class="preview-find-match"
                          classList={{ "is-active": seg.matchIndex === activeIndex() }}
                        >
                          {seg.text}
                        </mark>
                      ) : (
                        seg.text
                      )
                    }
                  </For>
                </Show>
              </pre>
            </Show>
          </Match>
          <Match when={kind() === "external"}>
            <div class="preview-external">
              <EmptyState title="Preview not available">
                {`This ${extLabel(name())} file can't be previewed here.`}
                {isTauri() ? " Open it in its default app to view or edit it." : " Open it externally to view or edit it."}
              </EmptyState>
              <Show when={isTauri()}>
                <IconTextButton icon="ExternalLink" onClick={() => void openExternal(false)}>
                  OPEN IN DEFAULT APP
                </IconTextButton>
              </Show>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}

/** Uppercased extension for the "This .PSD file …" copy, or "binary" when there's none. */
function extLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `.${name.slice(dot + 1).toUpperCase()}` : "binary";
}
