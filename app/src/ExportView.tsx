// app/src/ExportView.tsx
import { createSignal, createResource, For, Show, createEffect } from "solid-js";
import { api } from "./api";
import { Icon } from "./icons/Icon";
import { TextButton } from "./ui/TextButton";
import { pushToast } from "./Toast";
import { formatsFor } from "./export/formats";
import { renderExport, renderPreview } from "./export/exporters";
import { htmlToPdf } from "./export/htmlToPdf";
import { drawingToPng } from "./export/drawingRaster";
import { downloadFile } from "./export/download";
import type { ExportFormat, ExportTheme, ExportDeps } from "./export/types";
import "./ExportView.css";

const LABEL: Record<ExportFormat, string> = { html: "HTML", pdf: "PDF", md: "MARKDOWN", png: "PNG" };
const THEMES: ExportTheme[] = ["dark", "light"];
const THEME_LABEL: Record<ExportTheme, string> = { dark: "DARK", light: "LIGHT" };

const deps: ExportDeps = {
  read: (p) => api.read(p),
  resolveRows: (spec) => api.resolveRows(spec),
  htmlToPdf,
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
    <div class="export-view">
      <div class="export-bar">
        <div class="export-formats">
          <For each={formats()}>
            {(f) => (
              <TextButton
                variant={format() === f ? "selected" : "unselected"}
                onClick={() => setFormat(f)}
              >
                {LABEL[f]}
              </TextButton>
            )}
          </For>
        </div>
        <div class="export-formats export-themes">
          <For each={THEMES}>
            {(t) => (
              <TextButton
                variant={theme() === t ? "selected" : "unselected"}
                onClick={() => setTheme(t)}
              >
                {THEME_LABEL[t]}
              </TextButton>
            )}
          </For>
        </div>
        <TextButton class="export-go" disabled={busy()} onClick={doExport}>
          <Icon value="Download" size={14} /> EXPORT
        </TextButton>
      </div>
      <div class="export-preview">
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
  );
}
