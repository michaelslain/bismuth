// app/src/editor/tableWidget.ts
// A block-level CodeMirror widget that renders a GFM pipe table as a real, editable
// HTML <table>. Cells are contenteditable; edits commit back to the underlying
// markdown (replacing the table block's source range) when focus leaves the table.
// Tab / Shift-Tab / Enter move between cells; hover affordances add a row or column.
// The widget root is contenteditable=false so CodeMirror treats it as atomic and
// leaves its inner selection alone, while ignoreEvent() keeps CM from acting on
// clicks/keys inside it.
import { EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { TransactionSpec } from "@codemirror/state";
import { getSearchQuery, searchPanelOpen } from "@codemirror/search";
import {
  type Align,
  type TableBlock,
  type TableGrid,
  type CellKeyAction,
  groupTableBlocks,
  parseRowCellSpans,
  serializeTable,
  formatTable,
  prettifyTableBlock,
  decideCellKey,
  cellListContinuation,
  enterAction,
  insertRow,
  deleteRow,
  insertColumn,
  deleteColumn,
  appendToCell,
} from "./tableModel";
// CodeMirror's document `Text` — aliased so it never shadows the DOM `Text` node type used by
// the find-highlight text-node walk below.
import type { Text as CMText } from "@codemirror/state";
import { noteNamesFacet, setActiveTableEffect } from "./tableState";
import { renderInlineMarkdown } from "./inlineMarkdown";
import { onMathReady } from "./katexLoader";
import { api } from "../api";
import { parseWikilink, resolveNotePath } from "./wikilink";
import { closerFor } from "./wrapSelection";
import { settings } from "../settings";

// Visual column widths / row heights have no representation in GFM markdown, so they are
// persisted OUT of the source: in localStorage, keyed by the note path (one entry per
// note) and sub-keyed by the table's header row. A body-cell edit that rebuilds the
// widget keeps the same header → same key → sizes restored; they reset only if the header
// or column count changes. Path-less buffers (none in practice) fall back to memory.
type TableSizes = { cols: (number | null)[]; rows: (number | null)[] };
const STORE_PREFIX = "bismuth:table-size:";
const memStore = new Map<string, TableSizes>();
const sizeKey = (cells: string[][]): string => JSON.stringify(cells[0] ?? []);

// When Enter on the LAST row grows the table (#42), committing the new row REBUILDS the widget
// (a doc change → a fresh `TableWidget.toDOM`), so the old cell's focus is lost. We stash the
// grid coordinate to focus and let the NEXT rebuild of the same table (matched by its stable
// header `sizeKey`, which a row insert doesn't change) claim it. One-shot: consumed by the first
// matching `toDOM`. Module-level because the committing widget instance is discarded on rebuild.
let pendingCellFocus: { key: string; r: number; c: number } | null = null;

function loadSizes(path: string | null, key: string): TableSizes | null {
  try {
    if (path && typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORE_PREFIX + path);
      return raw ? (JSON.parse(raw)[key] ?? null) : null;
    }
  } catch {
    /* corrupt/blocked storage → fall through to memory */
  }
  return memStore.get(`${path ?? ""} ${key}`) ?? null;
}

function saveSizes(path: string | null, key: string, val: TableSizes): void {
  try {
    if (path && typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORE_PREFIX + path);
      const all = raw ? JSON.parse(raw) : {};
      all[key] = val;
      localStorage.setItem(STORE_PREFIX + path, JSON.stringify(all));
      return;
    }
  } catch {
    /* corrupt/blocked storage → fall through to memory */
  }
  memStore.set(`${path ?? ""} ${key}`, val);
}

// A zero-width space used as a contenteditable "filler" after a trailing <br>: a <br>
// that is the last node renders no visible empty line and the caret can't sit past it,
// so we keep a ZWSP after it. Stripped back out by `cellSourceFromDom`.
const ZWSP = "\u200b";

/** Reveal a cell's raw markdown source for editing, but turn its `<br>` line-break
 *  markers into REAL line breaks so the edit face is genuinely multi-line (everything
 *  else stays raw markdown text). The inverse of `cellSourceFromDom`. */
function srcToEditHtml(src: string): string {
  const esc = src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = esc.replace(/&lt;br\s*\/?&gt;/gi, "<br>");
  // A trailing <br> needs a follower to render its empty line + host the caret.
  return /<br>$/.test(html) ? html + ZWSP : html;
}

/** Read a cell's edit-face DOM back to single-line GFM source. The edit face holds only
 *  text nodes and <br> elements (see srcToEditHtml / insertBreakAtCaret), so each <br>
 *  maps to a `<br>` marker — including a TRAILING one, which `innerText` would silently
 *  drop (the root cause of a Shift+Enter break sometimes not saving). The inverse of
 *  `srcToEditHtml`.
 *
 *  A contenteditable can encode an in-cell line break THREE ways depending on browser /
 *  edit history: a real `<br>` element, a `<div>`-wrapped continuation line, or a raw `\n`
 *  CHARACTER inside a text node. We normalize ALL of them to the `<br>` marker so the stored
 *  source is uniform and list detection (cellList.ts) sees the breaks. The `\n` case is the
 *  reopened #15 bug: it USED to collapse to a SPACE, turning a typed list "- a\n- b" into
 *  "- a - b" — which `splitCellItems` deliberately refuses to re-split (a space before the
 *  dash reads as prose, not a marker), so the list silently vanished. Mapping `\n` → `<br>`
 *  keeps the break, so the cell renders as the list the user typed. */
function cellSourceFromDom(cell: HTMLElement): string {
  let out = "";
  cell.childNodes.forEach((n) => {
    out += n.nodeName === "BR" ? "<br>" : (n.textContent ?? "");
  });
  // Drop ZWSP fillers, then encode any raw newline as an in-cell `<br>` break — NOT a space,
  // which was the #15 list-loss bug (a typed "- a\n- b" collapsed to "- a - b" and stopped
  // reading as a list, because splitCellItems refuses to split a space-before-dash as prose).
  // `.trim()` only strips surrounding whitespace, never the `<br>` markers, so a deliberate
  // trailing Shift+Enter break (a real `<br>` + ZWSP) — and any intentional blank line typed as
  // two breaks — is preserved.
  return out
    .replace(new RegExp(ZWSP, "g"), "")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

/** Insert a real <br> element at the caret. Deterministic, unlike
 *  execCommand("insertLineBreak"), which variously yields a <br>, a <div> wrapper, or
 *  literal `\n` text depending on engine/position — the source of the flaky behavior. */
function insertBreakAtCaret(): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const br = document.createElement("br");
  range.insertNode(br);
  // Does any RENDERABLE content follow the <br>? A trailing <br> followed by nothing — or
  // only empty/whitespace text nodes that range.insertNode can leave behind — renders no
  // empty line and can't host the caret (the "must press twice" bug). Treat such nodes as
  // absent and add a single ZWSP filler the caret lands on; `cellSourceFromDom` strips it.
  let after: ChildNode | null = br.nextSibling;
  let hasVisibleAfter = false;
  while (after) {
    if (after.nodeName === "BR" || (after.textContent ?? "").replace(new RegExp(ZWSP, "g"), "").trim() !== "") {
      hasVisibleAfter = true;
      break;
    }
    after = after.nextSibling;
  }
  const next = document.createRange();
  if (hasVisibleAfter) {
    next.setStartAfter(br); // mid-text break: caret onto the new line, after the <br>
  } else {
    for (let n = br.nextSibling; n; ) { const m = n.nextSibling; n.remove(); n = m; } // drop empty trailers
    const filler = document.createTextNode(ZWSP);
    br.after(filler);
    next.setStart(filler, 0);
  }
  next.collapse(true);
  sel.removeAllRanges();
  sel.addRange(next);
}

