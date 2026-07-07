// app/src/PreviewView.tsx
// Read-only PREVIEW tab for non-note files: images, PDFs, and code/text open here by default
// (a lighter alternative to the `.draw` markup surface). Images + PDFs expose an "Annotate"
// button that hands off to that markup surface (::annotate:); every kind exposes "Open in
// default app" / "Reveal" (Tauri) so binary formats we can't render (PSD/Figma/…) are still
// reachable in Photoshop/Figma/etc. Routing lives in PaneContent; classification in previewKind.
import { createResource, Match, Show, Switch } from "solid-js";
import { api } from "./api";
import { previewKind, type PreviewKind } from "./preview/previewKind";
import { annotatePath } from "./tabIds";
import { Icon } from "./icons/Icon";
import { IconTextButton } from "./ui/IconTextButton";
import { EmptyState, Loading } from "./ui/EmptyState";
import { isTauri } from "./nativeMenu";
import { openPathInDefaultApp, revealPath } from "./appWindow";
import { pushToast } from "./Toast";
import "./PreviewView.css";

const HEADER_ICON: Record<PreviewKind, string> = {
  image: "Image",
  pdf: "FileText",
  code: "Code",
  external: "File",
};

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
    <div class="preview-app">
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
        <Switch>
          <Match when={kind() === "image"}>
            <img class="preview-image" src={assetUrl()} alt={name()} />
          </Match>
          <Match when={kind() === "pdf"}>
            {/* Full-pane embed of the browser's native PDF viewer (FitH so it fills width). */}
            <iframe class="preview-pdf" src={`${assetUrl()}#view=FitH`} title={name()} />
          </Match>
          <Match when={kind() === "code"}>
            <Show when={!code.loading} fallback={<Loading />}>
              <pre class="preview-code">{code() ?? ""}</pre>
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
