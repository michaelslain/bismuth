// app/src/Editor.tsx
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js";
import { EditorView, keymap, drawSelection, lineNumbers } from "@codemirror/view";
import { EditorState, Annotation, Compartment, Prec, type Line } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from "@codemirror/commands";
import { startCompletion, acceptCompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { openSearchPanel, searchPanelOpen } from "@codemirror/search";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { toggleBold, toggleItalic } from "./editor/markdownFormat";
import { languages } from "@codemirror/language-data";
import { yaml } from "@codemirror/lang-yaml";
import { syntaxHighlighting, HighlightStyle, indentUnit } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { api, apiBase } from "./api";
import { lastChange } from "./serverVersion";
import { primeNoteCache } from "./noteCache";
import { livePreview } from "./editor/livePreview";
import { enterKeymap } from "./editor/enterKeymap";
import { requestRelint } from "./editor/relint";
import { notePathFacet } from "./editor/tableState";
import { foldBlocks } from "./editor/foldBlocks";
import { mathBlock } from "./editor/mathBlock";
import { latexHighlightTheme } from "./editor/latexHighlight";
import { queryBlock, queryScrollPinActive } from "./editor/queryBlock";
import { taskFold, reorderAroundLine } from "./editor/taskFold";
import { embedBlock } from "./editor/embedBlock";
import { vaultCompletion } from "./editor/autocomplete";
import { completionTheme } from "./editor/completionDisplay";
import { datePropertyPicker } from "./editor/datePicker";
import { iconNames } from "./icons/registry";
import { settingsCompletion, type VaultPath } from "./editor/settingsComplete";
import { editorContextMenu } from "./editor/contextMenu";
import { harperSpellcheck } from "./editor/harper";
import { yamlSchema, isInFrontmatter } from "./editor/yamlSchema";
import { frontmatterBodyRange } from "./editor/frontmatterUtils";
import { normalizeFrontmatterSpacing, minimalChange } from "./editor/normalizeFrontmatter";
import { codeHighlightStyle } from "./editor/codeHighlight";
import { isSettingsBuffer } from "./editor/settingsBuffer";
import { InkOverlay } from "./editor/ink/InkOverlay";
import { SETTINGS_SCHEMA } from "../../core/src/schema/settingsSchema";
import { propertyRegistry } from "./propertyRegistry";
import { parseWikilink, resolveNotePath, findHeadingLineIndex, type NoteCandidate } from "./editor/wikilink";
import { takePendingAnchor, clearPendingAnchor } from "./pendingAnchor";
import type { NativeDragDetail } from "./nativeDrop";
import { findBareUrls } from "./editor/urls";
import { openExternalUrl } from "./appWindow";
import { settings } from "./settings";
import { matchesKeybinding } from "./keybindings";
import { findExtension } from "./editor/findPanel";
import { wrapSelection } from "./editor/wrapSelection";
import { pushToast } from "./Toast";
import { registerEditor, trackEditor, unregisterEditor, setEditorFlush } from "./editorRegistry";
import { saveScroll, loadScroll } from "./scrollMemory";
import { noteTitleWidget } from "./editor/noteTitleWidget";
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
  // `overflowAnchor: none` stops the browser's scroll-anchoring from bumping scrollTop when
  // live-preview widgets above the viewport change height (reveal/fold) — that drift is what
  // could nudge a restored position toward the bottom on a tab return; our scroll-restore owns it.
  ".cm-scroller": { fontFamily: "var(--editor-font)", fontSize: "var(--editor-font-size)", lineHeight: "var(--prose-line-height, 1.65)", overflow: "auto", overflowAnchor: "none", justifyContent: "center", padding: "0 40px" },
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
  // The autocomplete popup styling lives in the shared `completionTheme` (editor/completionDisplay.ts)
  // so the note editor and the card editor render an identical popup. It's added in `base` below.
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

// Media extensions we accept by NAME when the dropped file has no MIME type. Some platforms
// hand a dropped file an empty `File.type` (and a clipboard/synthetic blob often has none), so
// a MIME-only test would silently reject a perfectly droppable image.
const EMBEDDABLE_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico", "pdf",
  "mp3", "wav", "ogg", "m4a", "mp4", "webm", "mov",
]);