/** Insert plain text at the caret and leave the caret after it. Used to drop the next
 *  list marker (`- ` / `3. `) onto a freshly-broken in-cell line. */
function insertTextAtCaret(text: string): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  const next = document.createRange();
  next.setStartAfter(node);
  next.collapse(true);
  sel.removeAllRanges();
  sel.addRange(next);
}

/** Typing a configured wrap character (`*`/`_`/`~`/backtick by default —
 *  `settings.editor.wrapSelectionChars`) over a non-empty selection surrounds it instead of
 *  replacing it, matching the main editor's `wrapSelection` extension (editor/wrapSelection.ts)
 *  — which never runs here, since a cell is a plain contenteditable DOM island CodeMirror's own
 *  input handling never sees (#45). Returns false (caller falls through to native contenteditable
 *  typing) when the setting's off, `key` isn't a single configured char, or nothing's selected. */
export function wrapCellSelectionOnType(cell: HTMLElement, key: string): boolean {
  if (!settings.editor.wrapSelection || key.length !== 1 || !settings.editor.wrapSelectionChars.includes(key)) {
    return false;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!cell.contains(range.commonAncestorContainer)) return false;
  const close = closerFor(key);
  const text = range.toString();
  range.deleteContents();
  const node = document.createTextNode(key + text + close);
  range.insertNode(node);
  // Reselect the inner text (not the markers) so a second press nests it, e.g. `word` -> ``word``.
  const inner = document.createRange();
  inner.setStart(node, key.length);
  inner.setEnd(node, key.length + text.length);
  sel.removeAllRanges();
  sel.addRange(inner);
  return true;
}

/** Flatten a node's cell-edit-face content to text, mapping each `<br>` to a newline so
 *  callers can reason about the cell as multi-line text (the edit face is a flat run of
 *  text nodes + `<br>`s — see srcToEditHtml / insertBreakAtCaret). */
function fragText(node: Node): string {
  let out = "";
  node.childNodes.forEach((n) => {
    if (n.nodeName === "BR") out += "\n";
    else if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? "";
    else out += fragText(n);
  });
  return out;
}

/** The text of the cell line the (collapsed) caret sits on, plus the raw character counts
 *  before/after the caret ON THAT LINE (for a precise in-line delete). Returns null unless
 *  there's a single collapsed caret inside `cell`. ZWSP fillers are stripped from `line`
 *  (marker detection) but counted in before/after (so a delete removes them too). */
function caretCellLine(cell: HTMLElement): { line: string; beforeLen: number; afterLen: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const caret = sel.getRangeAt(0);
  if (!caret.collapsed || !cell.contains(caret.startContainer)) return null;
  const beforeR = document.createRange();
  beforeR.selectNodeContents(cell);
  beforeR.setEnd(caret.startContainer, caret.startOffset);
  const afterR = document.createRange();
  afterR.selectNodeContents(cell);
  afterR.setStart(caret.startContainer, caret.startOffset);
  const before = fragText(beforeR.cloneContents());
  const after = fragText(afterR.cloneContents());
  const beforeLine = before.slice(before.lastIndexOf("\n") + 1);
  const afterLine = after.split("\n", 1)[0];
  const strip = (s: string): string => s.replace(new RegExp(ZWSP, "g"), "");
  return { line: strip(beforeLine + afterLine), beforeLen: beforeLine.length, afterLen: afterLine.length };
}

/** Delete `beforeLen` characters back and `afterLen` forward from the caret (the current
 *  line's marker, when exiting an in-cell list). Uses execCommand — as the paste handler
 *  does — so the contenteditable's own undo/caret bookkeeping stays consistent. */
function deleteCurrentLine(beforeLen: number, afterLen: number): void {
  for (let i = 0; i < beforeLen; i++) document.execCommand("delete");
  for (let i = 0; i < afterLen; i++) document.execCommand("forwardDelete");
}

// Item shape understood by App's shared `bismuth-context-menu` handler (mirrors EditorMenuItem).
type TableMenuItem = { label: string; onSelect: () => void; icon?: string; disabled?: boolean; separatorBefore?: boolean };

/** Build a `+` edge bar (add row / add column). Fires `onTrigger` on mousedown without
 *  moving the editor selection or losing cell focus. */
function edgeBar(cls: string, label: string, onTrigger: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `cm-table-edge ${cls}`;
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.textContent = "+";
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onTrigger();
  });
  return btn;
}

/** Read the current cell grid (raw markdown SOURCE per cell) out of the rendered table
 *  DOM. A cell normally displays rendered markdown, so its source is kept in `data-src`;
 *  the one cell currently being edited holds its live (possibly unsaved) source as the
 *  contenteditable text, so we read that — this captures an in-flight edit when a
 *  `+`/menu action commits while a cell still has focus. */
function readGrid(root: HTMLElement): string[][] {
  const rows: string[][] = [];
  for (const tr of Array.from(root.querySelectorAll("tr"))) {
    const cells = Array.from(tr.querySelectorAll<HTMLElement>("[data-cell]"));
    if (cells.length)
      rows.push(
        cells.map((c) =>
          // The edited cell may hold live multi-line DOM; everything else holds its
          // already-encoded (`<br>`-marked) source.
          c.dataset.editing === "1" ? cellSourceFromDom(c) : (c.dataset.src ?? "").trim(),
        ),
      );
  }
  return rows;
}

/** Find the source range of the table block this widget currently occupies.
 *  Recomputed from the live doc at commit time so edits elsewhere don't desync it. */
