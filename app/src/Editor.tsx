// app/src/Editor.tsx
import { createEffect, createMemo, onCleanup, Show } from "solid-js";
import { EditorView, keymap, drawSelection, lineNumbers } from "@codemirror/view";
import { EditorState, Annotation } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from "@codemirror/commands";
import { startCompletion, acceptCompletion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { yaml } from "@codemirror/lang-yaml";
import { syntaxHighlighting, HighlightStyle, indentUnit } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { api, apiBase } from "./api";
import { lastChange } from "./serverVersion";
import { primeNoteCache } from "./noteCache";
import { livePreview } from "./editor/livePreview";
import { requestRelint } from "./editor/relint";
import { notePathFacet } from "./editor/tableState";
import { foldBlocks } from "./editor/foldBlocks";
import { mathBlock } from "./editor/mathBlock";
import { queryBlock } from "./editor/queryBlock";
import { embedBlock } from "./editor/embedBlock";
import { vaultCompletion } from "./editor/autocomplete";
import { iconNames } from "./icons/registry";
import { settingsCompletion, type VaultPath } from "./editor/settingsComplete";
import { editorContextMenu } from "./editor/contextMenu";
import { harperSpellcheck } from "./editor/harper";
import { yamlSchema, isInFrontmatter } from "./editor/yamlSchema";
import { frontmatterBodyRange } from "./editor/frontmatterUtils";
import { normalizeFrontmatterSpacing, minimalChange } from "./editor/normalizeFrontmatter";
import { codeHighlightStyle } from "./editor/codeHighlight";
import { isSettingsBuffer } from "./editor/settingsBuffer";
import { SETTINGS_SCHEMA } from "../../core/src/schema/settingsSchema";
import { propertyRegistry } from "./propertyRegistry";
import { parseWikilink, resolveNotePath, type NoteCandidate } from "./editor/wikilink";
import { findBareUrls } from "./editor/urls";
import { openExternalUrl } from "./appWindow";
import { settings } from "./settings";
import { pushToast } from "./Toast";
import { registerEditor, trackEditor, unregisterEditor } from "./editorRegistry";
import { saveScroll, loadScroll } from "./scrollMemory";
import { NoteTitle } from "./NoteTitle";
import "./Editor.css";

// Marks a transaction as "content pulled in from disk" rather than a user edit,
// so the autosave listener can skip it. Without this, reloading an external
// change triggers a save that writes the file back to itself — an endless loop
// against a file something else (e.g. a status-file writer) keeps rewriting.
const ExternalReload = Annotation.define<boolean>();

// Prose font/size and selection tint come from CSS variables (set by App.tsx from
// the Appearance settings), so they update live without rebuilding the editor.
const editorTheme = EditorView.theme({
  // Prose reads as serif Lora near --fg with a soft tone (design: color-mix(hi 86%, lo)),
  // centered in a 760px reading column to match the redesigned editor column.
  "&": { backgroundColor: "transparent", color: "color-mix(in srgb, var(--fg) 88%, var(--text-muted))", height: "100%" },
  // Center the gutter + content TOGETHER (justify-content on the flex scroller) rather
  // than centering .cm-content alone — otherwise the line-number gutter stays pinned to
  // the far left while the text floats to the middle, leaving a huge empty indent.
  ".cm-scroller": { fontFamily: "var(--editor-font)", fontSize: "var(--editor-font-size)", lineHeight: "var(--prose-line-height, 1.65)", overflow: "auto", justifyContent: "center", padding: "0 40px" },
  // The horizontal reading-column inset lives on the SCROLLER (padding), NOT on
  // .cm-content. If it were content padding, CodeMirror's drawSelection would paint
  // multi-line selection across that padding too — a "phantom indent" left of the
  // text. Keeping .cm-content flush to the text column means the selection box IS the
  // text column. (Don't set position:relative here — it corrupts CM's selection-rect
  // geometry.) Code line numbers hang at -2.7em into the scroller padding.
  ".cm-content": { caretColor: "var(--fg)", padding: "8px 0 80px", maxWidth: "680px", width: "100%", boxSizing: "border-box" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--fg)",
    borderLeftWidth: "2px",
    transition: "left 70ms ease-out, top 70ms ease-out", // smooth glide
  },
  ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)" },
  // CodeMirror's baseTheme paints the FOCUSED selection with a high-specificity
  // selector (.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground,
  // a pale-lavender default). A plain "&.cm-focused .cm-selectionBackground" loses to
  // it — so match that exact selector here to keep the accent tint while focused.
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--accent) 38%, transparent)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "color-mix(in srgb, var(--fg) 35%, transparent)" },
  // Match .oa-popover exactly: same radius, padding, shadow, and UI font tokens —
  // CodeMirror owns this <ul><li> DOM, so we can't share the component, only the tokens.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "1px solid var(--border)",
    borderRadius: "var(--popover-radius)",
    backgroundColor: "var(--bg)",
    boxShadow: "var(--popover-shadow)",
    fontFamily: "var(--popover-font)",
    minWidth: "var(--popover-min-width)",
    overflow: "hidden",
    padding: "var(--popover-pad)",
  },
  // NOTE: two classes (.cm-tooltip.cm-tooltip-autocomplete) so these match CM's
  // own default li rule specificity and win — a single-class selector loses to it.
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "var(--popover-row-gap)",
    padding: "var(--popover-row-pad-y) var(--popover-row-pad-x)",
    borderRadius: "var(--popover-row-radius)",
    fontSize: "var(--popover-font-size)",
    lineHeight: "1.5",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--popover-selected-bg)",
    color: "var(--fg)",
  },
  ".cm-completionLabel": { flex: "1 1 auto" },
  ".cm-completionDetail": { marginLeft: "auto", paddingLeft: "12px", opacity: "var(--popover-detail-opacity)", fontStyle: "normal" },
  ".cm-tooltip.cm-completionInfo": {
    border: "1px solid var(--border)",
    borderRadius: "var(--popover-radius)",
    backgroundColor: "var(--bg)",
    color: "var(--fg)",
    boxShadow: "var(--popover-shadow)",
    padding: "8px 10px",
    maxWidth: "320px",
    fontSize: "12px",
    lineHeight: "1.5",
  },
});

