// app/src/Editor.tsx
import { createEffect, createMemo, onCleanup } from "solid-js";
import { EditorView, keymap, drawSelection, lineNumbers } from "@codemirror/view";
import { EditorState, Annotation } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { startCompletion } from "@codemirror/autocomplete";
import { forceLinting } from "@codemirror/lint";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { api } from "./api";
import { lastChange } from "./serverVersion";
import { livePreview } from "./editor/livePreview";
import { tasksQuery } from "./editor/tasksQuery";
import { basesBlock } from "./editor/basesBlock";
import { viewBlock } from "./editor/viewBlock";
import { vaultCompletion } from "./editor/autocomplete";
import { iconNames } from "./icons/registry";
import { settingsCompletion } from "./editor/settingsComplete";
import { editorContextMenu } from "./editor/contextMenu";
import { harperSpellcheck } from "./editor/harper";
import { yamlSchema, isInFrontmatter } from "./editor/yamlSchema";
import { frontmatterBodyRange } from "./editor/frontmatterUtils";
import { isSettingsBuffer } from "./editor/settingsBuffer";
import { SETTINGS_SCHEMA } from "../../core/src/schema/settingsSchema";
import { propertyRegistry } from "./propertyRegistry";
import { parseWikilink, resolveNotePath, type NoteCandidate } from "./editor/wikilink";
import { settings } from "./settings";
import "./Editor.css";

// Marks a transaction as "content pulled in from disk" rather than a user edit,
// so the autosave listener can skip it. Without this, reloading an external
// change triggers a save that writes the file back to itself — an endless loop
// against a file something else (e.g. a status-file writer) keeps rewriting.
const ExternalReload = Annotation.define<boolean>();

// Prose font/size and selection tint come from CSS variables (set by App.tsx from
// the Appearance settings), so they update live without rebuilding the editor.
const editorTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--fg)", height: "100%" },
  ".cm-scroller": { fontFamily: "var(--editor-font)", fontSize: "var(--editor-font-size)", lineHeight: "var(--prose-line-height, 1.65)", overflow: "auto" },
  ".cm-content": { caretColor: "var(--fg)", padding: "12px 16px" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--fg)",
    borderLeftWidth: "2px",
    transition: "left 70ms ease-out, top 70ms ease-out", // smooth glide
  },
  ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)" },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--accent) 38%, transparent)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "color-mix(in srgb, var(--fg) 35%, transparent)" },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "1px solid var(--border)",
    borderRadius: "8px",
    backgroundColor: "var(--bg)",
    boxShadow: "var(--shadow-popup)",
    fontFamily: "'Monaspace Xenon', monospace",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    padding: "3px 10px",
    fontSize: "13px",
    lineHeight: "1.5",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent)",
    color: "var(--fg)",
  },
  ".cm-completionDetail": {
    marginLeft: "8px",
    opacity: "0.5",
    fontStyle: "normal",
  },
});

// Config buffers (settings.yaml etc.) are CODE, not prose: monospace, tighter
// line-height. !important so it beats editorTheme's prose font (CM facet
// precedence is earlier-wins, and editorTheme comes first in the array).
const codeFontTheme = EditorView.theme({
  ".cm-scroller": { fontFamily: "'Monaspace Xenon', ui-monospace, monospace !important", lineHeight: "1.55" },
});

// YAML syntax colors pulled from the app theme (keys = accent, bools/numbers =
// 3rd-brain purple, strings = near-fg, comments = dim italic) so config files
// read as part of the app, not a generic code editor.
const yamlHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: "color-mix(in srgb, var(--fg) 48%, transparent)", fontStyle: "italic" },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: "var(--accent)" },
  { tag: [t.bool, t.atom, t.keyword, t.number], color: "var(--accent-purple)" },
  { tag: [t.string, t.special(t.string)], color: "color-mix(in srgb, var(--fg) 88%, transparent)" },
  { tag: [t.separator, t.punctuation, t.bracket, t.brace], color: "color-mix(in srgb, var(--fg) 45%, transparent)" },
]);