function currentRange(view: EditorView, root: HTMLElement): { from: number; to: number } | null {
  let pos: number;
  try {
    pos = view.posAtDOM(root);
  } catch {
    return null;
  }
  const doc = view.state.doc;
  const { blocks } = groupTableBlocks(doc);
  const containing = blocks.find((b) => pos >= doc.line(b.startLine).from && pos <= doc.line(b.endLine).to);
  const after = containing ?? blocks.find((b) => doc.line(b.startLine).from >= pos);
  if (!after) return null;
  return { from: doc.line(after.startLine).from, to: doc.line(after.endLine).to };
}

/** Dispatch a transaction while PINNING the editor's scroll position, so a table edit
 *  (add row/column, prettify-on-source) that changes the block widget's height never
 *  yanks the viewport. Replacing the table block re-lays a block widget, and CodeMirror
 *  re-measures line heights ASYNCHRONOUSLY (over MULTIPLE frames as the taller table settles)
 *  after the reconcile — that measure resets scrollTop (the "adding a row scrolls me down"
 *  bug, #36). A single synchronous restore fires too EARLY (before CM re-measures), which is
 *  why a row insert still jumped "sometimes." So we belt-and-suspenders it three ways:
 *    1. `EditorView.scrollSnapshot()` folded into the SAME transaction — CM anchors the current
 *       scroll to a doc position and re-applies it AFTER its own async height re-measure (the
 *       robust primitive that survives the settle the manual restore misses);
 *    2. a synchronous restore right after dispatch;
 *    3. a `requestMeasure` restore after CM's layout pass.
 *  Mirrors the established `foldBlocks.preserveScroll` idiom, hardened with the snapshot. */
function dispatchKeepScroll(view: EditorView, spec: TransactionSpec): void {
  const scroller = view.scrollDOM;
  const top = scroller.scrollTop;
  const left = scroller.scrollLeft;
  // Merge the scroll snapshot into the transaction's effects (keeping any the caller passed).
  const snapshot = view.scrollSnapshot();
  const existing = spec.effects;
  const effects = existing == null ? snapshot : Array.isArray(existing) ? [...existing, snapshot] : [existing, snapshot];
  view.dispatch({ ...spec, effects });
  scroller.scrollTop = top;
  scroller.scrollLeft = left;
  view.requestMeasure({
    read: () => top,
    write: (t) => {
      scroller.scrollTop = t;
      scroller.scrollLeft = left;
    },
  });
}

/** Resolve a file-drop target to a table cell (#30). A rendered table is an ATOMIC block
 *  widget, so the editor's `view.posAtCoords(dropPoint)` maps a drop anywhere over it to the
 *  block BOUNDARY — an image dropped on a cell would land beside the table in the note body,
 *  not in the cell. Given the drop event's target node, this returns the cell's grid
 *  coordinate `(r, c)` plus the table block's CURRENT source range (the `from` anchor lets the
 *  async insert re-find the block after the upload), or null when the drop isn't over a cell. */
/** True while a table cell inside this view is focused (#46). A focused cell's keystrokes
 *  live only in its contenteditable DOM until the blur commit — any doc reconcile that
 *  intersects the table rebuilds the widget (eq() compares serialized source) and destroys
 *  them. Callers (Editor.tsx's external-reconcile paths) defer disk pulls while this holds
 *  and re-run them on the cell's blur. */
export function hasActiveCellEdit(view: EditorView): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el || !view.dom.contains(el)) return false;
  return !!el.closest?.("[data-cell]");
}

export function tableCellDropTarget(
  view: EditorView,
  target: EventTarget | null,
): { from: number; to: number; r: number; c: number } | null {
  const el = target instanceof HTMLElement ? target : (target as Node | null)?.parentElement ?? null;
  const cell = el?.closest?.("[data-cell]") as HTMLElement | null;
  const wrap = cell?.closest(".cm-table-wrap") as HTMLElement | null;
  if (!cell || !wrap) return null;
  const range = currentRange(view, wrap);
  if (!range) return null;
  const r = Number(cell.getAttribute("data-r"));
  const c = Number(cell.getAttribute("data-c"));
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return { from: range.from, to: range.to, r, c };
}

/** Insert `embeds` (`![[…]]` markers) into cell (r, c) of the table whose block currently
 *  spans `anchorFrom`, then commit the reformatted table back to source (#30). The drop's
 *  upload is async, so the block is RE-RESOLVED from the live doc here (its start position is
 *  stable across our own in-place table edits) rather than trusting a range captured before
 *  the await. Returns false if the table/cell no longer exists, so the caller can fall back to
 *  a note-body insert instead of dropping the image silently. */
export function insertEmbedsInTableCell(
  view: EditorView,
  anchorFrom: number,
  r: number,
  c: number,
  embeds: string[],
): boolean {
  if (embeds.length === 0) return false;
  const doc = view.state.doc;
  const { blocks } = groupTableBlocks(doc);
  const block = blocks.find(
    (b) => doc.line(b.startLine).from <= anchorFrom && anchorFrom <= doc.line(b.endLine).to,
  );
  if (!block) return false;
  const cols = block.cells[0]?.length ?? 0;
  if (r < 0 || r >= block.cells.length || c < 0 || c >= cols) return false;
  const grid = appendToCell({ cells: block.cells, aligns: block.aligns }, r, c, embeds.join("<br>"));
  const md = formatTable(grid);
  const from = doc.line(block.startLine).from;
  const to = doc.line(block.endLine).to;
  if (view.state.sliceDoc(from, to) === md) return false;
  // Move CM's own selection to the block start BEFORE committing (like "Edit source" already
  // does below) — a cell's contenteditable DOM lives outside CM's own selection tracking, so
  // `state.selection` is still wherever it was before this drop (e.g. wherever the user was
  // last typing). That matters because CM's history() records an edit's undo-position from the
  // selection as it was BEFORE the edit (`tr.startState.selection` — see
  // @codemirror/commands' `HistEvent.fromTransaction`), not whatever `selection:` the edit's OWN
  // transaction spec sets (that only affects the AFTER state). Left unmoved, a later undo would
  // restore that stale before-edit position — often the doc end — instead of back to this table
  // (#44). A plain selection-only dispatch doesn't scroll (no `scrollIntoView`), so this is
  // visually inert.
  view.dispatch({ selection: { anchor: from } });
  // Growing the cell can change the block widget's height — pin the scroll like every other
  // table edit so CM's async height re-measure doesn't yank the viewport.
  dispatchKeepScroll(view, { changes: { from, to, insert: md } });
  return true;
}