const isEmbeddableFile = (f: File): boolean => {
  if (/^(image|audio|video)\//.test(f.type) || f.type === "application/pdf") return true;
  // Extension fallback for empty/unknown MIME (e.g. some OS drag sources).
  const dot = f.name.lastIndexOf(".");
  return dot !== -1 && EMBEDDABLE_EXT.has(f.name.slice(dot + 1).toLowerCase());
};

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

/** Insert an `![[..]]` / `![](..)` embed on its OWN line and drop the caret on the new line
 *  BELOW it. embedBlock reveals raw source while the caret is on the embed's line, so leaving
 *  the caret on the embed (the default for a plain insert) flashes the raw `![[name]]` until you
 *  click away (B15). Inserting a trailing newline + parking the caret past it renders the widget
 *  immediately, and keeping the embed alone on its line keeps it standalone (→ resizable, B16/B18).
 *  A leading newline is prepended when the caret isn't already at the start of an empty line. */
function insertEmbedStandalone(view: EditorView, embed: string): void {
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  // Need a fresh line for the embed unless the caret is at the very start of an empty line.
  const atLineStart = from === line.from;
  const lineEmptyBefore = view.state.sliceDoc(line.from, from).trim() === "";
  const lead = atLineStart && lineEmptyBefore ? "" : "\n";
  const insert = lead + embed + "\n";
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
}

/** Where the caret should land after a task-block reorder replaces [ch.from, ch.to] with
 *  `ch.insert`: on the SAME logical line it was on, at the same column. reorderTaskBlocks is a
 *  STABLE partition (open tasks keep order, then resolved keep order), so the caret's line text
 *  reappears in the reordered block — we match it by text + occurrence index to handle duplicate
 *  lines. Without this, CodeMirror maps an inside-block caret to the block start, yanking it away
 *  from the line the user just typed/checked (B12). */
function caretAfterReorder(state: EditorState, head: number, caretLine: Line, ch: { from: number; to: number; insert: string }): number {
  if (head < ch.from || head > ch.to) return head; // caret outside the reordered block — CM maps it fine
  const col = head - caretLine.from;
  const origLines = state.doc.sliceString(ch.from, ch.to).split("\n");
  const caretIdx = caretLine.number - state.doc.lineAt(ch.from).number;
  // Which occurrence of this line's text is the caret on (1-based), counting within the block.
  let occ = 0;
  for (let i = 0; i <= caretIdx && i < origLines.length; i++) if (origLines[i] === caretLine.text) occ++;
  const newLines = ch.insert.split("\n");
  let seen = 0, newIdx = -1;
  for (let i = 0; i < newLines.length; i++) if (newLines[i] === caretLine.text && ++seen === occ) { newIdx = i; break; }
  if (newIdx < 0) return ch.from; // shouldn't happen for a stable partition; fall back to block start
  let off = 0;
  for (let i = 0; i < newIdx; i++) off += newLines[i].length + 1; // +1 for each rejoined "\n"
  return ch.from + off + Math.min(col, newLines[newIdx].length);
}

/** Read a file's bytes, upload into the attachment folder, then insert `![[basename]]` at
 *  the cursor. The arrayBuffer() read is INSIDE the try so a failed/unreadable blob toasts
 *  instead of escaping as an unhandled rejection. */
async function uploadAndInsert(view: EditorView, file: Blob, fileName: string, notePath: string | null): Promise<void> {
  try {
    const bytes = await file.arrayBuffer();
    const finalPath = await api.uploadAsset(attachmentTarget(fileName, notePath), bytes);
    // Insert on its own line with the caret BELOW so the embed renders immediately (no raw flash,
    // B15) and stays standalone (→ resizable, B16/B18).
    insertEmbedStandalone(view, `![[${finalPath.split("/").pop() ?? fileName}]]`);
  } catch (e) {
    pushToast(`Couldn't save attachment: ${(e as Error).message}`);
  }
}

/** Embeddable by file extension (a dragged OS path has no MIME). Mirrors isEmbeddableFile's
 *  extension fallback for the native-drop path, where we only have a filesystem path string. */
const isEmbeddablePath = (path: string): boolean => {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot !== -1 && EMBEDDABLE_EXT.has(base.slice(dot + 1).toLowerCase());
};

/** Read each dragged OS file's bytes (Tauri fs plugin — paths are real on-disk paths from the
 *  native drag-drop handler) and embed it through the SAME copy-into-attachments + insert flow as
 *  an HTML5 image drop. Only reached under Tauri (the `bismuth-native-drag` event never fires in a
 *  browser), so the dynamic fs-plugin import is desktop-only. */
async function embedNativePaths(view: EditorView, paths: string[], notePath: string | null): Promise<void> {
  let readFile: (p: string) => Promise<Uint8Array>;
  try {
    ({ readFile } = await import("@tauri-apps/plugin-fs"));
  } catch (e) {
    pushToast("Couldn't read dropped file — see console");
    console.error("fs plugin import failed", e);
    return;
  }
  for (const p of paths) {
    try {
      const bytes = await readFile(p);
      const name = p.split("/").pop() ?? p;
      await uploadAndInsert(view, new Blob([bytes as BlobPart]), name, notePath);
    } catch (e) {
      pushToast(`Couldn't read ${p.split("/").pop() ?? p}`);
      console.error("native drop read failed", e);
    }
  }
}

/** Scroll a CodeMirror view to the ATX heading whose text matches `heading` (the anchor of a
 *  `[[File#Heading]]` link), placing the caret at its line start. Reuses the same dispatch +
 *  EditorView.scrollIntoView primitive the find bar (findPanel.revealFrom) uses. Returns false
 *  when no heading matches, so the caller can fall through to the normal scroll-restore. */
function revealHeading(view: EditorView, heading: string): boolean {
  const idx = findHeadingLineIndex(view.state.doc.toString().split("\n"), heading);
  if (idx < 0) return false;
  const pos = view.state.doc.line(idx + 1).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 8 }),
  });
  return true;
}

