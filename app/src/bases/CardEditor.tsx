import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { EditorState, Annotation } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting, indentUnit } from "@codemirror/language";
import { api } from "../api";
import { onServerChange } from "../serverVersion";
import { readNoteCached, primeNoteCache, peekNoteCache } from "../noteCache";
import { livePreview } from "../editor/livePreview";
import { notePathFacet } from "../editor/tableState";
import { codeHighlightStyle } from "../editor/codeHighlight";
import { findBareUrls } from "../editor/urls";
import { openExternalUrl } from "../appWindow";
import { settings } from "../settings";
import { splitCard, type CardMode } from "./cardBodySplit";
import styles from "./BaseView.module.css";

// A disk-pulled reload is annotated so the autosave listener skips it — otherwise reloading an
// external change would write the file back to itself, looping against any external writer.
const ExternalReload = Annotation.define<boolean>();

// Card-editor theme: transparent, gutterless, auto-height, prose font — so the editable card
// reads like the note editor's live-preview rather than a boxed code editor. Selection/caret
// tint mirror Editor.tsx so drag-highlighting looks identical to the main editor.
const cardTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--fg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--editor-font)", fontSize: "14px", lineHeight: "1.55", overflow: "visible" },
  ".cm-content": { padding: "0", caretColor: "var(--fg)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)", borderLeftWidth: "2px" },
  ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--accent) 38%, transparent)" },
});

/**
 * A seamless, always-live inline editor for a card. A click places the cursor, a drag selects, and
 * checkboxes/links work via livePreview — it edits like normal markdown. The non-editable
 * surroundings are kept out of the editor (see splitCard): always the frontmatter + a duplicated
 * `# Title` heading, and in `mode: "tasks"` also the prose before/after the checklist, so a tasks
 * card stays a focused but fully-editable checklist. Edits autosave (`prefix + body + suffix`) with
 * the same echo-suppression Editor.tsx uses, reconciling external changes without clobbering edits.
 */