/** Open a wikilink clicked inside a rendered table cell (#33). The cell is a contenteditable
 *  inside an atomic block widget whose mousedown stops propagation, so CM's own wikilink click
 *  handler never fires — we resolve + dispatch the SAME `bismuth-open` event it does. Note
 *  candidates come from `noteNamesFacet` (provided by the editor host) so a basename resolves to
 *  its real vault path (subfolder notes open correctly); an unresolved target opens as a new note
 *  at the typed name, matching the note-body wikilink behavior. A `#heading` rides along. */
function openCellWikilink(view: EditorView, raw: string): void {
  const { target, heading } = parseWikilink(raw);
  if (!target) return;
  const notes = view.state.facet(noteNamesFacet)?.() ?? [];
  const resolved = resolveNotePath(target, notes);
  window.dispatchEvent(
    new CustomEvent("bismuth-open", { detail: { path: (resolved ?? target) + ".md", heading } }),
  );
}

export class TableWidget extends WidgetType {
  constructor(
    private readonly cells: string[][],
    private readonly aligns: Align[],
    private readonly notePath: string | null = null,
  ) {
    super();
  }

  // Re-render only when the rendered content changes. Identical content (e.g. on a
  // cursor move elsewhere) keeps the existing DOM, preserving any in-progress edit.
  eq(other: TableWidget): boolean {
    return serializeTable(this.cells, this.aligns) === serializeTable(other.cells, other.aligns);
  }

