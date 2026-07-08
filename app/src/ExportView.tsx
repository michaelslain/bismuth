// app/src/ExportView.tsx
import { createSignal, createResource, createEffect, For, Show } from "solid-js";
import { api } from "./api";
import { settings } from "./settings";
import { Icon } from "./icons/Icon";
import { Chip } from "./ui/Chip";
import { IconTextButton } from "./ui/IconTextButton";
import { TextInput } from "./ui/TextInput";
import { pushToast } from "./Toast";
import { isTauri } from "./nativeMenu";
import { pickFile, pickFolder } from "./appWindow";
import { formatsForOptions, ext } from "./export/formats";
import { defaultModeForView, PDF_FONT_SIZES, DEFAULT_PDF_FONT_SIZE } from "./export/options";
import { readThemePalette } from "./export/resolvePalette";
import { renderExport, renderPreview } from "./export/exporters";
import { pageSections } from "./export/pageBreaks";
import { drawingToPng } from "./export/drawingRaster";
import { deliverFile, writeToFolder, type Delivery } from "./export/download";
import { readCache, writeCache } from "./viewCache";
import type { ExportFormat, ExportTheme, ExportDeps, ExportOptions, RenderMode, CalSpan } from "./export/types";
import { parseFrontmatter } from "../../core/src/frontmatter";
import { parseBaseFile } from "../../core/src/bases/parse";
import type { ViewConfig } from "../../core/src/bases/types";
import "./ExportView.css";

// Defer jspdf + html2canvas (a few hundred KB) out of the entry/preview path: they
// only load when the user actually exports a PDF. The dynamic import resolves to the
// same `htmlToPdf` implementation, code-split into its own chunk (see vite manualChunks).
const htmlToPdf = (html: string): Promise<Uint8Array> =>
  import("./export/htmlToPdf").then((m) => m.htmlToPdf(html));
const htmlToPdfPages = (html: string): Promise<string[]> =>
  import("./export/htmlToPdf").then((m) => m.htmlToPdfPages(html));
const htmlToPng = (html: string): Promise<{ bytes: Uint8Array; dataUrl: string }> =>
  import("./export/htmlToPdf").then((m) => m.htmlToPng(html));

const LABEL: Record<ExportFormat, string> = { html: "HTML", pdf: "PDF", md: "Markdown", png: "PNG", csv: "CSV" };
const FORMAT_ICON: Record<ExportFormat, string> = {
  pdf: "FileText",
  html: "Code",
  md: "Hash",
  png: "Image",
  csv: "Table",
};
const THEMES: ExportTheme[] = ["light", "dark"];
const THEME_LABEL: Record<ExportTheme, string> = { dark: "Dark", light: "Light" };
const THEME_SWATCH: Record<ExportTheme, string> = { light: "#f7f6f2", dark: "#0D0E16" };

const MODES: RenderMode[] = ["visual", "data"];
const MODE_LABEL: Record<RenderMode, string> = { visual: "Visual", data: "Data" };
const MODE_ICON: Record<RenderMode, string> = { visual: "LayoutGrid", data: "Table" };
const SPANS: CalSpan[] = ["month", "week", "3day", "day"];
const SPAN_LABEL: Record<CalSpan, string> = { month: "Month", week: "Week", "3day": "3-day", day: "Day" };

