// app/src/ExportView.tsx
import { createSignal, createResource, For, Show, createEffect } from "solid-js";
import { api } from "./api";
import { Icon } from "./icons/Icon";
import { Chip } from "./ui/Chip";
import { IconTextButton } from "./ui/IconTextButton";
import { TextInput } from "./ui/TextInput";
import { pushToast } from "./Toast";
import { isTauri } from "./nativeMenu";
import { pickFile, pickFolder } from "./appWindow";
import { formatsFor } from "./export/formats";
import { renderExport, renderPreview } from "./export/exporters";
import { drawingToPng } from "./export/drawingRaster";
import { downloadFile, writeToFolder } from "./export/download";
import type { ExportFormat, ExportTheme, ExportDeps } from "./export/types";
import "./ExportView.css";

// Defer jspdf + html2canvas (a few hundred KB) out of the entry/preview path: they
// only load when the user actually exports a PDF. The dynamic import resolves to the
// same `htmlToPdf` implementation, code-split into its own chunk (see vite manualChunks).
const htmlToPdf = (html: string): Promise<Uint8Array> =>
  import("./export/htmlToPdf").then((m) => m.htmlToPdf(html));
const htmlToPng = (html: string): Promise<{ bytes: Uint8Array; dataUrl: string }> =>
  import("./export/htmlToPdf").then((m) => m.htmlToPng(html));

const LABEL: Record<ExportFormat, string> = { html: "HTML", pdf: "PDF", md: "Markdown", png: "PNG" };
const FORMAT_ICON: Record<ExportFormat, string> = {
  pdf: "FileText",
  html: "Code",
  md: "Hash",
  png: "Image",
};
const THEMES: ExportTheme[] = ["light", "dark"];
const THEME_LABEL: Record<ExportTheme, string> = { dark: "Dark", light: "Light" };
const THEME_SWATCH: Record<ExportTheme, string> = { light: "#f7f6f2", dark: "#0D0E16" };

// The vault-relative path of `abs` if it lives under `vaultRoot`, else null (the exporter
// reads vault-relative paths, so a file outside the vault can't be exported).
function toVaultRelative(abs: string, vaultRoot: string): string | null {
  const root = vaultRoot.replace(/\/+$/, "");
  if (!root || abs === root) return null;
  const prefix = root + "/";
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : null;
}