  // Commit the DOM grid (optionally transformed) back to the markdown source. A transform
  // returns the NEW grid (the pure tableModel row/column ops), or void to edit in place.
  private commit(view: EditorView, root: HTMLElement, transform?: (g: TableGrid) => TableGrid | void): void {
    const range = currentRange(view, root);
    if (!range) return;
    let grid: TableGrid = { cells: readGrid(root), aligns: this.aligns.slice() };
    grid = transform?.(grid) ?? grid;
    const md = formatTable(grid); // column-padded, LLM-readable GFM
    if (view.state.sliceDoc(range.from, range.to) === md) return; // no-op: skip churn
    // Move CM's own selection to the block start FIRST, matching "Edit source" (openCellMenu
    // below): every cell edit here happens inside a contenteditable DOM island CM's own
    // selection never tracks, so `state.selection` is still wherever it was before this edit. A
    // changes-only dispatch's OWN `selection:` field can't fix this retroactively — CM's
    // history() records an edit's undo-position from the selection as it was BEFORE the edit
    // (`tr.startState.selection`), not the after-state a same-transaction `selection:` sets (see
    // @codemirror/commands' `HistEvent.fromTransaction`). Left unmoved, a later undo restores
    // that stale before-edit position — often the doc end — instead of back here (#44). A plain
    // selection-only dispatch doesn't scroll (no `scrollIntoView`), so this is visually inert.
    view.dispatch({ selection: { anchor: range.from } });
    // Pin the scroll position: growing the table (add row/column) re-lays the block
    // widget and CM's async height re-measure would otherwise scroll the viewport away.
    dispatchKeepScroll(view, { changes: { from: range.from, to: range.to, insert: md } });
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-table-wrap";
    root.setAttribute("contenteditable", "false");

    const table = document.createElement("table");
    table.className = "cm-table-rendered";

    // A cell has two faces: a DISPLAY face (rendered inline markdown, shown when idle)
    // and an EDIT face (raw markdown source as plain text, shown while focused). We swap
    // between them on focus so the user formats prose but edits the underlying markdown.
    const renderDisplay = (cell: HTMLElement): void => {
      // Pass the asset-URL builder so image/pdf embeds in the cell render as real media from
      // GET /asset (#30) — exactly like embedBlock.ts does in the note body.
      cell.innerHTML = renderInlineMarkdown(cell.dataset.src ?? "", { assetUrl: api.assetUrl });
      // Inline `$math$` renders empty until KaTeX lazy-loads; re-render this cell once it
      // lands (unless the user has since started editing it).
      const maths = cell.querySelectorAll<HTMLElement>(".cm-inline-math");
      if (maths.length && Array.from(maths).some((m) => !m.firstChild)) {
        onMathReady(() => {
          if (cell.isConnected && cell.dataset.editing !== "1") renderDisplay(cell);
        });
      }
    };
    const enterEdit = (cell: HTMLElement): void => {
      if (cell.dataset.editing === "1") return;
      cell.dataset.editing = "1";
      cell.innerHTML = srcToEditHtml(cell.dataset.src ?? ""); // reveal raw markdown (with real line breaks)
    };
    const leaveEdit = (cell: HTMLElement): void => {
      if (cell.dataset.editing !== "1") return;
      cell.dataset.editing = "";
      cell.dataset.src = cellSourceFromDom(cell);
      renderDisplay(cell); // back to the formatted face
    };

    const focusCell = (r: number, c: number): boolean => {
      const el = root.querySelector<HTMLElement>(`[data-cell][data-r="${r}"][data-c="${c}"]`);
      if (!el) return false;
      el.focus();
      // place caret at end
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return true;
    };

    const cols = this.cells[0]?.length ?? 0;
    // A <col> per column carries explicit drag-resize widths without touching the
    // contenteditable cells (which rewrite their own content on focus and would drop a
    // style set directly on them). The colgroup must be the table's first child.
    const colgroup = document.createElement("colgroup");
    const colEls: HTMLTableColElement[] = [];
    for (let c = 0; c < cols; c++) {
      const col = document.createElement("col");
      colgroup.appendChild(col);
      colEls.push(col);
    }
    table.appendChild(colgroup);
    const rowEls: HTMLElement[] = [];
    this.cells.forEach((row, r) => {
      const tr = document.createElement("tr");
      for (let c = 0; c < cols; c++) {
        const isHeader = r === 0;
        const cell = document.createElement(isHeader ? "th" : "td");
        cell.className = "cm-td";
        cell.setAttribute("data-cell", "");
        cell.setAttribute("data-r", String(r));
        cell.setAttribute("data-c", String(c));
        cell.setAttribute("contenteditable", "true");
        cell.setAttribute("spellcheck", "false");
        const a = this.aligns[c] ?? "none";
        if (a !== "none") cell.style.textAlign = a;
        cell.dataset.src = row[c] ?? ""; // raw markdown source (source of truth)
        renderDisplay(cell); // initial face: rendered inline markdown
        // Swap to the raw-source face on focus and back to the rendered face on blur, so
        // the cell shows formatted markdown when idle but is edited as plain source.
        cell.addEventListener("focusin", () => enterEdit(cell));
        cell.addEventListener("focusout", () => leaveEdit(cell));
        // Take control of the mousedown so CodeMirror's own handler doesn't move the
        // editor selection to the (atomic) widget boundary and focus the doc instead of
        // the cell (stopPropagation). Once the cell is already in its editable (raw-source)
        // face, let the browser handle the rest NATIVELY so click-drag TEXT SELECTION and
        // double-click word-select work — calling preventDefault here (as the old code did
        // on every mousedown) collapses/kills the native selection gesture, which is why
        // "can't highlight text inside a table cell" happened. Only for the FIRST click
        // (entering edit mode from the rendered display face) do we preventDefault + focus
        // + drop the caret ourselves, because focusin swaps the cell's innerHTML to the
        // raw-source face and would invalidate a caret the browser had just placed.
        cell.addEventListener("mousedown", (e) => {
          const me = e as MouseEvent;
          // Right-click (#43): show ONLY the context menu, never a NEW selection. Chromium's
          // contenteditable default selects the word under the pointer on a right mousedown — so
          // right-clicking both highlighted the word AND opened the menu. `preventDefault` here
          // suppresses that word-select without clearing an EXISTING selection (a right-click on a
          // selection keeps it), and the separate `contextmenu` listener still opens the menu. We
          // stop propagation so CM doesn't also act, and return before the caret-placement path.
          if (me.button === 2) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          // A left-click on a RENDERED wikilink chip in the display face OPENS the target (#33)
          // instead of entering edit mode. The `e.stopPropagation()` below means CM's own
          // wikilink click handler never sees this click, so we run the same open path here.
          if (cell.dataset.editing !== "1" && me.button === 0) {
            const link = (me.target as HTMLElement | null)?.closest?.(".cm-wikilink") as HTMLElement | null;
            if (link && cell.contains(link)) {
              e.preventDefault();
              e.stopPropagation();
              openCellWikilink(view, link.dataset.wikilink ?? "");
              return;
            }
          }
          e.stopPropagation();
          if (cell.dataset.editing === "1") return; // native caret + drag-to-select
          e.preventDefault();
          cell.focus();
          const sel = window.getSelection();
          if (!sel) return;
          // caretRangeFromPoint (Chrome/Safari) / caretPositionFromPoint (Firefox).
          const docAny = document as unknown as {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
            caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
          };
          let range: Range | null = docAny.caretRangeFromPoint?.(me.clientX, me.clientY) ?? null;
          if (!range && docAny.caretPositionFromPoint) {
            const cp = docAny.caretPositionFromPoint(me.clientX, me.clientY);
            if (cp) {
              range = document.createRange();
              range.setStart(cp.offsetNode, cp.offset);
              range.collapse(true);
            }
          }
          if (!range || !cell.contains(range.startContainer)) {
            range = document.createRange();
            range.selectNodeContents(cell);
            range.collapse(false);
          }
          sel.removeAllRanges();
          sel.addRange(range);
        });
        // Paste as plain text (collapse newlines) — a cell is one line of markdown.
        cell.addEventListener("paste", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r?\n/g, " ");
          document.execCommand("insertText", false, text);
        });
        cell.addEventListener("keydown", (e) => {
          const ev = e as KeyboardEvent;
          // A configured wrap char (e.g. backtick) typed over a selection surrounds it — see
          // wrapCellSelectionOnType (#45). Checked before decideCellKey/the modifier-driven
          // actions below since it only ever matches a plain, unmodified single character.
          if (!ev.metaKey && !ev.ctrlKey && !ev.altKey && wrapCellSelectionOnType(cell, ev.key)) {
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          const action: CellKeyAction = decideCellKey(ev);
          // A `pass-through` is a global app shortcut (Mod+O quick-switcher, Mod+P command
          // palette, Mod+F find, Mod+` terminal, …). We deliberately do NOT stopPropagation
          // or preventDefault, so it bubbles out of the cell to App.tsx's `window` keydown
          // handler exactly like a normal editor keystroke would. Swallowing these (the old
          // unconditional stopPropagation) is why "Cmd+O doesn't work inside a table". Every
          // OTHER key is cell-local, so we stop it reaching CM's contentDOM keymap (the cell
          // is an editing island) before acting on it.
          if (action === "pass-through") return;
          ev.stopPropagation();
          switch (action) {
            case "select-cell": {
              // Mod+A natively selects the whole contenteditable host (the editor), not the
              // nested cell — scope it to the cell ourselves.
              ev.preventDefault();
              const sel = window.getSelection();
              if (sel) {
                const range = document.createRange();
                range.selectNodeContents(cell);
                sel.removeAllRanges();
                sel.addRange(range);
              }
              return;
            }
            case "block-format":
              // Mod+B/I/U would inject <b>/<i>/<u> markup into a plain-markdown cell — swallow.
              ev.preventDefault();
              return;
            case "tab-next":
              ev.preventDefault();
              if (c + 1 < cols) focusCell(r, c + 1);
              else if (r + 1 < this.cells.length) focusCell(r + 1, 0);
              else cell.blur();
              return;
            case "tab-prev":
              ev.preventDefault();
              if (c - 1 >= 0) focusCell(r, c - 1);
              else if (r - 1 >= 0) focusCell(r - 1, cols - 1);
              else cell.blur();
              return;
            case "newline":
              // Soft line break WITHIN the cell: insert a real <br> so the caret moves down
              // and the cell grows. On commit `cellSourceFromDom` encodes it as a `<br>`
              // marker (a GFM cell is one source line), which the display face renders back.
              ev.preventDefault();
              insertBreakAtCaret();
              return;
            case "next-row": {
              ev.preventDefault();
              // In-cell list continuation (#15): if the caret's line is a `- `/`N.` list
              // item, Enter continues the list in-cell instead of anything else.
              const lineInfo = caretCellLine(cell);
              const cont = lineInfo ? cellListContinuation(lineInfo.line) : null;
              if (cont && cont !== "exit") {
                // Non-empty item → open the next marker on a new in-cell line.
                insertBreakAtCaret();
                insertTextAtCaret(cont.marker);
                return;
              }
              if (cont === "exit" && lineInfo) {
                // Empty marker → drop it and leave the list, then apply the base Enter action.
                deleteCurrentLine(lineInfo.beforeLen, lineInfo.afterLen);
              }
              // #42: Enter behaves like Shift+Enter (a soft in-cell line break) on EVERY row
              // except the LAST, where it grows the table by a row and drops the caret into it.
              if (enterAction(r, this.cells.length) === "line-break") {
                insertBreakAtCaret();
                return;
              }
              // Last row → append a blank row and focus its same column after the widget rebuilds.
              pendingCellFocus = { key: sizeKey(this.cells), r: this.cells.length, c };
              this.commit(view, root, (g) => insertRow(g, g.cells.length));
              return;
            }
            case "leave":
              ev.preventDefault();
              cell.blur();
              return;
            case "edit":
              // A plain key (typing, arrows, etc.): native contenteditable handles the input;
              // we only shielded it from CM's keymap above. No preventDefault.
              return;
          }
        });
        tr.appendChild(cell);
      }
      table.appendChild(tr);
      rowEls.push(tr);
    });