// Config buffers (settings.yaml etc.) are CODE, not prose: monospace, tighter
// line-height. !important so it beats editorTheme's prose font (CM facet
// precedence is earlier-wins, and editorTheme comes first in the array).
const codeFontTheme = EditorView.theme({
  ".cm-scroller": { fontFamily: "'Monaspace Xenon', ui-monospace, monospace !important", lineHeight: "1.55" },
});

// YAML syntax colors pulled from the app theme so config files (settings.yaml)
// read as part of the app, not a generic code editor. Tints follow the Bismuth
// redesign: keys = accent, strings = green, numbers = gold, booleans = violet,
// comments = faint italic, structural punctuation = faint.
const yamlHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--faint)", fontStyle: "italic" },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: "var(--accent)" },
  { tag: [t.bool, t.atom, t.keyword], color: "var(--violet)" },
  { tag: [t.number, t.integer, t.float], color: "var(--gold)" },
  { tag: [t.string, t.special(t.string)], color: "var(--green)" },
  { tag: [t.separator, t.punctuation, t.bracket, t.brace], color: "var(--faint)" },
]);

// Vault template paths, fetched once and cached, for the settings.yaml `template:`
// autocomplete. Sync getter (CM completion sources run synchronously); the first call
// kicks off the fetch and returns [] until it lands, then subsequent popups see it.
let cachedTemplatePaths: string[] = [];
let templatesFetched = false;
function templatePaths(): string[] {
  if (!templatesFetched) {
    templatesFetched = true;
    void api.templates().then((ts) => { cachedTemplatePaths = ts.map((t) => t.path); }).catch(() => {});
  }
  return cachedTemplatePaths;
}

