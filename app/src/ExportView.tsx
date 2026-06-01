// app/src/ExportView.tsx
import { createSignal, createResource, For, Show, createEffect } from "solid-js";
import { api } from "./api";
import { Icon } from "./icons/Icon";
import { pushToast } from "./Toast";
import { formatsFor } from "./export/formats";
import { renderExport } from "./export/exporters";
import { htmlToPdf } from "./export/htmlToPdf";
import { drawingToPng } from "./export/drawingRaster";
import { downloadFile } from "./export/download";
import type { ExportFormat, ExportDeps } from "./export/types";
import "./ExportView.css";

const LABEL: Record<ExportFormat, string> = { html: "HTML", pdf: "PDF", md: "Markdown", png: "PNG" };

const deps: ExportDeps = {
  read: (p) => api.read(p),
  resolveRows: (basePath) => api.resolveRows({ kind: "base", ref: `[[${basePath}]]` }),
  htmlToPdf,
  drawingToPng,
};

export function ExportView(props: { path: string }) {
  const formats = () => formatsFor(props.path);
  const [format, setFormat] = createSignal<ExportFormat>(formats()[0] ?? "html");
  const [busy, setBusy] = createSignal(false);

  const [result] = createResource(
    () => [props.path, format()] as const,
    async ([path, fmt]) => renderExport(path, fmt, deps),
  );

  createEffect(() => {
    const f = formats();
    if (!f.includes(format())) setFormat(f[0] ?? "html");
  });

  const doExport = async () => {
    setBusy(true);
    try {
      const r = await renderExport(props.path, format(), deps);
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
              <button
                class="export-format"
                classList={{ active: format() === f }}
                onClick={() => setFormat(f)}
              >
                {LABEL[f]}
              </button>
            )}
          </For>
        </div>
        <button class="export-go" disabled={busy()} onClick={doExport}>
          <Icon value="Download" size={14} /> Export
        </button>
      </div>
      <div class="export-preview">
        <Show when={result()} fallback={<div class="export-empty">Rendering preview…</div>}>
          {(r) => (
            <Show
              when={r().previewImg}
              fallback={<iframe class="export-frame" srcdoc={r().previewHtml ?? ""} />}
            >
              <img class="export-img" src={r().previewImg} alt="preview" />
            </Show>
          )}
        </Show>
      </div>
    </div>
  );
}