// Remember the last-chosen output folder across sessions (browser localStorage; no schema).
const DEST_KEY = "oa.export.destFolder";
const loadDest = (): string => {
  try {
    return localStorage.getItem(DEST_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveDest = (v: string): void => {
  try {
    v ? localStorage.setItem(DEST_KEY, v) : localStorage.removeItem(DEST_KEY);
  } catch {
    /* private mode / no storage — keep it in-memory only */
  }
};

const deps: ExportDeps = {
  read: (p) => api.read(p),
  resolveRows: (spec) => api.resolveRows(spec),
  htmlToPdf,
  htmlToPng,
  drawingToPng,
  // The Vite `?inline`-bundled inline-CSS module (~400KB), dynamic-imported only when an
  // export actually contains math. Lives behind deps so exporters.ts stays bun-compilable.
  katexCss: async () => (await import("./export/katexCss")).katexInlineCss(),
};

export function ExportView(props: { path: string }) {
  // The "input path" — which file to export. Defaults to the file the tab was opened for,
  // but can be re-pointed at any other vault file via the picker / text field.
  //
  // `srcPath` is the COMMITTED source that drives the preview resource; `srcDraft` is the
  // live text-field value. They're separate so typing doesn't refetch the preview on every
  // keystroke — refetching would re-run the resource under the <Suspense> in PaneContent,
  // detaching this subtree and dropping the input's focus mid-word. We commit the draft on
  // blur / Enter (and immediately when chosen via the native picker).
  const [srcPath, setSrcPath] = createSignal(props.path);
  const [srcDraft, setSrcDraft] = createSignal(props.path);
  const commitSrc = () => {
    const v = srcDraft().trim();
    if (v && v !== srcPath()) setSrcPath(v);
  };
  // The "output path" — destination folder. Empty = Downloads (the previous behavior).
  const [destFolder, setDestFolder] = createSignal(loadDest());

  const formats = () => formatsFor(srcPath());
  const [format, setFormat] = createSignal<ExportFormat>(formats()[0] ?? "html");
  const [theme, setTheme] = createSignal<ExportTheme>("dark");
  const [busy, setBusy] = createSignal(false);

  // Absolute vault root — used to seed the file picker and map a picked absolute path back
  // to the vault-relative path the exporter expects.
  const [vaultRoot] = createResource(() => api.terminalInfo().then((i) => i.vault).catch(() => ""));

  // Preview only — cheap, no byte/PDF generation, so switching source/format/theme is instant.
  const [result] = createResource(
    () => [srcPath(), format(), theme()] as const,
    async ([path, fmt, thm]) => renderPreview(path, fmt, deps, thm),
  );

  createEffect(() => {
    const f = formats();
    if (!f.includes(format())) setFormat(f[0] ?? "html");
  });

  const browseSource = async () => {
    if (!isTauri()) {
      pushToast("Browsing for a file needs the desktop app — type a vault path here in the browser");
      return;
    }
    const abs = await pickFile({
      defaultPath: vaultRoot() || undefined,
      title: "Choose file to export",
      filters: [{ name: "Notes & docs", extensions: ["md", "sheet", "draw"] }],
    });
    if (!abs) return;
    const rel = toVaultRelative(abs, vaultRoot() ?? "");
    if (!rel) {
      pushToast("Pick a file inside your vault");
      return;
    }
    setSrcDraft(rel);
    setSrcPath(rel);
  };

  const browseDest = async () => {
    if (!isTauri()) {
      pushToast("Choosing a folder needs the desktop app — browser exports go to Downloads");
      return;
    }
    const folder = await pickFolder();
    if (!folder) return;
    setDestFolder(folder);
    saveDest(folder);
  };

  const doExport = async () => {
    commitSrc(); // flush an un-blurred edit so we export exactly what's in the field
    setBusy(true);
    try {
      const r = await renderExport(srcPath(), format(), deps, theme());
      const dest = destFolder().trim();
      if (dest && isTauri()) {
        const written = await writeToFolder(dest, r.filename, r.bytes);
        pushToast(`Exported ${r.filename} → ${written}`);
      } else {
        await downloadFile(r.filename, r.bytes, r.mime);
        pushToast(
          dest
            ? `Exported ${r.filename} to Downloads (folder export needs the desktop app)`
            : `Exported ${r.filename} to Downloads`,
        );
      }
    } catch (e) {
      pushToast(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="exp">
      <div class="exppreview">
        <div class="paper">
          <Show
            when={!result.error}
            fallback={<div class="export-empty">Preview failed: {(result.error as Error)?.message}</div>}
          >
            <Show when={result()} fallback={<div class="export-empty">Rendering preview…</div>}>
              {(r) => (
                <Show
                  when={r().previewImg}
                  fallback={
                    <iframe
                      class="export-frame"
                      sandbox="allow-same-origin"
                      srcdoc={r().previewHtml ?? ""}
                    />
                  }
                >
                  <img class="export-img" src={r().previewImg} alt="preview" />
                </Show>
              )}
            </Show>
          </Show>
        </div>
      </div>

      <div class="exppanel">
        <div class="exp-title">
          <Icon value="Share" size={17} /> Export note
        </div>

        <div class="field">
          <span class="flab">Input path</span>
          <div class="path-row">
            <TextInput
              class="path-input"
              value={srcDraft()}
              onInput={setSrcDraft}
              onBlur={commitSrc}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitSrc();
                }
              }}
              placeholder="vault-relative path, e.g. notes/idea.md"
              spellcheck={false}
            />
            <IconTextButton icon="FolderOpen" iconSize={13} onClick={browseSource}>
              BROWSE
            </IconTextButton>
          </div>
        </div>

        <div class="field">
          <span class="flab">Output path</span>
          <div class="path-row">
            <TextInput
              class="path-input"
              value={destFolder()}
              onInput={(v) => {
                setDestFolder(v);
                saveDest(v.trim());
              }}
              placeholder="Downloads (default)"
              spellcheck={false}
            />
            <IconTextButton icon="FolderOpen" iconSize={13} onClick={browseDest}>
              BROWSE
            </IconTextButton>
          </div>
        </div>

        <div class="field">
          <span class="flab">Format</span>
          <div class="fopts">
            <For each={formats()}>
              {(f) => (
                <Chip selected={format() === f} icon={FORMAT_ICON[f]} iconSize={13} onClick={() => setFormat(f)}>
                  {LABEL[f]}
                </Chip>
              )}
            </For>
          </div>
        </div>

        <div class="field">
          <span class="flab">Theme</span>
          <div class="fopts">
            <For each={THEMES}>
              {(t) => (
                <Chip selected={theme() === t} onClick={() => setTheme(t)}>
                  <span class="theme-swatch" style={{ background: THEME_SWATCH[t] }} />
                  {THEME_LABEL[t]}
                </Chip>
              )}
            </For>
          </div>
        </div>

        <div class="exp-spacer" />

        <div class="exp-footer">
          <IconTextButton icon="Download" iconSize={14} disabled={busy()} onClick={doExport}>
            EXPORT
          </IconTextButton>
        </div>
      </div>
    </div>
  );
}
