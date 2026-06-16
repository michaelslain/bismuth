import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { EditorView, keymap, drawSelection, Decoration, WidgetType, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { EditorState, StateField, StateEffect, Facet, Annotation } from "@codemirror/state";
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
import { reorderTaskBlocks } from "../../../core/src/taskReorder";
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

// A task line: `- [<one char>] body`, possibly indented (writers normalize the bullet to `-`).
const TASK_LINE_RE = /^[ \t]*- \[.\] /;
function lineIndentWidth(text: string): number {
  const m = /^[ \t]*/.exec(text);
  return m ? m[0].length : 0;
}

// In a tasks card the editable region runs first-task → last-task, so it can include
// interleaved `## headings`, blank lines, and standalone prose between task blocks. We keep
// those lines in the document (so prefix+body+suffix stays the exact note — lossless save) but
// HIDE them so the card shows ONLY the checklist, matching the old read-only rendering. A line
// is shown when it's a task line OR an indented continuation/sub-line of the preceding task
// (deeper-indented, non-blank); every other line is collapsed to display:none.
//
// We never hide the line the caret is on, so the user can still click into / type a heading or
// add prose between tasks without it vanishing mid-edit.
//
// We mark whole hidden lines with a CSS class (a line decoration) rather than block-replacing
// them — a block-replace would also swallow the surrounding line breaks and confuse the caret,
// so we keep each line in the layout but collapse it to zero height with `display:none`.
const hideNonTaskTheme = EditorView.theme({
  ".cm-line.oa-card-hidden": { display: "none" },
});
// `focused` gates the caret-line exception: only protect the line the caret sits on while the
// editor is FOCUSED (so editing a heading/prose doesn't make it vanish mid-edit). An UNFOCUSED
// card editor parks its caret at offset 0 — which is usually the first heading — so without this
// gate that leading `## heading` would flash visible until the next re-render. Mirrors the
// focus gate in editor/livePreview.ts.
function hiddenLineDecorations(state: EditorState, focused: boolean): DecorationSet {
  const doc = state.doc;
  const head = state.selection.main.head;
  const ranges: { from: number; deco: Decoration }[] = [];
  let prevTaskIndent = -1;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;
    const isTask = TASK_LINE_RE.test(text);
    const indent = lineIndentWidth(text);
    const isContinuation = prevTaskIndent >= 0 && text.trim() !== "" && indent > prevTaskIndent;
    if (isTask) prevTaskIndent = indent;
    else if (!isContinuation) prevTaskIndent = -1;
    const show = isTask || isContinuation;
    const caretHere = focused && head >= line.from && head <= line.to;
    if (!show && !caretHere) ranges.push({ from: line.from, deco: hiddenLineClass });
  }
  return Decoration.set(ranges.map((r) => r.deco.range(r.from, r.from)));
}
const hiddenLineClass = Decoration.line({ class: "oa-card-hidden" });
// A ViewPlugin (not decorations.compute) so we can read view.hasFocus + recompute on focus change.
const hideNonTaskLines = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = hiddenLineDecorations(view.state, view.hasFocus);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.focusChanged) {
          this.decorations = hiddenLineDecorations(u.view.state, u.view.hasFocus);
        }
      }
    },
    { decorations: (v) => v.decorations },
  ),
  hideNonTaskTheme,
];

// --- "▾ N completed" collapse, per note path ------------------------------------------------
//
// In tasks mode resolved (done/cancelled) tasks are sunk to the bottom of each block; we hide
// that trailing run behind a clickable "▾ N completed" toggle, COLLAPSED BY DEFAULT (matching
// the old read-only BodyCard's `doneExpanded` Google-Keep section). The expanded/collapsed state
// is kept at module scope keyed by note path so it survives a card re-mount (BaseView re-resolving
// rows recreates the cards) — otherwise the section would silently re-collapse on every revalidate.
const doneExpanded = new Map<string, boolean>(); // path -> expanded (absent = collapsed default)
const cardPathFacet = Facet.define<string, string>({ combine: (v) => v[0] ?? "" });

function isResolvedChar(c: string): boolean {
  return c === "x" || c === "X" || c === "-";
}
function taskStatusChar(text: string): string | null {
  const m = /^[ \t]*- \[(.)\] /.exec(text);
  return m ? m[1] : null;
}

// The trailing run of resolved tasks across the whole checklist (resolved tasks are sunk to the
// bottom, so a single trailing run covers them). Returns the doc position where the run begins,
// the doc end, and the resolved-item count — or null when there's no foldable run (nothing
// resolved, or everything is resolved so there's no list context to keep open).
function resolvedRun(state: EditorState): { anchorPos: number; endPos: number; count: number } | null {
  const doc = state.doc;
  // Walk task items (a task line + its deeper-indented continuation lines), tracking the start
  // line of each. Non-task, non-continuation lines just separate blocks but don't break the
  // "trailing resolved" accounting since resolved tasks are sunk to the very bottom.
  const items: { resolved: boolean; startLine: number }[] = [];
  let prevTaskIndent = -1;
  for (let i = 1; i <= doc.lines; i++) {
    const text = doc.line(i).text;
    const status = taskStatusChar(text);
    const indent = lineIndentWidth(text);
    if (status !== null && !(prevTaskIndent >= 0 && indent > prevTaskIndent)) {
      items.push({ resolved: isResolvedChar(status), startLine: i });
      prevTaskIndent = indent;
    } else if (prevTaskIndent >= 0 && text.trim() !== "" && indent > prevTaskIndent) {
      // continuation/sub-line of the current item
    } else if (status === null) {
      prevTaskIndent = -1;
    }
  }
  let trailing = 0;
  for (let k = items.length - 1; k >= 0; k--) {
    if (items[k].resolved) trailing++;
    else break;
  }
  if (trailing === 0 || trailing === items.length) return null;
  const anchorLine = items[items.length - trailing].startLine;
  return { anchorPos: doc.line(anchorLine).from, endPos: doc.length, count: trailing };
}