    root.appendChild(table);

    // Commit when focus leaves the whole table (moving between cells stays inside). This
    // covers Enter/Escape/Tab-out, which blur the cell without a CodeMirror view update.
    root.addEventListener("focusout", (e) => {
      const next = (e as FocusEvent).relatedTarget as Node | null;
      if (next && root.contains(next)) return;
      this.commit(view, root);
    });

    // Add-row / add-column `+` bars along the bottom and right edges (Notion-style),
    // shown on hover. `fit-content` on the wrap keeps them flush against the table.
    root.appendChild(
      edgeBar("cm-table-add-col", "Add column", () => this.commit(view, root, (g) => insertColumn(g, g.cells[0]?.length ?? 0))),
    );
    root.appendChild(
      edgeBar("cm-table-add-row", "Add row", () => this.commit(view, root, (g) => insertRow(g, g.cells.length))),
    );

    // Drop an image/media FILE onto a cell → embed it INTO that cell (#30). A rendered table is an
    // atomic block widget whose contenteditable cells reroute the browser's native file drop before
    // CM's own `drop` handler (Editor.tsx) can see it — so a dropped image landed in the note body,
    // or nowhere. CAPTURE-phase listeners on the widget root intercept it FIRST: `dragover` must
    // preventDefault to mark the cell a valid drop target (else no `drop` fires at all), and `drop`
    // resolves the target cell and hands the File list to Editor.tsx's SAME upload+embed flow via a
    // window event (the widget can't import that flow without a cycle). stopPropagation keeps CM's
    // bubble-phase drop handler from ALSO firing (no double insert).
    const dtHasFiles = (dt: DataTransfer | null): boolean =>
      !!dt && (Array.from(dt.types ?? []).includes("Files") || (dt.items?.length ?? 0) > 0 || (dt.files?.length ?? 0) > 0);
    root.addEventListener(
      "dragover",
      (e) => {
        const de = e as DragEvent;
        if (!dtHasFiles(de.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        if (de.dataTransfer) de.dataTransfer.dropEffect = "copy";
      },
      true,
    );
    root.addEventListener(
      "drop",
      (e) => {
        const de = e as DragEvent;
        const files = de.dataTransfer ? Array.from(de.dataTransfer.files) : [];
        if (files.length === 0) return; // not a file drop — let text-drop fall through
        const target = tableCellDropTarget(view, de.target);
        if (!target) return; // drop wasn't over a cell — leave it to the normal handler
        e.preventDefault();
        e.stopPropagation();
        // Editor.tsx owns the vault upload + attachment settings; hand off (with the resolved cell +
        // altKey for the reference-vs-copy choice). It matches this event to its own `view`.
        window.dispatchEvent(
          new CustomEvent("bismuth-table-drop", { detail: { view, files, target, altKey: de.altKey } }),
        );
      },
      true,
    );

    // Right-click a cell → a table-specific menu (insert/delete row & column, edit
    // source), dispatched to App's shared <ContextMenu> via the `bismuth-context-menu` event.
    table.addEventListener("contextmenu", (e) => {
      const td = (e.target as HTMLElement).closest("[data-cell]");
      if (!td) return;
      e.preventDefault();
      e.stopPropagation();
      this.openCellMenu(view, root, e as MouseEvent, Number(td.getAttribute("data-r")), Number(td.getAttribute("data-c")));
    });

    // ---- Drag-to-resize: column widths + row heights -------------------------
    // GFM has no syntax for cell sizes, so these live outside the source. A thin grab
    // strip on each column/row border lives in an overlay (kept OUT of the contenteditable
    // cells, which rewrite their content on focus). Chosen sizes are persisted per-note in
    // localStorage so they survive both a widget rebuild and a full reload.
    const MIN_COL = 40;
    const MIN_ROW = 24;

    const stored = loadSizes(this.notePath, sizeKey(this.cells));
    if (stored) {
      if (stored.cols.some((w) => w != null)) {
        table.style.tableLayout = "fixed";
        stored.cols.forEach((w, c) => {
          if (w != null && colEls[c]) colEls[c].style.width = `${w}px`;
        });
      }
      stored.rows.forEach((h, r) => {
        if (h != null && rowEls[r]) rowEls[r].style.height = `${h}px`;
      });
    }

    const overlay = document.createElement("div");
    overlay.className = "cm-table-overlay";
    overlay.setAttribute("contenteditable", "false");
    const colHandles: HTMLElement[] = [];
    const rowHandles: HTMLElement[] = [];

    const persist = (): void => {
      saveSizes(this.notePath, sizeKey(this.cells), {
        cols: colEls.map((c) => (c.style.width ? parseFloat(c.style.width) : null)),
        rows: rowEls.map((tr) => (tr.style.height ? parseFloat(tr.style.height) : null)),
      });
    };

    // Re-place every handle on its border. The table sits at the wrap origin, so offsets
    // are measured against it; called after attach, on table resize, and live mid-drag.
    const layout = (): void => {
      const tw = table.offsetWidth;
      const th = table.offsetHeight;
      const ox = table.offsetLeft;
      const oy = table.offsetTop;
      const headerCells = rowEls[0] ? (Array.from(rowEls[0].children) as HTMLElement[]) : [];
      let x = ox;
      headerCells.forEach((cell, c) => {
        x += cell.offsetWidth;
        const h = colHandles[c];
        if (h) {
          h.style.left = `${x}px`;
          h.style.top = `${oy}px`;
          h.style.height = `${th}px`;
        }
      });
      let y = oy;
      rowEls.forEach((tr, r) => {
        y += tr.offsetHeight;
        const h = rowHandles[r];
        if (h) {
          h.style.top = `${y}px`;
          h.style.left = `${ox}px`;
          h.style.width = `${tw}px`;
        }
      });
    };

    // Shared mousedown→drag plumbing for both axes: freeze a start value, follow the
    // pointer along the chosen axis, then persist + restore the cursor on release.
    const startDrag = (
      axis: "col" | "row",
      getStart: () => number,
      apply: (delta: number, start: number) => void,
      e: MouseEvent,
    ): void => {
      e.preventDefault();
      e.stopPropagation();
      const start = getStart();
      const origin = axis === "col" ? e.clientX : e.clientY;
      const onMove = (me: MouseEvent): void => {
        apply((axis === "col" ? me.clientX : me.clientY) - origin, start);
        layout();
      };
      const onUp = (): void => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        persist();
        layout();
      };
      document.body.style.cursor = axis === "col" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    for (let c = 0; c < cols; c++) {
      const handle = document.createElement("div");
      handle.className = "cm-col-resize";
      handle.addEventListener("mousedown", (e) =>
        startDrag(
          "col",
          () => {
            // First drag freezes the content-derived widths and switches to fixed layout
            // so every later drag stays stable.
            const headerCells = rowEls[0] ? (Array.from(rowEls[0].children) as HTMLElement[]) : [];
            if (table.style.tableLayout !== "fixed") {
              headerCells.forEach((cell, i) => {
                if (colEls[i]) colEls[i].style.width = `${cell.offsetWidth}px`;
              });
              table.style.tableLayout = "fixed";
            }
            return parseFloat(colEls[c].style.width) || headerCells[c]?.offsetWidth || MIN_COL;
          },
          (delta, start) => {
            colEls[c].style.width = `${Math.max(MIN_COL, start + delta)}px`;
          },
          e as MouseEvent,
        ),
      );
      overlay.appendChild(handle);
      colHandles.push(handle);
    }

    rowEls.forEach((tr) => {
      const handle = document.createElement("div");
      handle.className = "cm-row-resize";
      handle.addEventListener("mousedown", (e) =>
        startDrag(
          "row",
          () => tr.offsetHeight,
          (delta, start) => {
            tr.style.height = `${Math.max(MIN_ROW, start + delta)}px`;
          },
          e as MouseEvent,
        ),
      );
      overlay.appendChild(handle);
      rowHandles.push(handle);
    });

    root.appendChild(overlay);

    // Position handles once the table has actually been laid out, then re-place them
    // whenever its size changes (content edits, font load, window resize). The
    // pointerenter relayout is a belt-and-suspenders guarantee that the strips are
    // correctly sized the moment the pointer reaches the table (the first rAF can fire
    // before CodeMirror has measured the freshly-attached widget, leaving zero-size strips).
    root.addEventListener("pointerenter", () => layout());
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => layout());
      ro.observe(table);
      (root as unknown as { _tableRO?: ResizeObserver })._tableRO = ro;
    }
    if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(layout);
    else layout();