export function CardEditor(props: { path: string; title?: string; mode: CardMode }) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  let prefix = ""; // text before the editable region (frontmatter, title, in tasks mode pre-checklist prose)
  let suffix = ""; // text after the editable region (tasks mode only: content past the checklist)
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingSave = false; // local edits not yet flushed — block external-reload revert
  let lastSavedFull: string | undefined; // last full file text we wrote — recognizes our own SSE echo
  // Set once the component is torn down. Guards every post-await step (reconcile/mount) so an
  // in-flight read can't dispatch onto — or rebuild — a destroyed view.
  let disposed = false;
  // "Loading…" until a successful read builds the view. Staying in this state on a read failure is
  // deliberate: an empty editor whose autosave fired would overwrite the note's frontmatter.
  const [loading, setLoading] = createSignal(true);

  const save = async () => {
    if (!view) return;
    const text = view.state.doc.toString();
    const full = prefix + text + suffix;
    lastSavedFull = full; // record BEFORE the await so a fast echo still matches
    try {
      await api.write(props.path, full);
      primeNoteCache(props.path, full); // keep the body cache warm for sibling cards / reopen
    } catch {
      return; // write failed — leave pendingSave set so the next edit / flush retries
    }
    // Clear the pending flag only if nothing was typed during the write — otherwise a newer edit
    // is queued and reconcile must keep treating disk as stale (mirrors Editor.tsx).
    if (view && view.state.doc.toString() === text) pendingSave = false;
  };

  // Build the live editor over the note's body once we have its content. Split off the prefix
  // (frontmatter + duplicate title) so only the editable body is shown.
  function buildView(raw: string) {
    if (disposed || view) return;
    const split = splitCard(raw, props.title, props.mode);
    prefix = split.prefix;
    suffix = split.suffix;
    lastSavedFull = raw;

    const autosave = EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      if (u.transactions.some((tr) => tr.annotation(ExternalReload))) return;
      pendingSave = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void save(), settings.editor.autoSaveDelay);
    });

    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: split.body,
        extensions: [
          history(),
          drawSelection(),
          indentUnit.of("  "),
          EditorState.tabSize.of(2),
          // Tab indents/dedents list items (matches the note editor); the rest is the standard
          // editing + history keymap.
          keymap.of([{ key: "Tab", run: indentMore, shift: indentLess }, ...defaultKeymap, ...historyKeymap]),
          markdown({ codeLanguages: languages }),
          syntaxHighlighting(codeHighlightStyle),
          notePathFacet.of(props.path),
          livePreview, // rendered-yet-editable markdown + checkbox toggle + right-click status menu
          EditorView.lineWrapping,
          cardTheme,
          autosave,
          // Click a link/wikilink → navigate (like the note editor); other clicks fall through so
          // livePreview places the cursor or toggles a task.
          EditorView.domEventHandlers({ mousedown: (e, v) => navigateOnLinkClick(e as MouseEvent, v) }),
        ],
      }),
    });
    setLoading(false);
  }

  onMount(async () => {
    let raw = peekNoteCache(props.path);
    if (raw === undefined) {
      try {
        const r = readNoteCached(props.path);
        raw = typeof r === "string" ? r : await r;
      } catch {
        return; // read failed — stay in "Loading…"; onServerChange retries via reconcile()
      }
    }
    if (disposed) return; // unmounted while reading — don't build a detached, undestroyed view
    buildView(raw);
  });

  // Reconcile an external change to this note (edited in a pane, a daemon write, an external sync)
  // in place — without reverting in-flight edits or looping on our own save echo.
  const off = onServerChange((c) => {
    if (c.paths.length === 0 || c.paths.includes(props.path)) void reconcile();
  });
  onCleanup(off);

  async function reconcile() {
    if (disposed) return;
    let onDisk: string;
    try {
      onDisk = await api.read(props.path);
    } catch {
      return; // file may have been deleted; tab cleanup handles that elsewhere
    }
    if (disposed) return; // unmounted while reading — view is destroyed, do not dispatch
    primeNoteCache(props.path, onDisk);
    if (!view) {
      buildView(onDisk); // first successful read after a failed mount
      return;
    }
    if (onDisk === lastSavedFull) return; // our own write echoed back — no-op
    const split = splitCard(onDisk, props.title, props.mode);
    // Always refresh the (invisible) prefix/suffix from disk, even mid-edit: that text isn't shown
    // in the card, so an external change to it would otherwise be silently overwritten by our next
    // save (prefix + body + suffix). Refreshing here means that save merges in the new surroundings.
    prefix = split.prefix;
    suffix = split.suffix;
    if (pendingSave) return; // disk body is stale vs our edits; our pending save will write it
    if (view.state.doc.toString() === split.body) return;
    // Full-document replace, preserving the caret/selection by character offset (clamped).
    const sel = view.state.selection.main;
    const len = split.body.length;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: split.body },
      selection: { anchor: Math.min(sel.anchor, len), head: Math.min(sel.head, len) },
      annotations: ExternalReload.of(true),
    });
  }

  onCleanup(() => {
    disposed = true;
    clearTimeout(saveTimer);
    if (pendingSave && view) void save(); // flush a queued edit before teardown
    view?.destroy();
    view = undefined; // so an in-flight reconcile's `if (!view)` guard short-circuits
  });

  return (
    <div class={styles.cardEditor}>
      <div ref={host} />
      <Show when={loading()}>
        <div class={styles.cardKey}>Loading…</div>
      </Show>
    </div>
  );
}

// Click a wikilink / markdown-link / bare URL inside the card editor → navigate, matching the
// note editor. Returns false for any other click so livePreview can place the cursor / toggle a
// task. Mirrors Editor.tsx's mousedown link handling (filename-based wikilink open).
function navigateOnLinkClick(e: MouseEvent, view: EditorView): boolean {
  if (e.button !== 0) return false;
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
  if (pos == null) return false;
  const line = view.state.doc.lineAt(pos);
  // `(?<!!)` skips embeds (`![[...]]`) — those are media, not links.
  for (const m of line.text.matchAll(/(?<!!)\[\[([^\]]+?)\]\]/g)) {
    const s = line.from + (m.index ?? 0);
    if (pos >= s && pos <= s + m[0].length) {
      const target = m[1].split("|")[0].split("#")[0].trim();
      window.dispatchEvent(new CustomEvent("oa-open", { detail: target.endsWith(".md") ? target : `${target}.md` }));
      return true;
    }
  }
  for (const m of line.text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const s = line.from + (m.index ?? 0);
    if (pos >= s && pos <= s + m[0].length) {
      void openExternalUrl(m[2]);
      return true;
    }
  }
  for (const { start, end, url } of findBareUrls(line.text)) {
    if (pos >= line.from + start && pos <= line.from + end) {
      void openExternalUrl(url);
      return true;
    }
  }
  return false;
}