export function Editor(props: { path: string | null; initialText?: string; onSaved: () => void; noteNames: () => NoteCandidate[]; tagNames: () => string[] }) {
  let host!: HTMLDivElement;
  let wrapper!: HTMLDivElement;
  let view: EditorView | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  // Debounce timer for the "sink a checked task below a newly-typed open one" reorder (B12).
  // Separate from the save timer so reordering and saving stay independent.
  let reorderTimer: ReturnType<typeof setTimeout> | undefined;
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

  // ── Draw mode (note ink) ──────────────────────────────────────────────────────────────
  // Toggled by the toggle-draw-mode keybinding (Escape also exits): the InkOverlay's live
  // canvas goes interactive over the text, and CodeMirror's user interaction is switched off
  // via an `editable` Compartment (NOT readOnly — programmatic dispatches like the SSE
  // external-reconcile and autosave-normalize must keep working). Owned at component scope,
  // outside the per-path view effect, so toggling never rebuilds the view; the view signal
  // lets the (Solid) overlay react to view rebuilds without living inside a CM extension.
  const editableCompartment = new Compartment();
  const [drawMode, setDrawMode] = createSignal(false);
  const [cmView, setCmView] = createSignal<EditorView | undefined>(undefined);
  const isInkable = (p: string | null): p is string => !!p && p.endsWith(".md") && !isSettingsBuffer(p);
  const setDraw = (on: boolean): void => {
    if (drawMode() === on) return;
    setDrawMode(on);
    const v = view;
    if (!v) return;
    v.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(!on)) });
    if (on) {
      // The toggle usually fires while the editor has focus — drop it so keystrokes can't
      // leak into the (now non-editable) buffer while drawing. The InkOverlay then focuses
      // its own host, which keeps ALL draw-mode keys (toggle/Escape/undo) scoped to this
      // pane's wrapper — no global listeners.
      v.contentDOM.blur();
    } else {
      const ae = document.activeElement;
      // Exiting: focus went to the ink host (or fell to body). Give it back to the editor so
      // the user can type — and re-toggle — immediately. Guarded so we never steal focus if
      // the user has since clicked into another pane or input.
      if (ae === document.body || wrapper.contains(ae)) v.contentDOM.focus();
    }
  };
  const onDrawKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (!isInkable(currentPath())) return;
    if (!matchesKeybinding(e, settings.keybindings["toggle-draw-mode"])) return;
    e.preventDefault();
    e.stopPropagation();
    setDraw(!drawMode());
  };
  onMount(() => {
    // Catches both directions: entering (focus in the editor) AND exiting — the InkOverlay
    // focuses its host (inside this wrapper) while drawing, so the toggle keystroke still
    // lands here. Scoping is automatic per pane; no window-level listener.
    wrapper.addEventListener("keydown", onDrawKey, true);
    onCleanup(() => wrapper.removeEventListener("keydown", onDrawKey, true));
  });

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
  // The path the view was last BUILT for — distinguishes a real note switch from a
  // settings-driven same-path rebuild inside the view effect (see pathChanged there).
  let prevBuiltPath: string | null = null;

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

  // Awaitable flush, for the rename flows: callers (NoteTitle / file-tree rename) await this so the
  // current buffer is on disk at the OLD path BEFORE the move runs — otherwise the path-change
  // cleanup below would write it to the old path AFTER the move and re-create it as an orphan (B6).
  const flushSaveAsync = async (): Promise<void> => {
    if (!pendingSave || !view || !activePath) return;
    clearTimeout(saveTimer);
    const text = view.state.doc.toString();
    pendingSave = false;
    lastSavedText = text;
    await save(activePath, text);
  };

  const onBeforeUnload = (): void => flushSave(true);
  if (typeof window !== "undefined") window.addEventListener("beforeunload", onBeforeUnload);
  onCleanup(() => { if (typeof window !== "undefined") window.removeEventListener("beforeunload", onBeforeUnload); });

  // Find-in-note (default Cmd/Ctrl+F, rebindable via settings.keybindings.find). Handled
  // here rather than in App.tsx's global handler so it only fires for the focused editor
  // and never collides with the browser's native find. Capture phase + stopPropagation so
  // it wins before CodeMirror's own keymap and App.tsx's window-level shortcut handler.
  const onFindKey = (e: KeyboardEvent): void => {
    if (!view || e.repeat) return;
    if (!matchesKeybinding(e, settings.keybindings.find)) return;
    e.preventDefault();
    e.stopPropagation();
    if (searchPanelOpen(view.state)) {
      const inp = view.dom.querySelector<HTMLInputElement>(".bismuth-find-input");
      inp?.focus();
      inp?.select();
    } else {
      openSearchPanel(view);
    }
  };
  onMount(() => {
    wrapper.addEventListener("keydown", onFindKey, true);
    onCleanup(() => wrapper.removeEventListener("keydown", onFindKey, true));
  });

  // Scroll to a heading when a `[[File#Heading]]` link targets a note THIS editor already
  // shows (App early-returns from openFile without rebuilding the view, so the creation-time
  // anchor never fires — this event is the live path). Gated to our current buffer.
  onMount(() => {
    const onReveal = (e: Event): void => {
      const d = (e as CustomEvent).detail as { path: string; heading: string };
      if (!view || !d?.heading || d.path !== activePath) return;
      // Already-open note: the view isn't rebuilt, so consume the pending anchor here too — else a
      // later unrelated rebuild (e.g. a settings toggle) would re-fire this scroll out of nowhere.
      clearPendingAnchor(d.path);
      revealHeading(view, d.heading);
    };
    window.addEventListener("bismuth-reveal-heading", onReveal);
    onCleanup(() => window.removeEventListener("bismuth-reveal-heading", onReveal));
  });

  // Tauri native OS file drop onto the editor. Under the native drag-drop handler the CM `drop`
  // event no longer fires for external files (and a browser File only ever exposes a basename), so
  // we embed from the REAL path nativeDrop.ts forwards — handled only when the cursor is over THIS
  // editor's scroller. No-op in the browser (the event never fires; the CM `drop` handler serves it).
  onMount(() => {
    const onNativeDrag = (e: Event): void => {
      const d = (e as CustomEvent<NativeDragDetail>).detail;
      if (!view || !d || d.type !== "drop" || d.paths.length === 0) return;
      const r = view.scrollDOM.getBoundingClientRect();
      // A hidden (display:none) pane has a 0×0 rect at (0,0); without this guard a drop forwarded
      // at the viewport corner (0,0) would hit-test true for EVERY backgrounded editor at once.
      if (r.width === 0 && r.height === 0) return;
      if (d.x < r.left || d.x > r.right || d.y < r.top || d.y > r.bottom) return;
      const embeddable = d.paths.filter(isEmbeddablePath);
      if (embeddable.length === 0) return;
      const v = view;
      const pos = v.posAtCoords({ x: d.x, y: d.y });
      if (pos != null) v.dispatch({ selection: { anchor: pos } });
      void embedNativePaths(v, embeddable, activePath);
    };
    window.addEventListener("bismuth-native-drag", onNativeDrag);
    onCleanup(() => window.removeEventListener("bismuth-native-drag", onNativeDrag));
  });

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
      clearTimeout(reorderTimer); // drop any pending B12 reorder for the buffer being torn down
      if (view) unregisterEditor(view);
      view?.destroy();
      // Null it after destroy so any in-flight rAF closures (e.g. the heading-reveal re-assert,
      // which dispatches) become no-ops on full unmount — `view === v` would otherwise still hold
      // for the destroyed instance and dispatch on a destroyed view throws.
      view = undefined;
      setCmView(undefined);
    });
    lastSavedText = undefined; // different buffer — forget the prior file's save text
    pendingSave = false;
    // Switching NOTES always lands in text mode — but this effect also re-runs on any
    // settings.editor change (it reads those leaves to build the extensions), and a
    // settings-driven same-path rebuild must NOT silently kick the user out of draw mode
    // (the compartment seed below preserves the non-editable state instead).
    const pathChanged = path !== prevBuiltPath;
    prevBuiltPath = path;
    if (pathChanged) setDraw(false);
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

      // B12: sink a checked task below a newly-typed UNCHECKED one (reorder-on-type, mirroring
      // what the toggle path already does via the backend). DEBOUNCED so it only runs once the
      // user stops typing. reorderAroundLine replaces the caret's WHOLE task block, so we must
      // re-anchor the caret onto its moved line ourselves (caretAfterReorder) — CodeMirror's
      // default mapping would collapse an inside-block caret to the block start, yanking it away
      // from where the user just typed. We deliberately do NOT annotate ExternalReload: the
      // reorder is a real content change that must be persisted, so we let it re-enter this
      // listener (which reschedules the save). The re-entry is a no-op for reordering — the block
      // is now sorted, so reorderAroundLine returns null — so there's no loop. Notes only.
      if (view && !path.endsWith(".yaml") && !path.endsWith(".yml") && !isSettingsBuffer(path)) {
        clearTimeout(reorderTimer);
        reorderTimer = setTimeout(() => {
          if (!view) return;
          const state = view.state;
          const caretLine = state.doc.lineAt(state.selection.main.head);
          const spec = reorderAroundLine(state, caretLine.number); // null when already sorted
          if (!spec) return;
          const ch = spec.changes as { from: number; to: number; insert: string };
          const newHead = caretAfterReorder(state, state.selection.main.head, caretLine, ch);
          queueMicrotask(() => {
            if (!view) return;
            view.dispatch({ changes: ch, selection: { anchor: newHead } });
          });
        }, 400);
      }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        // Auto-format on save: enforce one blank line between frontmatter and body. Apply
        // it to the LIVE editor via a minimal diff (so the cursor stays put and the fix is
        // visible immediately, not only after a reload). Annotated ExternalReload so this
        // programmatic edit doesn't re-trigger autosave. Notes only — not config buffers.
        const isMd = !path.endsWith(".yaml") && !path.endsWith(".yml") && !isSettingsBuffer(path);
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
      // First edit of a buffer that's never been saved this session (lastSavedText === undefined):
      // use a short floor so a brand-new note persists fast instead of waiting the full debounce
      // (B1 — new-file first edits felt lost for ~800ms). Subsequent edits use the normal delay.
      }, lastSavedText === undefined ? Math.min(settings.editor.autoSaveDelay, 150) : settings.editor.autoSaveDelay);
    });

    // Shared base for every buffer: editing, theme, gutters, autosave.
    const base = [
      // Draw mode switches USER editing off (contenteditable/IME/tab order) without touching
      // programmatic dispatch — see setDraw. Seeded from the CURRENT draw state (untracked —
      // drawMode must not be a dependency of this effect): a real note switch reset it to
      // false above, while a settings-driven same-path rebuild preserves an active draw mode
      // instead of leaving an interactive ink overlay over a silently editable buffer.
      editableCompartment.of(EditorView.editable.of(!untrack(drawMode))),
      history(),
      drawSelection(),
      // Indent unit is set per-buffer below (4 spaces for markdown notes, 2 for YAML
      // config) — not here in the shared base. Markdown wants a 4-space Tab so a single
      // indent clears any list marker (`1. ` is 3 cols wide) and nests uniformly; YAML
      // keeps the conventional 2-space step. List nesting depth is read from the parse
      // tree (livePreview/foldBlocks), so it stays correct across mixed 2-/4-space notes.
      // Auto-close brackets/quotes like a normal code editor: typing an opener inserts its
      // matching closer just past the cursor; typing the closer when it's already there
      // skips over it; Backspace on an empty pair deletes both (closeBracketsKeymap). `$`
      // is registered as a self-closing pair (open == close) so a fresh `$` becomes `$|$`,
      // ready to type inline math (rendered by livePreview). Same word-char heuristic that
      // keeps `'`/`"` from pairing mid-word also keeps a `$` after a letter from pairing.
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{", "'", "\"", "$"] } }]),
      closeBrackets(),
      // Wrap a selection in a formatting char (`*text*`, etc.) instead of replacing
      // it. Disjoint from the closeBrackets set above so the two never fight; read
      // lazily so the live `settings.editor.wrapSelectionChars` set always applies.
      ...(ed.wrapSelection ? [wrapSelection(() => ed.wrapSelectionChars)] : []),
      // Ctrl-Space manually opens the autocomplete menu (Mod-Space is Spotlight on Mac).
      // Tab accepts the active completion (acceptCompletion returns false when no popup is
      // open, so it falls through); otherwise Tab/Shift-Tab indent/dedent the selected
      // lines — which is how list items nest/un-nest (e.g. `- foo` → `  - foo`).
      keymap.of([
        { key: "Ctrl-Space", run: startCompletion },
        { key: "Tab", run: acceptCompletion },
        { key: "Tab", run: indentMore, shift: indentLess },
        // Backspace deletes a bracket pair when the cursor sits between an empty one;
        // falls through to defaultKeymap's deleteCharBackward otherwise. Must precede it.
        ...closeBracketsKeymap,
        // Markdown list continuation: Enter on "1. foo" / "- foo" inserts the next
        // marker (renumbering ordered lists), Enter on an empty item outdents it, and
        // Backspace deletes a list marker. Must precede defaultKeymap so its Enter wins
        // over the generic insertNewlineAndIndent; falls through (returns false) outside
        // list/markdown context, so plain notes + YAML buffers are unaffected.
        ...markdownKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      editorTheme,
      completionTheme, // shared autocomplete-popup styling (also used by the card editor)
      ...(ed.lineWrapping ? [EditorView.lineWrapping] : []),
      // In-editor find (Cmd/Ctrl+F by default) — custom bar, see editor/findPanel.ts.
      // The keybinding is wired below (host capture handler) so it stays rebindable.
      findExtension(),
      autosave,
      // Right-click a spelling / grammar / property mark → the shared app menu.
      editorContextMenu(),
    ];

    // Config buffers render as YAML CODE — monospace, syntax-highlighted, NO
    // markdown rendering and NO spell/grammar check. settings.yaml additionally
    // validates the whole document against the fixed app-settings schema.
    const isYaml = path.endsWith(".yaml") || path.endsWith(".yml") || isSettingsBuffer(path);
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
          // YAML config keeps the conventional 2-space indent step.
          indentUnit.of("  "),
          EditorState.tabSize.of(2),
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
          // One Tab = 4 spaces in prose, so an indent is uniform whether you nest a
          // bullet, a numbered item's child (clears the wider `1. ` marker → renumber
          // survives), or a plain paragraph. `remove: ["IndentedCode"]` keeps a 4-space
          // paragraph a paragraph instead of a markdown indented code block.
          indentUnit.of("    "),
          EditorState.tabSize.of(4),
          ...(ed.lineNumbers ? [lineNumbers()] : []),
          // The note title (`# <title>`) renders as a block widget at the very top of
          // the document, so it lives inside the scroller and scrolls away with the
          // content instead of staying pinned. Only real `.md` notes get a title.
          ...(path.endsWith(".md") ? [noteTitleWidget(path)] : []),
          // Markdown emphasis shortcuts (notes only): Cmd/Ctrl-B bold, Cmd/Ctrl-I italic.
          // Prec.high so they beat any default Mod-i/Mod-b binding.
          Prec.high(keymap.of([
            { key: "Mod-b", run: toggleBold },
            { key: "Mod-i", run: toggleItalic },
          ])),
          markdown({ codeLanguages: languages, extensions: [{ remove: ["IndentedCode"] }] }),
          // Enter: continue list/blockquote markup, else a PLAIN newline (no auto-indent
          // that would leak a stray leading space / split a ``` fence). Notes only.
          enterKeymap,
          syntaxHighlighting(codeHighlightStyle),
          queryBlock(() => path),
          embedBlock(props.noteNames),
          vaultCompletion({
            getNotes: props.noteNames,
            getTags: props.tagNames,
            getSchema: propertyRegistry,
            getIconNames: iconNames,
            inFrontmatter: isInFrontmatter,
            // `[[Note#heading]]` completion fetches the target note's body to list its headings.
            readNote: (p) => api.read(p),
          }),
          yamlSchema({
            getSchema: propertyRegistry,
            mode: "frontmatter",
            // Filename-based link resolution: a [[Target]] resolves when some note
            // candidate's label matches (wikilink semantics — name, not path).
            resolveLink: (target) => props.noteNames().some((n) => n.label === target),
          }),
          // Calendar popover for `date`/`datetime` frontmatter properties (registered in
          // the propertyRegistry): native date/time inputs + relative-date quick options.
          datePropertyPicker(propertyRegistry),
          notePathFacet.of(path),
          // hasGutter tracks ed.lineNumbers so depth-0 chevrons clear the gutter when it's on;
          // safe to read here since this effect rebuilds the whole view when settings.editor changes.
          ...(ed.livePreview ? [livePreview, taskFold(), foldBlocks(() => path, "markdown", { hasGutter: ed.lineNumbers }), mathBlock(), latexHighlightTheme] : []),
          // Harper spell + grammar check. Runs whenever either category is enabled;
          // it filters lints by kind so editor.spellcheck and editor.grammarCheck
          // toggle independently (default: spelling on, grammar off).
          ...(ed.spellcheck || ed.grammarCheck
            ? [harperSpellcheck({ getBodyRange: frontmatterBodyRange, spelling: ed.spellcheck, grammar: ed.grammarCheck })]
            : []),
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
            // Allow dropping files onto the editor (the default would navigate away). Accept both
            // the `Files` type flag AND a non-empty `items` list — some drag sources populate
            // `items` but not `types` during dragover, which made image drops silently fall through.
            dragover: (e) => {
              const dt = (e as DragEvent).dataTransfer;
              if (dt?.types?.includes("Files") || dt?.items?.length) e.preventDefault();
              return false;
            },
            // Drop an image/audio/video/PDF from outside → copy into the attachment folder
            // (default) and embed it. ⌥-drop or attachments.onDrop:"reference" inserts a bare
            // `![[name]]` reference instead (no copy). Move/reference-by-absolute-path are
            // desktop-only refinements (the browser can't read a dropped file's real path).
            drop: (e, view) => {
              // preventDefault FIRST, before any early return, so the browser never navigates to
              // a dropped file even when we end up not embedding it.
              e.preventDefault();
              const dt = (e as DragEvent).dataTransfer;
              const files = dt ? [...dt.files].filter(isEmbeddableFile) : [];
              if (files.length === 0) return false; // not a media drop — let CM handle text
              const pos = view.posAtCoords({ x: (e as DragEvent).clientX, y: (e as DragEvent).clientY });
              if (pos != null) view.dispatch({ selection: { anchor: pos } });
              const reference = (e as DragEvent).altKey || settings.attachments.onDrop === "reference";
              for (const f of files) {
                if (reference) {
                  // Off-line standalone insert (like paste) so it renders immediately + resizable
                  // (B15/B16/B18); best-effort — resolves only if the file is already in-vault.
                  insertEmbedStandalone(view, `![[${f.name}]]`);
                } else {
                  void uploadAndInsert(view, f, f.name, path);
                }
              }
              return true;
            },
            mousedown: (e, view) => {
              // Only navigate when the click actually lands on a RENDERED link — live
              // preview marks links/wikilinks/bare-urls with `.cm-link` / `.cm-wikilink`
              // (livePreview.ts). Without this gate, a click in the empty space below a
              // note whose last content is a link resolves (via nearest-position mode) to
              // the doc end, which sits inside that trailing link, and wrongly navigates.
              // (Links on the caret's own line render raw with no class, so a plain click
              // there places the cursor to edit instead of navigating — Obsidian-like.)
              const tgt = e.target as HTMLElement | null;
              if (!tgt?.closest?.(".cm-link, .cm-wikilink")) return false;
              // `false` = nearest-position mode: precise mode returns null when the click
              // lands between glyphs or on padding, which made links intermittently dead.
              // Safe now that the DOM-class gate above has confirmed we're on a link.
              const pos = view.posAtCoords({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }, false);
              if (pos == null) return false;
              const line = view.state.doc.lineAt(pos);
              // `(?<!!)` skips EMBEDS (`![[...]]`): clicking one while editing must not
              // navigate to it as a note (it's rendered media, not a link).
              for (const m of line.text.matchAll(/(?<!!)\[\[([^\]]+?)\]\]/g)) {
                const s = line.from + (m.index ?? 0), en = s + m[0].length;
                if (pos >= s && pos <= en) {
                  const { target, heading } = parseWikilink(m[1]);
                  // Wikilinks are filename-based: resolve the basename to its real vault
                  // path so subfolder notes open (and highlight) correctly. An unresolved
                  // target opens as a new note at the typed name (read falls back to "").
                  const resolved = resolveNotePath(target, props.noteNames());
                  // Object detail (not a bare string) so a `#heading` anchor rides along —
                  // App routes it through pendingAnchor → the opened editor scrolls to it.
                  window.dispatchEvent(new CustomEvent("bismuth-open", { detail: { path: (resolved ?? target) + ".md", heading } }));
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
    setEditorFlush(view, flushSaveAsync); // so a rename can persist this buffer before moving (B6)
    setCmView(view); // the ink overlay (Solid-side) reacts to view rebuilds through this

    // A pending `[[File#Heading]]` anchor (set by App when this buffer was opened via a
    // heading link) wins over the saved scroll position: jump to the heading instead of
    // restoring the last reader position. One-shot (take-and-clear) so an unrelated view
    // rebuild — e.g. flipping an editor setting — doesn't re-hijack the scroll. Re-assert
    // across a couple of frames because the same async line-height measure that resets
    // scrollTop (see below) can also undo a scrollIntoView applied at creation time.
    // revealHeading returns false when the heading isn't in the doc (renamed / typo / stale
    // autocomplete); only a SUCCESSFUL reveal suppresses the scroll-restore below — otherwise we'd
    // strand the reader at the top instead of returning them to their saved position.
    const anchor = takePendingAnchor(path);
    let revealed = false;
    if (anchor && view) {
      const v = view;
      revealed = revealHeading(v, anchor);
      if (revealed) {
        // Re-assert across the next several frames: CM's async line-height measure (block widgets,
        // wrapping) can scroll back to the top after the initial reveal — the same race the
        // scroll-restore below hardens against. rAF (not requestMeasure) so re-dispatch is legal.
        let frames = 0;
        const repin = () => {
          if (view !== v || frames++ >= 6) return;
          revealHeading(v, anchor);
          requestAnimationFrame(repin);
        };
        requestAnimationFrame(repin);
      }
    }

    // Restore the reader's scroll position for this buffer (saved when its previous
    // view was torn down on a tab switch). A plain scrollTop set right after creation
    // doesn't stick: CodeMirror measures line heights asynchronously (line wrapping +
    // live-preview block widgets), and that pass resets scrollTop to 0. Re-assert inside
    // requestMeasure across a few cycles so it survives the layout — same approach the
    // external-reload reconcile above uses. Skipped when a heading anchor already claimed
    // the scroll.
    const restore = revealed ? undefined : loadScroll(path);
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
    // Reconcile to the on-disk text with the SMALLEST possible change — only the
    // span between the common prefix and suffix — instead of replacing the whole
    // document. A full {from:0,to:len} replace remounts every decoration in the
    // doc: embedded query-block widgets lose their inner BaseView state, ephemeral
    // folds drop, and the viewport jumps to the top. A minimal change lets
    // CodeMirror map every decoration/widget/fold OUTSIDE the edit across it
    // untouched (and map the selection through it), so a checkbox toggle or a
    // one-line external edit no longer "reloads" the note. The dominant
    // single-region edit becomes a tiny change; scattered edits collapse to one
    // wider change — never worse than the old full replace. (Same pattern already
    // used above for live frontmatter normalization.)
    const patch = minimalChange(current, onDisk);
    // Keep the reader where they were: capture scroll before applying the change
    // and restore it after (no scrollIntoView, which would jump to the caret —
    // typically the top — every time the file changes on disk).
    const scrollTop = view.scrollDOM.scrollTop;
    view.dispatch({
      changes: patch,
      annotations: ExternalReload.of(true),
    });
    // Restore the scroll position. The synchronous set covers the simple case, but
    // CodeMirror re-measures line heights asynchronously after the reconcile when
    // it touches block widgets (line wrapping + live-preview block widgets change
    // heights), and that re-measure can clobber scrollTop back to 0 — the "scrolls
    // to the top" glitch. Re-assert the position inside requestMeasure (after CM's
    // own layout pass) so it sticks.
    // Back off if a query-block task-toggle pin is currently re-asserting scrollTop (B24): both
    // want to own the scroll during the same toggle round-trip, and fighting it causes a flicker.
    // The query-block pin already holds the user's intended position, so let it win this window.
    if (!queryScrollPinActive) {
      view.scrollDOM.scrollTop = scrollTop;
      view.requestMeasure({
        read: () => null,
        write: () => {
          if (view && !queryScrollPinActive && view.scrollDOM.scrollTop !== scrollTop) view.scrollDOM.scrollTop = scrollTop;
        },
      });
    }
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

  // The inline note title (`# <title>`) is no longer a sibling above the editor —
  // it's rendered INSIDE the CodeMirror scroller as a block widget at doc-position 0
  // (see noteTitleWidget, wired into the note extensions above) so it scrolls with
  // the content. The host fills the wrapper; the wrapper stays `position: relative`
  // so the absolutely-positioned find bar still anchors to it.
  return (
    <div ref={wrapper} style={{ height: "100%", overflow: "hidden", position: "relative" }}>
      <div ref={host} style={{ height: "100%", overflow: "auto" }} />
      {/* Draw-anywhere note ink: a stroke layer over the text (real .md notes only). Paint-only
          in normal mode; the toggle-draw-mode keybinding makes it interactive + mounts the
          drawing toolbar. Lives here (not in a CM extension) so it's plain Solid over the view. */}
      <Show when={isInkable(currentPath())}>
        <InkOverlay view={cmView} path={currentPath} active={drawMode} onExit={() => setDraw(false)} />
      </Show>
    </div>
  );
}