    // Claim a pending caret-focus request left by an Enter-grows-a-row commit (#42): if it names
    // THIS table (same stable header key) and a cell that now exists, focus it once CM has attached
    // the freshly-built widget. One-shot — cleared as soon as it's claimed.
    if (pendingCellFocus && pendingCellFocus.key === sizeKey(this.cells)) {
      const { r, c } = pendingCellFocus;
      pendingCellFocus = null;
      const doFocus = (): void => { focusCell(r, c); };
      if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(doFocus);
      else doFocus();
    }

    // Outer block carries the vertical spacing as PADDING so CodeMirror measures it (a
    // margin on `root` would be excluded from CM's block-height model, drawing the caret
    // one line too low for everything below the table — see the `.cm-table-block` CSS note).
    const outer = document.createElement("div");
    outer.className = "cm-table-block";
    outer.setAttribute("contenteditable", "false");
    outer.appendChild(root);
    return outer;
  }

  // Stop the layout observer when CodeMirror drops this widget's DOM. CM hands us the
  // toDOM root (the outer block); the observer is stored on the inner `.cm-table-wrap`.
  destroy(dom: HTMLElement): void {
    const wrap = (dom.classList.contains("cm-table-wrap") ? dom : dom.querySelector(".cm-table-wrap")) as HTMLElement | null;
    (wrap as unknown as { _tableRO?: ResizeObserver } | null)?._tableRO?.disconnect();
  }

  // Build + dispatch the right-click menu for the cell at (r, c). Insert/delete act on
  // the grid read fresh from the DOM at apply time, then commit to the markdown source.
  private openCellMenu(view: EditorView, root: HTMLElement, e: MouseEvent, r: number, c: number): void {
    const cols = this.cells[0]?.length ?? 0;
    const rowCount = this.cells.length;
    // Each action re-reads the grid fresh from the DOM (in `commit`) and returns a NEW
    // grid via the pure tableModel ops, keeping the markdown source valid after every op.
    const items: TableMenuItem[] = [
      { label: "Insert row above", icon: "ArrowUp", disabled: r === 0, onSelect: () => this.commit(view, root, (g) => insertRow(g, r)) },
      { label: "Insert row below", icon: "ArrowDown", onSelect: () => this.commit(view, root, (g) => insertRow(g, r + 1)) },
      {
        label: "Delete row",
        icon: "Trash2",
        disabled: rowCount <= 2 || r === 0, // keep the header + ≥1 body row
        onSelect: () => this.commit(view, root, (g) => deleteRow(g, r)),
      },
      {
        label: "Insert column left",
        icon: "ArrowLeft",
        separatorBefore: true,
        onSelect: () => this.commit(view, root, (g) => insertColumn(g, c)),
      },
      {
        label: "Insert column right",
        icon: "ArrowRight",
        onSelect: () => this.commit(view, root, (g) => insertColumn(g, c + 1)),
      },
      {
        label: "Delete column",
        icon: "Trash2",
        disabled: cols <= 1,
        onSelect: () => this.commit(view, root, (g) => deleteColumn(g, c)),
      },
      {
        label: "Edit source",
        icon: "Code",
        separatorBefore: true,
        onSelect: () => {
          const range = currentRange(view, root);
          if (!range) return;
          const line = view.state.doc.lineAt(range.from).number;
          view.focus();
          // Prettify the raw markdown as we reveal it (#25): a hand-authored table may have
          // ragged pipes, so re-emit it column-padded so "Edit source" is actually readable
          // (by a human OR an LLM). Only dispatch a change when it isn't already tidy.
          const src = view.state.sliceDoc(range.from, range.to);
          const pretty = prettifyTableBlock(src.split("\n"));
          const spec: TransactionSpec = { selection: { anchor: range.from }, effects: setActiveTableEffect.of(line) };
          if (pretty !== src) spec.changes = { from: range.from, to: range.to, insert: pretty };
          // Keep the viewport still — the reformat changes the block height and CM would
          // otherwise re-measure + scroll it away.
          dispatchKeepScroll(view, spec);
        },
      },
    ];
    // App listens for `bismuth-context-menu` (editor/contextMenu.ts + App.tsx onMount) and
    // renders these items with the shared <ContextMenu>. (The old `oa-` name predated the
    // app rename and silently dropped the menu — the root cause of "can't right-click a table".)
    window.dispatchEvent(new CustomEvent("bismuth-context-menu", { detail: { x: e.clientX, y: e.clientY, items } }));
  }

  // Let CodeMirror ignore events originating inside the widget — the contenteditable
  // cells handle their own input; CM should not move its cursor or reveal raw source.
  ignoreEvent(): boolean {
    return true;
  }
}