export function Editor(props: { path: string | null; onSaved: () => void; noteNames: () => NoteCandidate[]; tagNames: () => string[] }) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  // Value-dedupe the path. props.path is read through a chain (active tab → pane tree →
  // leaf content) that re-emits whenever the tab object changes — e.g. on every pane
  // focus change. Without this memo the view effect below would re-run and rebuild the
  // CodeMirror view on each focus change, stealing focus mid-edit. The memo only emits
  // when the path string itself changes, so the view is rebuilt only on a real file switch.
  const currentPath = createMemo(() => props.path);

  const save = async (path: string, text: string) => {
    await api.write(path, text);
    props.onSaved();
    if (settings.vault.backupOnSave) api.backup(); // local-git snapshot; no-op when nothing changed
  };

  // Re-validate the open buffer when the property registry changes — e.g. you add
  // a property to settings.yaml's `properties:` section. CM linters only re-run on
  // doc changes, so an external registry update needs an explicit re-lint or the
  // note would keep showing stale "unknown property" marks.
  createEffect(() => {
    propertyRegistry(); // track: re-run whenever the registry signal updates
    if (view) forceLinting(view);
  });

  createEffect(async () => {
    const path = currentPath();
    // Destroy the previous view when this effect re-runs (path changed or cleanup).
    onCleanup(() => view?.destroy());
    if (!path) return;

    // Treat a missing file as an empty note (new, not yet written).
    let text = "";
    try {
      text = await api.read(path);
    } catch {
      text = "";
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
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => save(path, u.state.doc.toString()), settings.editor.autoSaveDelay);
    });

    // Shared base for every buffer: editing, theme, gutters, autosave.
    const base = [
      history(),
      drawSelection(),
      // Ctrl-Space manually opens the autocomplete menu (Mod-Space is Spotlight on Mac).
      keymap.of([{ key: "Ctrl-Space", run: startCompletion }, ...defaultKeymap, ...historyKeymap]),
      editorTheme,
      ...(ed.lineWrapping ? [EditorView.lineWrapping] : []),
      ...(ed.lineNumbers ? [lineNumbers()] : []),
      autosave,
      // Right-click a spelling / grammar / property mark → the shared app menu.
      editorContextMenu(),
    ];

    // Config buffers render as YAML CODE — monospace, syntax-highlighted, NO
    // markdown rendering and NO spell/grammar check. settings.yaml additionally
    // validates the whole document against the fixed app-settings schema.
    const isYaml = path.endsWith(".yaml") || path.endsWith(".yml");
    const extensions = isYaml
      ? [
          ...base,
          yaml(),
          syntaxHighlighting(yamlHighlight),
          codeFontTheme,
          ...(isSettingsBuffer(path)
            ? [
                yamlSchema({ getSchema: () => SETTINGS_SCHEMA, mode: "settings" as const, resolveLink: () => true }),
                settingsCompletion(() => SETTINGS_SCHEMA),
              ]
            : []),
        ]
      : [
          // Note buffers: markdown + live preview, autocomplete, frontmatter
          // validation, and spell/grammar checking.
          ...base,
          markdown(),
          basesBlock(() => path),
          viewBlock(() => path),
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
          ...(ed.livePreview ? [livePreview, tasksQuery] : []),
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
            mousedown: (e, view) => {
              // `false` = nearest-position mode: precise mode returns null when the click
              // lands between glyphs or on padding, which made links intermittently dead.
              const pos = view.posAtCoords({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }, false);
              if (pos == null) return false;
              const line = view.state.doc.lineAt(pos);
              for (const m of line.text.matchAll(/\[\[([^\]]+?)\]\]/g)) {
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
              return false;
            },
          }),
        ],
      }),
    });
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

    let onDisk: string;
    try {
      onDisk = await api.read(path);
    } catch {
      return; // file may have been deleted; another flow handles tab cleanup
    }
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
    view.scrollDOM.scrollTop = scrollTop;
    lastIgnoredVersion = change.version;
  });

  return <div ref={host} style={{ height: "100%", overflow: "auto" }} />;
}