// Vault paths (folders + files) for the settings.yaml `path`-typed value autocomplete
// (e.g. dailyNotes `folder:`). Same sync-getter-with-background-fetch pattern as
// templatePaths above. Maps /tree entries to the {path, kind} shape rankPaths wants.
let cachedVaultPaths: VaultPath[] = [];
let vaultPathsFetched = false;
function vaultPaths(): VaultPath[] {
  if (!vaultPathsFetched) {
    vaultPathsFetched = true;
    void api.tree()
      .then((entries) => { cachedVaultPaths = entries.map((e) => ({ path: e.path, kind: e.kind })); })
      .catch(() => {});
  }
  return cachedVaultPaths;
}

// Filesystem paths for `scope:"fs"` value autocomplete (e.g. daemon `home:`). Unlike
// the vault tree, the candidate set depends on the partial path being typed, so this
// queries the backend per keystroke (it must readdir the real filesystem) rather than
// caching a fixed list. The completion source awaits the returned promise.
function fsPaths(value: string, only?: "dir" | "file"): Promise<VaultPath[]> {
  return api.listDir(value, only).catch(() => []);
}

// --- Attachment intake (paste / drag-drop) ----------------------------------
// Pasted clipboard images and dropped media files are COPIED into the vault's
// attachment folder (the default; ⌥-drop or attachments.onDrop:"reference" inserts a
// bare name instead) and an `![[basename]]` embed is inserted at the cursor. Resolution
// is filename-first server-side, so inserting the basename keeps the link portable.
const MIME_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/svg+xml": "svg", "image/avif": "avif", "image/bmp": "bmp",
};
const extFromMime = (mime: string): string => MIME_EXT[mime] ?? (mime.split("/")[1] || "bin");

const isEmbeddableFile = (f: File): boolean =>
  /^(image|audio|video)\//.test(f.type) || f.type === "application/pdf";

/** Vault-relative destination for a new attachment, honoring settings.attachments.folder
 *  ("" = vault root, "." = the current note's folder). */
function attachmentTarget(fileName: string, notePath: string | null): string {
  // Strip leading + trailing slashes so a stray `folder: /attachments` still lands
  // vault-relative (the backend would otherwise reject the absolute-looking path).
  const folder = settings.attachments.folder.trim().replace(/^\/+|\/+$/g, "");
  if (folder === ".") {
    const slash = (notePath ?? "").lastIndexOf("/");
    return (slash === -1 ? "" : (notePath ?? "").slice(0, slash + 1)) + fileName;
  }
  return folder ? `${folder}/${fileName}` : fileName;
}

/** Filename for a pasted clipboard image from the naming template (e.g. "Pasted image 20260603143012.png"). */
function pastedImageName(ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const tmpl = settings.attachments.naming || "Pasted image {timestamp}";
  return `${tmpl.replace("{timestamp}", stamp)}.${ext}`;
}

/** Replace the current selection with `text`, leaving the cursor just after it. */
function insertAtCursor(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
}

/** Read a file's bytes, upload into the attachment folder, then insert `![[basename]]` at
 *  the cursor. The arrayBuffer() read is INSIDE the try so a failed/unreadable blob toasts
 *  instead of escaping as an unhandled rejection. */
async function uploadAndInsert(view: EditorView, file: Blob, fileName: string, notePath: string | null): Promise<void> {
  try {
    const bytes = await file.arrayBuffer();
    const finalPath = await api.uploadAsset(attachmentTarget(fileName, notePath), bytes);
    insertAtCursor(view, `![[${finalPath.split("/").pop() ?? fileName}]]`);
  } catch (e) {
    pushToast(`Couldn't save attachment: ${(e as Error).message}`);
  }
}