// ── Find-in-table highlighting (#31) ──────────────────────────────────────────
// A GFM table is drawn as an atomic block-replace WIDGET that HIDES its source lines, so a
// Cmd+F match landing on those lines is invisible behind the widget. The OLD behavior flipped
// the whole table to RAW MARKDOWN SOURCE so the match showed — which the user rejected outright
// ("cmd+f converts tables to source, which is stupid"). Instead we highlight matches IN PLACE,
// inside the rendered table DOM: every match gets a `<mark class="cm-table-find-match">`, and the
// ACTIVE match (the one the find bar's selection sits on) additionally gets `cm-table-find-active`
// and is scrolled into view. No StateField, no re-render of the widget (which would blow away an
// in-progress cell edit) — a post-render ViewPlugin decorates the existing display DOM, so a
// cursor move or query keystroke never touches the source. Cleared the moment the bar closes.
export const TABLE_FIND_MATCH_CLASS = "cm-table-find-match";
export const TABLE_FIND_ACTIVE_CLASS = "cm-table-find-active";

/** Remove every find highlight `<mark>` from a table wrap, restoring the original text nodes.
 *  Unwraps each mark (moving its children out) then normalizes the parent so split text merges. */
function clearTableFindHighlights(root: HTMLElement): void {
  root.querySelectorAll(`mark.${TABLE_FIND_MATCH_CLASS}`).forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    (parent as Element & { normalize?: () => void }).normalize?.();
  });
}

/** Wrap every literal occurrence of `query` in a display cell's TEXT NODES with a find `<mark>`
 *  (case-insensitive unless `caseSensitive`). Returns the marks created, in document order, so the
 *  caller can pick out the active one. Only touches text nodes, so inline elements (bold, tags,
 *  wikilinks) inside the cell are preserved; a match that straddles an element boundary is left
 *  alone (same limitation as a browser's own in-page find within formatted text). */
function highlightCellFind(cell: HTMLElement, query: string, caseSensitive: boolean): HTMLElement[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const created: HTMLElement[] = [];
  // Snapshot the text nodes first — we mutate the tree as we go, which would invalidate a live walk.
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n as Text);
  for (const tn of textNodes) {
    const src = tn.nodeValue ?? "";
    const hay = caseSensitive ? src : src.toLowerCase();
    if (hay.indexOf(needle) === -1) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (let idx = hay.indexOf(needle, 0); idx !== -1; idx = hay.indexOf(needle, last)) {
      if (idx > last) frag.appendChild(document.createTextNode(src.slice(last, idx)));
      const mark = document.createElement("mark");
      mark.className = TABLE_FIND_MATCH_CLASS;
      mark.textContent = src.slice(idx, idx + query.length);
      frag.appendChild(mark);
      created.push(mark);
      last = idx + query.length;
    }
    if (last < src.length) frag.appendChild(document.createTextNode(src.slice(last)));
    tn.parentNode?.replaceChild(frag, tn);
  }
  return created;
}

/** Grid coordinate `(r, c)` of the cell a document offset falls inside a table block, or null when
 *  the offset is on the separator row (no rendered cell) or outside the block. Row 0 is the header;
 *  body rows follow the separator. Column comes from the raw line's cell spans (parseRowCellSpans),
 *  so the find bar can mark the exact rendered cell its active match sits in (#31). */
function cellCoordForOffset(block: TableBlock, doc: CMText, offset: number): { r: number; c: number } | null {
  const lineNo = doc.lineAt(offset).number;
  if (lineNo < block.startLine || lineNo > block.endLine) return null;
  if (lineNo === block.startLine + 1) return null; // separator row — not rendered
  const r = lineNo === block.startLine ? 0 : lineNo - block.startLine - 1;
  const line = doc.line(lineNo);
  const within = offset - line.from;
  const spans = parseRowCellSpans(line.text);
  for (let c = 0; c < spans.length; c++) {
    if (within >= spans[c].start && within <= spans[c].end) return { r, c };
  }
  return null;
}

/** ViewPlugin that highlights the current find query inside every rendered table widget and marks
 *  the active match (#31). Re-applied whenever the doc, selection, query, viewport, or panel state
 *  changes; a full clear runs when the find bar isn't open. Purely decorates the display DOM — it
 *  never dispatches a transaction or reveals table source. */
export const tableFindHighlight = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.apply(view);
    }
    update(u: ViewUpdate): void {
      // Effects cover the search-query set + the panel open/close toggle; selection covers the
      // active-match move; doc + viewport cover a widget rebuild / newly scrolled-in table.
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        u.transactions.some((t) => t.effects.length > 0)
      ) {
        this.apply(u.view);
      }
    }
    apply(view: EditorView): void {
      const wraps = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-table-wrap"));
      if (wraps.length === 0) return;
      for (const w of wraps) clearTableFindHighlights(w);
      const query = getSearchQuery(view.state);
      if (!searchPanelOpen(view.state) || !query.valid || !query.search) return;
      const doc = view.state.doc;
      const { blocks } = groupTableBlocks(doc);
      const sel = view.state.selection.main;
      const activeBlock = blocks.find(
        (b) => sel.from >= doc.line(b.startLine).from && sel.from <= doc.line(b.endLine).to,
      );
      const activeCoord = activeBlock ? cellCoordForOffset(activeBlock, doc, sel.from) : null;
      for (const wrap of wraps) {
        let pos: number;
        try {
          pos = view.posAtDOM(wrap);
        } catch {
          continue;
        }
        const block = blocks.find(
          (b) => pos >= doc.line(b.startLine).from && pos <= doc.line(b.endLine).to,
        );
        for (const cell of Array.from(wrap.querySelectorAll<HTMLElement>("[data-cell]"))) {
          if (cell.dataset.editing === "1") continue; // don't touch the edit face (corrupts read-back)
          highlightCellFind(cell, query.search, query.caseSensitive);
        }
        // Mark + reveal the active match's cell (the block the find selection is genuinely inside).
        if (block && activeBlock && block === activeBlock && activeCoord) {
          const activeCell = wrap.querySelector<HTMLElement>(
            `[data-cell][data-r="${activeCoord.r}"][data-c="${activeCoord.c}"]`,
          );
          const mark = activeCell?.querySelector<HTMLElement>(`mark.${TABLE_FIND_MATCH_CLASS}`);
          if (mark) {
            mark.classList.add(TABLE_FIND_ACTIVE_CLASS);
            mark.scrollIntoView({ block: "nearest", inline: "nearest" });
          }
        }
      }
    }
  },
);