// The vault-relative path of `abs` if it lives under `vaultRoot`, else null (the exporter
// reads vault-relative paths, so a file outside the vault can't be exported).
function toVaultRelative(abs: string, vaultRoot: string): string | null {
  const root = vaultRoot.replace(/\/+$/, "");
  if (!root || abs === root) return null;
  const prefix = root + "/";
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : null;
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

// Remember the last-chosen output folder + calendar span across sessions (browser
// localStorage; no schema).
const DEST_KEY = "bismuth.export.destFolder";
const SPAN_KEY = "bismuth.export.calSpan";
// Thin wrappers over viewCache's readCache/writeCache (JSON-encoded) rather than
// duplicating the try/catch + typeof-guard logic here.
const loadLs = (k: string): string => readCache<string>(k) ?? "";
const saveLs = (k: string, v: string): void => writeCache(k, v);

const deps: ExportDeps = {
  read: (p) => api.read(p),
  resolveRows: (spec) => api.resolveRows(spec),
  htmlToPdf,
  htmlToPdfPages,
  htmlToPng,
  drawingToPng,
  // The Vite `?inline`-bundled inline-CSS module (~400KB), dynamic-imported only when an
  // export actually contains math. Lives behind deps so exporters.ts stays bun-compilable.
  katexCss: async () => (await import("./export/katexCss")).katexInlineCss(),
};

const viewLabel = (v: ViewConfig, i: number): string => v.name || v.type || `View ${i + 1}`;

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
  const [destFolder, setDestFolder] = createSignal(loadLs(DEST_KEY));

  // Base-export options (ignored for non-base files). `mode` defaults per view kind but is
  // user-overridable; `viewIndex` picks which of the base's views; the calendar controls
  // anchor + size the grid.
  const [viewIndex, setViewIndex] = createSignal(0);
  const [mode, setMode] = createSignal<RenderMode>("data");
  const [userSetMode, setUserSetMode] = createSignal(false);
  const [calSpan, setCalSpan] = createSignal<CalSpan>((loadLs(SPAN_KEY) as CalSpan) || "month");
  const [calStart, setCalStart] = createSignal(""); // "" = today

  const [theme, setTheme] = createSignal<ExportTheme>("dark");
  const [busy, setBusy] = createSignal(false);

  // PDF-only: the body font size (pt). Default 12 (a standard document body size). Bigger sizes
  // render larger text and repaginate (taller content overflows onto more Letter pages).
  const [pdfFontSize, setPdfFontSize] = createSignal(DEFAULT_PDF_FONT_SIZE);

  // Non-base `.md` only: whether the note's leading YAML frontmatter is included in the
  // export. Default true (the historical behavior — a base's own frontmatter is config, never
  // rendered as content, so the control only makes sense for a plain note).
  const [includeFrontmatter, setIncludeFrontmatter] = createSignal(true);

  // Read the source file once per path: if it's a `type: base` md, expose its views so we
  // can offer a view picker + visual/data toggle. null for any non-base file (prose md /
  // sheet / draw) — none of the base controls render then.
  const [baseInfo] = createResource(srcPath, async (p) => {
    try {
      const text = await api.read(p);
      if (parseFrontmatter(text).data?.type !== "base") return null;
      const { config } = parseBaseFile(text, { name: baseName(p), path: p });
      return { views: config.views ?? [] };
    } catch {
      return null;
    }
  });

  const isBase = () => !!baseInfo();
  const views = () => baseInfo()?.views ?? [];
  const selectedView = (): ViewConfig | undefined => views()[viewIndex()];
  const showCalendar = () => isBase() && mode() === "visual" && selectedView()?.type === "calendar";

  // How many `<!-- pagebreak -->`-delimited pages a plain note has — only meaningful for a
  // non-base `.md` file. A PNG export of a multi-page note writes ONE file per page (see
  // export/pageBreaks.ts); this just powers a small heads-up in the panel so the user isn't
  // surprised by getting back several files instead of one.
  const [pageCount] = createResource(
    () => (!isBase() && ext(srcPath()) === "md" ? srcPath() : null),
    async (p) => {
      try {
        return pageSections(await api.read(p)).length;
      } catch {
        return 1;
      }
    },
  );

  // Reset per-file selections when the source changes (a different base may have fewer
  // views, and the mode default should re-derive from the new file's view kind).
  createEffect(() => {
    srcPath();
    setViewIndex(0);
    setUserSetMode(false);
  });

  // Default the render mode from the selected view's kind (calendar/cards/kanban/list →
  // "visual"), until the user manually picks a mode this session.
  createEffect(() => {
    const info = baseInfo();
    if (!info || userSetMode()) return;
    setMode(defaultModeForView(info.views[viewIndex()]?.type));
  });

  const buildOptions = (): ExportOptions => ({
    viewIndex: viewIndex(),
    mode: mode(),
    calSpan: calSpan(),
    calStart: calStart(),
    weekStartsOnMonday: settings.calendar.weekStartsOnMonday,
    militaryTime: settings.calendar.militaryTime,
    pdfFontSize: pdfFontSize(),
    // Resolve the live app theme (colors + font) so the export matches the app. Keyed into
    // the preview resource below via theme()/settings so it re-resolves on theme changes.
    palette: readThemePalette(theme()),
    includeFrontmatter: includeFrontmatter(),
  });

  const formats = () => formatsForOptions(srcPath(), isBase(), mode());
  const [format, setFormat] = createSignal<ExportFormat>(formats()[0] ?? "html");

  // Absolute vault root — used to seed the file picker and map a picked absolute path back
  // to the vault-relative path the exporter expects.
  const [vaultRoot] = createResource(() => api.terminalInfo().then((i) => i.vault).catch(() => ""));

  // Preview only — cheap, no byte/PDF generation, so switching source/format/options is
  // instant. Keyed on every option so the preview tracks the controls.
  const [result] = createResource(
    () =>
      [
        srcPath(),
        format(),
        theme(),
        viewIndex(),
        mode(),
        calSpan(),
        calStart(),
        settings.calendar.weekStartsOnMonday,
        includeFrontmatter(),
        pdfFontSize(),
      ] as const,
    async ([path, fmt, thm]) => renderPreview(path, fmt, deps, thm, buildOptions()),
  );

  // Keep the chosen format valid as the available set changes (mode flip adds/removes
  // md+csv; a different file changes the matrix entirely).
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
    saveLs(DEST_KEY, folder);
  };

  const pickMode = (m: RenderMode) => {
    setUserSetMode(true);
    setMode(m);
  };
  const pickSpan = (s: CalSpan) => {
    setCalSpan(s);
    saveLs(SPAN_KEY, s);
  };

  const doExport = async () => {
    commitSrc(); // flush an un-blurred edit so we export exactly what's in the field
    setBusy(true);
    try {
      const r = await renderExport(srcPath(), format(), deps, theme(), buildOptions());
      // A page-break-split PNG export (see export/pageBreaks.ts) produces several files —
      // `files` carries the full set; every other export is the single-result shape (`bytes`
      // + `filename` alone), so wrap it the same way for one write/download loop below.
      const files = r.files ?? [{ filename: r.filename, bytes: r.bytes }];
      const dest = destFolder().trim();
      if (dest && isTauri()) {
        // writeToFolder verifies each file exists after writing — a resolved-but-missing
        // write throws into the catch below instead of toasting a lie. Reveal only the FIRST
        // file in Finder so a multi-page export opens one window, not one per page.
        const written: string[] = [];
        for (let i = 0; i < files.length; i++) {
          written.push(await writeToFolder(dest, files[i].filename, files[i].bytes, undefined, i === 0));
        }
        pushToast(
          files.length > 1
            ? `Exported ${files.length} pages → ${dest}`
            : `Exported ${r.filename} → ${written[0]}`,
        );
      } else {
        // deliverFile: desktop = VERIFIED write into the OS Downloads dir (native Save
        // dialog as fallback; throws when nothing provably landed), resolving the real
        // absolute path AND revealing it in Finder; browser = anchor download. Toast the
        // verified path, not a guess. Reveal only the FIRST file so a multi-page export
        // opens a single Finder window with page 1 selected.
        const results: Delivery[] = [];
        for (let i = 0; i < files.length; i++) {
          results.push(await deliverFile(files[i].filename, files[i].bytes, r.mime, undefined, undefined, i === 0));
        }
        const first = results[0];
        if (first.via === "tauri") {
          const dir = first.path.slice(0, first.path.lastIndexOf("/")) || first.path;
          pushToast(files.length > 1 ? `Exported ${files.length} pages → ${dir}` : `Exported → ${first.path}`);
        } else {
          pushToast(
            files.length > 1
              ? `Exported ${files.length} pages to Downloads`
              : `Exported ${r.filename} to Downloads`,
          );
        }
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
        <div class="paper" classList={{ "paper-wide": isBase() && mode() === "visual" }}>
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
          <Icon value="Share" size={17} /> Export {isBase() ? "base" : "note"}
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
                saveLs(DEST_KEY, v.trim());
              }}
              placeholder="Downloads (default)"
              spellcheck={false}
            />
            <IconTextButton icon="FolderOpen" iconSize={13} onClick={browseDest}>
              BROWSE
            </IconTextButton>
          </div>
        </div>

        {/* Base-only: which view to export. */}
        <Show when={isBase() && views().length > 1}>
          <div class="field">
            <span class="flab">View</span>
            <div class="fopts">
              <For each={views()}>
                {(v, i) => (
                  <Chip selected={viewIndex() === i()} onClick={() => setViewIndex(i())}>
                    {viewLabel(v, i())}
                  </Chip>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Base-only: rendered view ("Visual") vs flat table ("Data"). */}
        <Show when={isBase()}>
          <div class="field">
            <span class="flab">Content</span>
            <div class="fopts">
              <For each={MODES}>
                {(m) => (
                  <Chip selected={mode() === m} icon={MODE_ICON[m]} iconSize={13} onClick={() => pickMode(m)}>
                    {MODE_LABEL[m]}
                  </Chip>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Calendar visual only: grid span + the day the grid starts at (default today). */}
        <Show when={showCalendar()}>
          <div class="field">
            <span class="flab">Calendar span</span>
            <div class="fopts">
              <For each={SPANS}>
                {(s) => (
                  <Chip selected={calSpan() === s} onClick={() => pickSpan(s)}>
                    {SPAN_LABEL[s]}
                  </Chip>
                )}
              </For>
            </div>
          </div>
          <div class="field">
            <span class="flab">Start day</span>
            <div class="path-row">
              <input
                type="date"
                class="path-input exp-date"
                value={calStart()}
                onInput={(e) => setCalStart(e.currentTarget.value)}
              />
              <Show when={calStart()}>
                <IconTextButton icon="RotateCcw" iconSize={13} onClick={() => setCalStart("")}>
                  TODAY
                </IconTextButton>
              </Show>
            </div>
          </div>
        </Show>

        {/* Plain note only (a base's frontmatter is config, never rendered content): whether
            the YAML frontmatter block is included in md/html/pdf/png output. */}
        <Show when={!isBase() && ext(srcPath()) === "md"}>
          <div class="field">
            <span class="flab">Frontmatter</span>
            <div class="fopts">
              <Chip selected={includeFrontmatter()} onClick={() => setIncludeFrontmatter(!includeFrontmatter())}>
                Include frontmatter
              </Chip>
            </div>
          </div>
        </Show>

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
          {/* PNG can't hold more than one page, so a page-broken note exports as N separate
              files (note-1.png, note-2.png, …) instead of one — flag that up front. */}
          <Show when={format() === "png" && (pageCount() ?? 1) > 1}>
            <span class="exp-hint">
              {pageCount()} pages (page breaks) → exports as {pageCount()} separate PNG files
            </span>
          </Show>
        </div>

        {/* PDF only: body font size (pt). Larger sizes render bigger text and repaginate. */}
        <Show when={format() === "pdf"}>
          <div class="field">
            <span class="flab">Font size</span>
            <div class="fopts">
              <For each={PDF_FONT_SIZES}>
                {(sz) => (
                  <Chip selected={pdfFontSize() === sz} onClick={() => setPdfFontSize(sz)}>
                    {sz}pt
                  </Chip>
                )}
              </For>
            </div>
          </div>
        </Show>

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