export function Editor(props: { path: string | null; initialText?: string; onSaved: () => void; noteNames: () => NoteCandidate[]; tagNames: () => string[] }) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  // The text of our most recent write to the current buffer. Used to recognize the
  // SSE echo of our own save even after we've typed further, so we don't reload the
  // (now-stale) on-disk content over in-flight edits. Reset when the buffer switches.
  let lastSavedText: string | undefined;
  // True while the editor has local edits not yet flushed to disk (autosave is debounced).
  // The external-reload reconcile must NOT revert to disk during this window — disk is
  // stale and the pending save is about to overwrite it (this is what made table edits
  // "disappear on click-off, reappear on reload").
  let pendingSave = false;

  // Value-dedupe the path. props.path is read through a chain (active tab → pane tree →
  // leaf content) that re-emits whenever the tab object changes — e.g. on every pane
  // focus change. Without this memo the view effect below would re-run and rebuild the
  // CodeMirror view on each focus change, stealing focus mid-edit. The memo only emits
  // when the path string itself changes, so the view is rebuilt only on a real file switch.
  const currentPath = createMemo(() => props.path);

  const save = async (path: string, text: string) => {
    lastSavedText = text; // record before the await so a fast echo still matches
    await api.write(path, text);
    primeNoteCache(path, text); // keep the body cache warm so a reopen is instant
    props.onSaved();
    if (settings.vault.backupOnSave) api.backup(); // local-git snapshot; no-op when nothing changed
  };

  // The current buffer's path, tracked at component scope so the unload handler (added
  // once) can flush whatever buffer is open.
  let activePath: string | null = null;

  // Flush the debounced autosave NOW, so a reload / file-switch can't drop an edit still
  // sitting in the 800ms timer (e.g. a table cell committed on click-off right before you
  // reload). `keepalive` lets the PUT survive page unload, where a normal async write
  // would be cancelled.
  const flushSave = (keepalive: boolean): void => {
    if (!pendingSave || !view || !activePath) return;
    clearTimeout(saveTimer);
    const text = view.state.doc.toString();
    pendingSave = false;
    lastSavedText = text;
    if (keepalive) {
      try {
        void fetch(`${apiBase()}/file`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: activePath, contents: text }),
          keepalive: true,
        });
      } catch {
        /* best effort on unload */
      }
    } else {
      void save(activePath, text); // in-app navigation: a normal async write completes fine
    }
  };

  const onBeforeUnload = (): void => flushSave(true);
  if (typeof window !== "undefined") window.addEventListener("beforeunload", onBeforeUnload);
  onCleanup(() => { if (typeof window !== "undefined") window.removeEventListener("beforeunload", onBeforeUnload); });

  // Re-validate the open buffer when the property registry changes — e.g. you add
  // a property to settings.yaml's `properties:` section. CM linters only re-run on
  // doc changes, so an external registry update needs an explicit re-lint or the
  // note would keep showing stale "unknown property" marks.
  createEffect(() => {
    propertyRegistry(); // track: re-run whenever the registry signal updates
    if (view) requestRelint(view); // forceLinting alone no-ops on a settled linter
  });

  createEffect(async () => {
    const path = currentPath();
    activePath = path;
    // Flush a pending save, then destroy the previous view when this effect re-runs
    // (path changed or cleanup) — so switching files can't drop an unsaved edit.
    // Snapshot scrollTop first so a tab switch (which destroys this view) can restore
    // the reader's position when the buffer's editor is recreated. `path` is this run's
    // buffer; during cleanup it still names the view being torn down.
    onCleanup(() => {
      if (view && path) saveScroll(path, view.scrollDOM.scrollTop);
      flushSave(false);
      if (view) unregisterEditor(view);
      view?.destroy();
    });
    lastSavedText = undefined; // different buffer — forget the prior file's save text
    pendingSave = false;
    if (!path) return;

    // Prefer the body FileView already fetched (no second HTTP round-trip on open).
    // Fall back to reading when the Editor is used without it. Treat a missing file
    // as an empty note (new, not yet written).
    let text = "";
    if (props.initialText !== undefined) {
      text = props.initialText;
    } else {
      try {
        text = await api.read(path);
      } catch {
        text = "";
      }
    }
    // Guard: if the path changed while we were awaiting, discard this run.
    if (path !== currentPath()) return;

    // Read editor settings here so this effect re-runs (rebuilding the view) when
    // any of them change — that re-applies live preview / gutter / wrapping toggles.
    const ed = settings.editor;

    // Autosave: skip disk-pulled reloads so we don't loop against externally
    // rewritten files (e.g. DAEMON.md).
    const autosave = EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      if (u.transactions.some((tr) => tr.annotation(ExternalReload))) return;
      pendingSave = true; // local change not yet on disk → block reconcile-revert
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        // Auto-format on save: enforce one blank line between frontmatter and body. Apply
        // it to the LIVE editor via a minimal diff (so the cursor stays put and the fix is
        // visible immediately, not only after a reload). Annotated ExternalReload so this
        // programmatic edit doesn't re-trigger autosave. Notes only — not config buffers.
        const isMd = !path.endsWith(".yaml") && !path.endsWith(".yml");
        if (isMd && view) {
          const cur = view.state.doc.toString();
          const normalized = normalizeFrontmatterSpacing(cur);
          if (normalized !== cur) {
            view.dispatch({ changes: minimalChange(cur, normalized), annotations: ExternalReload.of(true) });
          }
        }
        const text = view ? view.state.doc.toString() : u.state.doc.toString();
        await save(path, text);
        // Clear only if nothing was typed during the write — else a newer edit is pending.
        if (view && view.state.doc.toString() === text) pendingSave = false;
      }, settings.editor.autoSaveDelay);
    });

    // Shared base for every buffer: editing, theme, gutters, autosave.
    const base = [
      history(),
      drawSelection(),
      // Pin indentation to 2 spaces everywhere so Tab/Shift-Tab (indentMore/indentLess),
      // pasted code, and the list-nesting depth math all agree. The depth calc in
      // foldBlocks/livePreview treats one level as 2 columns (and a literal tab as 2),
      // so tabSize must be 2 too — CodeMirror's default tabSize of 4 would render real
      // tab chars twice as wide as the depth they count for.
      indentUnit.of("  "),
      EditorState.tabSize.of(2),
      // Ctrl-Space manually opens the autocomplete menu (Mod-Space is Spotlight on Mac).
      // Tab accepts the active completion (acceptCompletion returns false when no popup is
      // open, so it falls through); otherwise Tab/Shift-Tab indent/dedent the selected
      // lines — which is how list items nest/un-nest (e.g. `- foo` → `  - foo`).
      keymap.of([
        { key: "Ctrl-Space", run: startCompletion },
        { key: "Tab", run: acceptCompletion },
        { key: "Tab", run: indentMore, shift: indentLess },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      editorTheme,
      ...(ed.lineWrapping ? [EditorView.lineWrapping] : []),
      autosave,
      // Right-click a spelling / grammar / property mark → the shared app menu.
      editorContextMenu(),
    ];

    // Config buffers render as YAML CODE — monospace, syntax-highlighted, NO
    // markdown rendering and NO spell/grammar check. settings.yaml additionally
    // validates the whole document against the fixed app-settings schema.
    const isYaml = path.endsWith(".yaml") || path.endsWith(".yml");
    // Auto-format on open: keep exactly one blank line between a note's frontmatter and
    // its body. Normalize the loaded text (so the editor shows it) and, if that changed
    // anything, write the reformat back so the file self-heals on disk. The editor doc
    // equals what we write, so the reconcile effect sees `current === onDisk` and the SSE
    // echo is a clean no-op. Notes only — config buffers (settings.yaml) aren't markdown.
    if (!isYaml) {
      const normalized = normalizeFrontmatterSpacing(text);
      if (normalized !== text) {
        text = normalized;
        lastSavedText = text; // recognize the SSE echo of this write as our own
        void api.write(path, text); // persist the reformat (best-effort; doc is the source of truth)
      }
    }
    // Warm the path/template completion caches on settings open (async fetch) so the
    // FIRST `path`-typed popup has data instead of an empty list while it loads.
    if (isYaml && isSettingsBuffer(path)) { void vaultPaths(); void templatePaths(); }
    const extensions = isYaml
      ? [
          ...base,
          // Code files (settings.yaml etc.) always show a line-number gutter — they
          // are code, so numbering is useful regardless of the prose-note toggle.
          lineNumbers(),
          yaml(),
          syntaxHighlighting(yamlHighlight),
          codeFontTheme,
          foldBlocks(() => path, "yaml", { hasGutter: true }),
          ...(isSettingsBuffer(path)
            ? [
                yamlSchema({ getSchema: () => SETTINGS_SCHEMA, mode: "settings" as const, resolveLink: () => true }),
                settingsCompletion(() => SETTINGS_SCHEMA, iconNames, templatePaths, vaultPaths, fsPaths),
              ]
            : []),
        ]
      : [
          // Note buffers: markdown + live preview, autocomplete, frontmatter
          // validation, and spell/grammar checking. The whole-note gutter stays
          // opt-in (prose), while fenced code blocks number themselves inline.
          ...base,
          ...(ed.lineNumbers ? [lineNumbers()] : []),
          markdown({ codeLanguages: languages }),
          syntaxHighlighting(codeHighlightStyle),
          queryBlock(() => path),
          embedBlock(props.noteNames),
          vaultCompletion({
            getNotes: props.noteNames,
            getTags: props.tagNames,
            getSchema: propertyRegistry,
            getIconNames: iconNames,
            inFrontmatter: isInFrontmatter,
          }),
          yamlSchema({
            getSchema: propertyRegistry,
            mode: "frontmatter",
            // Filename-based link resolution: a [[Target]] resolves when some note
            // candidate's label matches (wikilink semantics — name, not path).
            resolveLink: (target) => props.noteNames().some((n) => n.label === target),
          }),
          notePathFacet.of(path),
          // hasGutter tracks ed.lineNumbers so depth-0 chevrons clear the gutter when it's on;
          // safe to read here since this effect rebuilds the whole view when settings.editor changes.
          ...(ed.livePreview ? [livePreview, foldBlocks(() => path, "markdown", { hasGutter: ed.lineNumbers }), mathBlock()] : []),
          // Harper spell + grammar check, toggled by editor.spellcheck (default true).
          ...(ed.spellcheck ? [harperSpellcheck({ getBodyRange: frontmatterBodyRange })] : []),
        ];

    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text,
        extensions: [
          ...extensions,
          EditorView.domEventHandlers({
            focus: (_e, v) => { registerEditor(v); return false; },
            // Paste an image from the clipboard (e.g. a screenshot) → copy it into the
            // attachment folder and insert an embed. Non-image pastes fall through to
            // CodeMirror's normal text paste.
            paste: (e, view) => {
              const items = (e as ClipboardEvent).clipboardData?.items;
              if (!items) return false;
              for (const it of items) {
                if (it.kind === "file" && it.type.startsWith("image/")) {
                  const file = it.getAsFile();
                  if (!file) continue;
                  e.preventDefault();
                  void uploadAndInsert(view, file, pastedImageName(extFromMime(file.type)), path);
                  return true;
                }
              }
              return false;
            },
            // Allow dropping files onto the editor (the default would navigate away).
            dragover: (e) => {
              if ((e as DragEvent).dataTransfer?.types?.includes("Files")) e.preventDefault();
              return false;
            },
            // Drop an image/audio/video/PDF from outside → copy into the attachment folder
            // (default) and embed it. ⌥-drop or attachments.onDrop:"reference" inserts a bare
            // `![[name]]` reference instead (no copy). Move/reference-by-absolute-path are
            // desktop-only refinements (the browser can't read a dropped file's real path).
            drop: (e, view) => {
              const dt = (e as DragEvent).dataTransfer;
              const files = dt ? [...dt.files].filter(isEmbeddableFile) : [];
              if (files.length === 0) return false; // not a media drop — let CM handle text
              e.preventDefault();
              const pos = view.posAtCoords({ x: (e as DragEvent).clientX, y: (e as DragEvent).clientY });
              if (pos != null) view.dispatch({ selection: { anchor: pos } });
              const reference = (e as DragEvent).altKey || settings.attachments.onDrop === "reference";
              for (const f of files) {
                if (reference) {
                  insertAtCursor(view, `![[${f.name}]]`); // best-effort; resolves only if already in-vault
                } else {
                  void uploadAndInsert(view, f, f.name, path);
                }
              }
              return true;
            },
            mousedown: (e, view) => {
              // `false` = nearest-position mode: precise mode returns null when the click
              // lands between glyphs or on padding, which made links intermittently dead.
              const pos = view.posAtCoords({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }, false);
              if (pos == null) return false;
              const line = view.state.doc.lineAt(pos);
              // `(?<!!)` skips EMBEDS (`![[...]]`): clicking one while editing must not
              // navigate to it as a note (it's rendered media, not a link).
              for (const m of line.text.matchAll(/(?<!!)\[\[([^\]]+?)\]\]/g)) {
                const s = line.from + (m.index ?? 0), en = s + m[0].length;
                if (pos >= s && pos <= en) {
                  const { target } = parseWikilink(m[1]);
                  // Wikilinks are filename-based: resolve the basename to its real vault
                  // path so subfolder notes open (and highlight) correctly. An unresolved
                  // target opens as a new note at the typed name (read falls back to "").
                  const resolved = resolveNotePath(target, props.noteNames());
                  window.dispatchEvent(new CustomEvent("oa-open", { detail: (resolved ?? target) + ".md" }));
                  return true;
                }
              }
              // markdown links [text](url) — open the destination in the browser.
              for (const m of line.text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
                const s = line.from + (m.index ?? 0), en = s + m[0].length;
                if (pos >= s && pos <= en) {
                  void openExternalUrl(m[2]);
                  return true;
                }
              }
              // bare (inexplicit) URLs — a plain https://… typed without link syntax.
              for (const { start, end, url } of findBareUrls(line.text)) {
                if (pos >= line.from + start && pos <= line.from + end) {
                  void openExternalUrl(url);
                  return true;
                }
              }
              return false;
            },
          }),
        ],
      }),
    });
    // Track every mounted editor (not just the focused one), so a custom-dictionary
    // edit can re-lint all open notes — without touching the last-focused view that
    // the template picker targets. unregisterEditor runs in the onCleanup above.
    trackEditor(view);

    // Restore the reader's scroll position for this buffer (saved when its previous
    // view was torn down on a tab switch). A plain scrollTop set right after creation
    // doesn't stick: CodeMirror measures line heights asynchronously (line wrapping +
    // live-preview block widgets), and that pass resets scrollTop to 0. Re-assert inside
    // requestMeasure across a few cycles so it survives the layout — same approach the
    // external-reload reconcile above uses.
    const restore = loadScroll(path);
    if (restore != null && restore > 0) {
      const v = view;
      v.scrollDOM.scrollTop = restore;
      let cycles = 0;
      const repin = () => {
        if (view !== v) return; // buffer switched / view destroyed
        v.requestMeasure({
          read: () => null,
          write: () => {
            if (view !== v) return;
            if (Math.abs(v.scrollDOM.scrollTop - restore) > 1) v.scrollDOM.scrollTop = restore;
            if (++cycles < 6) repin();
          },
        });
      };
      repin();
    }
  });

  // Skip the SSE echo of versions we already reconciled (typically: our own
  // debounced save came back to us with the same content).
  let lastIgnoredVersion = -1;

  createEffect(async () => {
    const change = lastChange();
    const path = props.path;
    if (!path || !view) return;
    // Skip our own writes: if any of the changed paths is ours AND the doc
    // text already matches what's on disk, do nothing.
    const affectsUs =
      change.paths.length === 0 /* unknown — assume so */ ||
      change.paths.includes(path);
    if (!affectsUs) return;
    if (change.version === lastIgnoredVersion) return;
    // We have un-flushed local edits — disk is stale and the pending autosave is about to
    // overwrite it. Reverting now would clobber the local edit (e.g. a just-committed table
    // cell). Skip; the post-save echo reconciles cleanly once disk catches up.
    if (pendingSave) return;

    let onDisk: string;
    try {
      onDisk = await api.read(path);
    } catch {
      return; // file may have been deleted; another flow handles tab cleanup
    }
    primeNoteCache(path, onDisk); // freshest on-disk truth — keep the body cache warm
    // Guard: path may have changed while awaiting.
    if (path !== props.path) return;
    if (!view) return; // view destroyed while we were awaiting
    const current = view.state.doc.toString();
    if (current === onDisk) {
      // No-op refresh (e.g., our own debounced save echoed back). Record so
      // future identical events don't even trigger the read.
      lastIgnoredVersion = change.version;
      return;
    }
    if (onDisk === lastSavedText) {
      // The echo of OUR OWN save, but we've typed further since it was written
      // (current is ahead of onDisk). Reloading here would revert those in-flight
      // characters and disturb the viewport — a "random" jump while typing. Skip;
      // the pending autosave will write `current` and reconcile to it shortly.
      lastIgnoredVersion = change.version;
      return;
    }
    // Replace the doc while preserving cursor/selection by character offset.
    // Clamp to the new doc length in case the file got shorter.
    const sel = view.state.selection.main;
    const newLen = onDisk.length;
    const anchor = Math.min(sel.anchor, newLen);
    const head = Math.min(sel.head, newLen);
    // Keep the reader where they were: capture scroll before the full-document
    // replace and restore it after (no scrollIntoView, which would jump to the
    // caret — typically the top — every time the file changes on disk).
    const scrollTop = view.scrollDOM.scrollTop;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: onDisk },
      selection: { anchor, head },
      annotations: ExternalReload.of(true),
    });
    // Restore the scroll position. The synchronous set covers the simple case, but
    // CodeMirror re-measures line heights asynchronously after a full-document replace
    // (line wrapping + live-preview block widgets change heights), and that re-measure
    // can clobber scrollTop back to 0 — the "scrolls to the top" glitch. Re-assert the
    // position inside requestMeasure (after CM's own layout pass) so it sticks.
    view.scrollDOM.scrollTop = scrollTop;
    view.requestMeasure({
      read: () => null,
      write: () => {
        if (view && view.scrollDOM.scrollTop !== scrollTop) view.scrollDOM.scrollTop = scrollTop;
      },
    });
    lastIgnoredVersion = change.version;
  });

  // Keep the reader's scroll position when a setting that changes EDITOR TYPOGRAPHY is
  // edited live (the common case: you're in settings.yaml and backspace a digit in
  // editorFontSize / lineHeight). Those leaves feed settingsCssVars → the editor reflows →
  // CodeMirror re-measures and scrolls its caret back into view. Because the typography
  // settings sit at the TOP of settings.yaml, that caret is near the top, so the viewport
  // "teleports to the top". This effect tracks ONLY those geometry-affecting leaves (so it
  // is inert for every other edit) and re-pins scrollTop across the reflow.
  //
  // We correct via CM's own requestMeasure rather than requestAnimationFrame: the write
  // callback runs right AFTER CM's measure-time scroll but BEFORE the browser paints, so the
  // viewport never visibly moves (an rAF correction lands a frame late → a visible up/down
  // bounce). We re-queue across a few measure cycles because the reflow (and CM's scroll)
  // can span more than one cycle after the CSS variables change.
  createEffect(() => {
    const a = settings.appearance;
    const e = settings.editor;
    void [a.editorFont, a.editorFontSize, a.monoScale, e.lineHeight]; // tracked deps (CSS-reflow leaves)
    const v = view;
    if (!v) return;
    const keep = v.scrollDOM.scrollTop;
    let cycles = 0;
    const repin = () => {
      if (view !== v) return; // buffer switched / view destroyed
      v.requestMeasure({
        read: () => null,
        write: () => {
          if (view !== v) return;
          if (v.scrollDOM.scrollTop !== keep) v.scrollDOM.scrollTop = keep;
          if (++cycles < 6) repin();
        },
      });
    };
    repin();
  });

  // The inline title shows only for real `.md` notes — not config buffers
  // (settings.yaml etc.) and not a null/new path. It's a pure function of the
  // path, so it re-derives automatically when the file is renamed elsewhere.
  const showTitle = createMemo(() => {
    const p = currentPath();
    return !!p && p.endsWith(".md");
  });

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", overflow: "hidden" }}>
      <Show when={showTitle()}>
        <NoteTitle path={currentPath()!} />
      </Show>
      <div ref={host} style={{ flex: "1 1 auto", "min-height": "0", overflow: "auto" }} />
    </div>
  );
}