const toggleDoneFold = StateEffect.define<void>();

// Expanded flag for THIS editor, seeded (collapsed by default) from the per-path map and written
// back through it on every toggle so it persists across re-mounts.
const doneFoldExpanded = StateField.define<boolean>({
  create(state) {
    return doneExpanded.get(state.facet(cardPathFacet)) ?? false;
  },
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) if (e.is(toggleDoneFold)) next = !next;
    if (next !== value) doneExpanded.set(tr.state.facet(cardPathFacet), next);
    return next;
  },
});

class DoneFoldWidget extends WidgetType {
  constructor(readonly count: number, readonly expanded: boolean) {
    super();
  }
  eq(o: DoneFoldWidget): boolean {
    return o.count === this.count && o.expanded === this.expanded;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("button");
    el.className = "oa-card-done-toggle";
    el.textContent = `${this.expanded ? "▾" : "▸"} ${this.count} completed`;
    el.addEventListener("mousedown", (e) => {
      e.preventDefault(); // don't move the caret into the (possibly hidden) run first
      view.dispatch({ effects: toggleDoneFold.of() });
    });
    return el;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

function doneFoldDecorations(state: EditorState): DecorationSet {
  const run = resolvedRun(state);
  if (!run) return Decoration.none;
  const expanded = state.field(doneFoldExpanded);
  const head = state.selection.main.head;
  const caretInside = head >= run.anchorPos && head <= run.endPos;
  // Toggle widget sits just before the resolved run.
  const ranges = [Decoration.widget({ block: true, side: -1, widget: new DoneFoldWidget(run.count, expanded || caretInside) }).range(run.anchorPos)];
  // Collapsed (and caret not inside it) → replace the run with nothing so it's hidden.
  if (!expanded && !caretInside) {
    ranges.push(Decoration.replace({ block: true }).range(run.anchorPos, run.endPos));
  }
  return Decoration.set(ranges, true);
}

const doneFoldTheme = EditorView.theme({
  ".oa-card-done-toggle": {
    display: "inline-flex",
    alignItems: "center",
    marginTop: "6px",
    padding: "4px 0",
    background: "none",
    border: "none",
    cursor: "pointer",
    font: "inherit",
    fontSize: "12px",
    color: "var(--text-muted)",
  },
  ".oa-card-done-toggle:hover": { color: "var(--fg)" },
});

function cardDoneFold(path: string) {
  return [
    cardPathFacet.of(path),
    doneFoldExpanded,
    EditorView.decorations.compute(["doc", "selection", doneFoldExpanded], doneFoldDecorations),
    doneFoldTheme,
  ];
}

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
  const tasksMode = props.mode === "tasks";

  // In tasks mode the checklist body is shown with resolved (done/cancelled) tasks SUNK to the
  // bottom of each block — both for display AND on disk (so the note matches what the card
  // shows). `reorderTaskBlocks` is pure + idempotent, so re-running it on already-sorted content
  // is a no-op (no spurious save). Body mode is untouched.
  const sink = (body: string): string => (tasksMode ? reorderTaskBlocks(body) : body);

  function buildView(raw: string) {
    if (disposed || view) return;
    const split = splitCard(raw, props.title, props.mode);
    prefix = split.prefix;
    suffix = split.suffix;
    const initialBody = sink(split.body);
    // If sinking reorders the body, persist that order: record the full file we'll actually save
    // (not the unsorted disk text) and flush once the view is up so disk matches the card.
    const sorted = initialBody !== split.body;
    lastSavedFull = sorted ? prefix + initialBody + suffix : raw;

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
        doc: initialBody,
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
          // Tasks card: show ONLY the checklist (hide interleaved headings/prose lines, which the
          // split keeps in the doc for a lossless save), keep resolved tasks sunk to the bottom of
          // their block, and collapse the trailing resolved run behind a "▾ N completed" toggle.
          ...(tasksMode ? [hideNonTaskLines, cardDoneFold(props.path)] : []),
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
    // Persist the sunk order so the note on disk matches the card. We didn't go through the
    // editor's autosave (no docChanged fired for the initial doc), so write directly.
    if (sorted) void save();
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
    // Sink resolved tasks for the shown body (tasks mode) so an external task toggle re-sinks.
    const nextBody = sink(split.body);
    if (view.state.doc.toString() === nextBody) return;
    // Full-document replace, preserving the caret/selection by character offset (clamped).
    const sel = view.state.selection.main;
    const len = nextBody.length;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextBody },
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
