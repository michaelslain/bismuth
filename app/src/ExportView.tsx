// app/src/ExportView.tsx
import { createSignal, createResource, For, Show, createEffect } from "solid-js";
import { api } from "./api";
import { Icon } from "./icons/Icon";
import { Chip } from "./ui/Chip";
import { IconTextButton } from "./ui/IconTextButton";
import { pushToast } from "./Toast";
import { formatsFor } from "./export/formats";
import { renderExport, renderPreview } from "./export/exporters";
import { drawingToPng } from "./export/drawingRaster";
import { downloadFile } from "./export/download";
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
  html: "Code2",
  md: "Hash",
  png: "Image",
};
const THEMES: ExportTheme[] = ["light", "dark"];
const THEME_LABEL: Record<ExportTheme, string> = { dark: "Midnight", light: "Paper" };
const THEME_SWATCH: Record<ExportTheme, string> = { light: "#f7f6f2", dark: "#0D0E16" };

const deps: ExportDeps = {
  read: (p) => api.read(p),
  resolveRows: (spec) => api.resolveRows(spec),
  htmlToPdf,
  htmlToPng,
  drawingToPng,
};

export function ExportView(props: { path: string }) {
  const formats = () => formatsFor(props.path);
  const [format, setFormat] = createSignal<ExportFormat>(formats()[0] ?? "html");
  const [theme, setTheme] = createSignal<ExportTheme>("dark");
  const [busy, setBusy] = createSignal(false);

  // Preview only — cheap, no byte/PDF generation, so switching format or theme is instant.
  const [result] = createResource(
    () => [props.path, format(), theme()] as const,
    async ([path, fmt, thm]) => renderPreview(path, fmt, deps, thm),
  );

  createEffect(() => {
    const f = formats();
    if (!f.includes(format())) setFormat(f[0] ?? "html");
  });

  const doExport = async () => {
    setBusy(true);
    try {
      const r = await renderExport(props.path, format(), deps, theme());
      await downloadFile(r.filename, r.bytes, r.mime);
      pushToast(`Exported ${r.filename} to Downloads`);
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
            EXPORT {LABEL[format()].toUpperCase()}
          </IconTextButton>
        </div>
      </div>
    </div>
  );
}
