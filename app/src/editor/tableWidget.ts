// app/src/editor/tableWidget.ts
// A block-level CodeMirror widget that renders a GFM pipe table as a real, editable
// HTML <table>. Cells are contenteditable; edits commit back to the underlying
// markdown (replacing the table block's source range) when focus leaves the table.
// Tab / Shift-Tab / Enter move between cells; hover affordances add a row or column.
// The widget root is contenteditable=false so CodeMirror treats it as atomic and
// leaves its inner selection alone, while ignoreEvent() keeps CM from acting on
// clicks/keys inside it.
import { EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { getSearchQuery, searchPanelOpen } from "@codemirror/search";
import {
  type Align,
  type TableBlock,
  type TableGrid,
  type CellRect,
  cellRectAtPoint,
  remapCursorOffTable,
  groupTableBlocks,
  parseRowCellSpans,
  serializeTable,
  formatTable,
  surgicalTableEdit,
  prettifyTableBlock,
  insertRow,
  deleteRow,
  insertColumn,
  deleteColumn,
  appendToCell,
} from "./tableModel";
// CodeMirror's document `Text` — aliased so it never shadows the DOM `Text` node type used by
// the find-highlight text-node walk below.
import type { Text as CMText } from "@codemirror/state";
import { activeTableField, noteNamesFacet, tagNamesFacet, setActiveTableEffect } from "./tableState";
import { renderCellBlockHtml, upgradeCellEmbeds, cmDocToCellSource } from "./cellBlockRender";
import { minimalChange } from "./normalizeFrontmatter";
import { api } from "../api";
import { parseWikilink, resolveNotePath, wikilinkOpenPath } from "./wikilink";
// The nested in-cell CodeMirror editor (#15/#49) is imported DYNAMICALLY (see loadCellEditor below):
// its extension stack pulls in `livePreview`'s Solid `.tsx`, which bun's headless test transform
// can't compile, so it must stay OUT of this module's static import graph (the widget's own tests
// import this file directly). `typeof import(...)` below is a type-only reference (no static runtime
// import); the actual module loads on first cell edit.
type CellEditorModule = typeof import("./cellEditor");
let cellEditorModule: CellEditorModule | null = null;
let cellEditorPromise: Promise<CellEditorModule> | null = null;
function loadCellEditor(): Promise<CellEditorModule> {
  if (cellEditorModule) return Promise.resolve(cellEditorModule);
  if (!cellEditorPromise) cellEditorPromise = import("./cellEditor").then((m) => { cellEditorModule = m; return m; });
  return cellEditorPromise;
}

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

/** WebKit-safe suppression of the right-click word-select (#43). Chromium selects the word under
 *  the pointer as the DEFAULT ACTION of a right mousedown, cancelable with `preventDefault()` on
 *  that mousedown — which is what the prior fix did. WebKit/Safari does NOT honor that: its
 *  select-word-on-right-click fires regardless of the mousedown default, driven by the `selectstart`
 *  step of the gesture. So in the packaged app (Tauri WKWebView = Safari) a right-click still
 *  highlighted a word AND opened the menu.
 *
 *  This closes the gap two ways for the duration of the right-button press:
 *    1. a CAPTURE-phase `selectstart` guard that `preventDefault()`s — cancels WebKit's NEW
 *       word-selection before it starts (the primary, engine-agnostic mechanism);
 *    2. belt-and-suspenders for any engine/version that selects without a cancelable `selectstart`:
 *       SAVE the selection present at press time and RESTORE it when the gesture ends.
 *  An EXISTING selection is preserved; a right-click with no prior selection ends with none (any new
 *  word-select is undone). Returns a `finalize()` the caller runs on `contextmenu` / `mouseup` to
 *  remove the guard and restore. Touches only the document + Selection (no widget state), so it's
 *  unit-testable headlessly — a dispatched `selectstart` proves the WebKit path even where the DOM
 *  engine (happy-dom) never word-selects on its own. */
export function suppressRightClickWordSelect(cell: HTMLElement): () => void {
  const doc = cell.ownerDocument;
  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : null);
  const sel = win?.getSelection?.() ?? null;
  const saved = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  const onSelectStart = (ev: Event): void => { ev.preventDefault(); };
  doc.addEventListener("selectstart", onSelectStart, true);
  let done = false;
  return (): void => {
    if (done) return;
    done = true;
    doc.removeEventListener("selectstart", onSelectStart, true);
    const s = win?.getSelection?.() ?? null;
    if (!s) return;
    // Restore the pre-press selection (an existing one survives), or clear a new word-select.
    if (saved) { s.removeAllRanges(); s.addRange(saved); }
    else s.removeAllRanges();
  };
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

// A cell element carrying its live in-cell CodeMirror editor (mounted while the cell is focused).
type CellHost = HTMLElement & { _cellCM?: CellEditorView };
// The nested EditorView's minimal surface the widget touches — kept structural so this module never
// statically imports @codemirror/view's EditorView beyond what it already uses.
interface CellEditorView {
  state: { doc: { toString(): string } };
  contentDOM: HTMLElement;
  destroy(): void;
}

/** Read the current cell grid (raw markdown SOURCE per cell) out of the rendered table
 *  DOM. A cell normally displays rendered markdown, so its source is kept in `data-src`;
 *  the one cell currently being edited holds its live (possibly unsaved) source in its nested
 *  CodeMirror editor, so we read that DOC back (`<br>`-joined) — this captures an in-flight edit
 *  when a `+`/menu action (or an Enter-grows-row) commits while a cell still has focus. */
function readGrid(root: HTMLElement): string[][] {
  const rows: string[][] = [];
  for (const tr of Array.from(root.querySelectorAll("tr"))) {
    const cells = Array.from(tr.querySelectorAll<HTMLElement>("[data-cell]"));
    if (cells.length)
      rows.push(
        cells.map((c) => {
          // The edited cell holds its live doc in a nested CM; everything else holds its
          // already-encoded (`<br>`-marked) source in data-src.
          const cm = (c as CellHost)._cellCM;
          if (c.dataset.editing === "1" && cm) return cmDocToCellSource(cm.state.doc.toString());
          return (c.dataset.src ?? "").trim();
        }),
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

/** No "big cursor" beside a table (#59): a USER selection (click / arrow keys) whose cursor
 *  lands on a rendered table block's replaced range — where CodeMirror draws the caret as tall
 *  as the whole widget — is remapped to the nearest line outside the block, directionally, so
 *  ArrowDown from above skips PAST the table. Pure decision in `remapCursorOffTable`
 *  (tableModel.ts). Only `isUserEvent("select")` transactions are touched: programmatic
 *  selection dispatches (the widget's own commit()/#44 undo-anchoring, "Edit source") pass
 *  through untouched, and a block open in raw-source mode (activeTableField) is skipped so its
 *  lines stay editable. Range selections (drag / Cmd+A) are never altered. */
export const tableSelectionGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || !tr.isUserEvent("select")) return tr;
  if (!tr.newSelection.main.empty) return tr; // only a collapsed cursor draws the big caret
  const head = tr.newSelection.main.head;
  const active = tr.startState.field(activeTableField, false) ?? null;
  const mapped = remapCursorOffTable(tr.newDoc, head, tr.startState.selection.main.head, active);
  if (mapped === head) return tr;
  return [tr, { selection: { anchor: mapped } }];
});

/** No "big cursor" beside a table via UNDO/REDO (#59 follow-up): `tableSelectionGuard` above is
 *  a `transactionFilter`, but @codemirror/commands' history `pop()` dispatches undo/redo with
 *  `filter: false` (it must — a filter that alters the transaction would corrupt the undo
 *  stack), which makes EVERY `transactionFilter` skip it outright, ours included. A
 *  `transactionExtender` can't fill the gap either: it may only ADD effects, its own returned
 *  `selection` field is discarded by CM's `extendTransaction` (@codemirror/state). So an undo
 *  that restores a selection into a table's line range — completely ordinary: undo right after
 *  any row/column op or cell edit, whose own commit() legitimately anchors mid-table pending the
 *  widget's cell auto-focus to mask it — leaves CM's OWN selection parked inside the
 *  widget-replaced range with no cell actually DOM-focused, drawing the exact widget-height
 *  caret tableSelectionGuard exists to prevent. The only remaining hook is a follow-up dispatch
 *  from an `updateListener`, the same technique `undoRedoScrollGuard` (Editor.tsx) already uses
 *  to single out undo/redo transactions. Scoped strictly to `isUserEvent("undo"|"redo")` so it
 *  never touches a live commit() anchor (which isn't tagged that way) or fights pendingCellFocus. */
export const tableUndoSelectionGuard = EditorView.updateListener.of((u) => {
  if (!u.selectionSet) return;
  if (!u.transactions.some((tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"))) return;
  const sel = u.state.selection.main;
  if (!sel.empty) return; // only a collapsed cursor draws the big caret
  const active = u.state.field(activeTableField, false) ?? null;
  const mapped = remapCursorOffTable(u.state.doc, sel.head, u.startState.selection.main.head, active);
  if (mapped === sel.head) return;
  u.view.dispatch({ selection: { anchor: mapped } });
});

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

/** Resolve native-drop client COORDINATES to a table cell drop target in THIS view (#30). In the
 *  PACKAGED Tauri app an OS file drag never fires a DOM `drop` — Tauri intercepts it and
 *  `nativeDrop.ts` re-broadcasts it as `bismuth-native-drag` with client-pixel coords, so the
 *  widget's own capture-phase DOM `drop` listeners (which only help dev-in-Chrome) never see it.
 *  Editor.tsx's native-drop consumer calls this (with COORDS ALREADY CORRECTED to page CSS px —
 *  see nativeDropRouting.nativeDropScale) to hit-test the drop point against this view's rendered
 *  tables and route a hit through the SAME upload+embed-into-cell flow the DOM drop uses.
 *
 *  Resolution is GEOMETRIC — rect containment over the wrap + its cells' client rects, the same
 *  coordinate handling as the chat pane's working pointInDropRect hit-test — NOT
 *  `document.elementFromPoint`. elementFromPoint is hit-test-dependent: the resize-overlay strips
 *  (pointer-events:auto bands centered on every column border) intercept it, and WebKit's answers
 *  under page zoom/transforms have diverged from Chromium's. Rects and the point live in the same
 *  CSS viewport space, so containment is engine-agnostic by construction; the actual decision is
 *  the pure, unit-tested `cellRectAtPoint` (containing cell, else nearest — a drop on a border
 *  still lands in the visually-targeted table). Iterating this view's own wraps also scopes the
 *  hit to this editor, so a drop over another split pane's table never lands here. Returns null
 *  when the point isn't over any table of this view. */
export function tableCellDropTargetAtPoint(
  view: EditorView,
  x: number,
  y: number,
): { from: number; to: number; r: number; c: number } | null {
  for (const wrap of Array.from(view.dom.querySelectorAll<HTMLElement>(".cm-table-wrap"))) {
    const wr = wrap.getBoundingClientRect();
    if (wr.width === 0 && wr.height === 0) continue; // hidden pane / not laid out
    if (x < wr.left || x > wr.right || y < wr.top || y > wr.bottom) continue;
    const cells: CellRect[] = [];
    for (const el of Array.from(wrap.querySelectorAll<HTMLElement>("[data-cell]"))) {
      const r = Number(el.getAttribute("data-r"));
      const c = Number(el.getAttribute("data-c"));
      if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      cells.push({ r, c, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    }
    const hit = cellRectAtPoint(cells, x, y);
    if (!hit) continue;
    const range = currentRange(view, wrap);
    if (!range) return null;
    return { from: range.from, to: range.to, r: hit.r, c: hit.c };
  }
  return null;
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
  const from = doc.line(block.startLine).from;
  const to = doc.line(block.endLine).to;
  const before = view.state.sliceDoc(from, to);
  // One-cell change → line-surgical rewrite, same rationale as commit() (#46): keep the
  // diff (undo inverse + save-merge hunk) confined to the dropped-on row.
  const md = surgicalTableEdit(before, block.cells, grid.cells) ?? formatTable(grid);
  if (before === md) return false;
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
 *  its real vault path (subfolder notes open correctly); an unresolved target that isn't a
 *  previewable attachment (image/pdf/…) opens as a new note at the typed name, matching the
 *  note-body wikilink behavior (see `wikilinkOpenPath`, #38). A `#heading` rides along. */
function openCellWikilink(view: EditorView, raw: string): void {
  const { target, heading } = parseWikilink(raw);
  if (!target) return;
  const notes = view.state.facet(noteNamesFacet)?.() ?? [];
  const resolved = resolveNotePath(target, notes);
  window.dispatchEvent(
    new CustomEvent("bismuth-open", { detail: { path: wikilinkOpenPath(target, resolved), heading } }),
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
    const before = view.state.sliceDoc(range.from, range.to);
    // In-place cell edits rewrite ONLY the changed rows' lines (no column repadding) so the
    // diff — and with it undo's inverse and the save-merge's local hunk — stays confined to
    // the edited row (#46, see surgicalTableEdit). Structural ops keep the full pretty-print.
    const md = transform
      ? formatTable(grid) // column-padded, LLM-readable GFM
      : surgicalTableEdit(before, this.cells, grid.cells) ?? formatTable(grid);
    if (before === md) return; // no-op: skip churn
    // Commit the SMALLEST span that actually changed, not a whole-table replace (#46): the
    // undo inverse of a whole-block replace restores the ENTIRE table as it was, silently
    // discarding any EXTERNAL edits reconciled into OTHER rows since the commit — cmd+z
    // after a cell edit wiped a concurrent writer's rows. A minimal patch confines undo's
    // blast radius to the edited region, so external edits elsewhere in the table survive.
    const delta = minimalChange(before, md);
    const from = range.from + delta.from;
    const to = range.from + delta.to;
    // Move CM's own selection to the edit site FIRST, matching "Edit source" (openCellMenu
    // below): every cell edit here happens inside a contenteditable DOM island CM's own
    // selection never tracks, so `state.selection` is still wherever it was before this edit. A
    // changes-only dispatch's OWN `selection:` field can't fix this retroactively — CM's
    // history() records an edit's undo-position from the selection as it was BEFORE the edit
    // (`tr.startState.selection`), not the after-state a same-transaction `selection:` sets (see
    // @codemirror/commands' `HistEvent.fromTransaction`). Left unmoved, a later undo restores
    // that stale before-edit position — often the doc end — instead of back here (#44). A plain
    // selection-only dispatch doesn't scroll (no `scrollIntoView`), so this is visually inert.
    view.dispatch({ selection: { anchor: from } });
    // Pin the scroll position: growing the table (add row/column) re-lays the block
    // widget and CM's async height re-measure would otherwise scroll the viewport away.
    dispatchKeepScroll(view, { changes: { from, to, insert: delta.insert } });
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-table-wrap";
    root.setAttribute("contenteditable", "false");

    const table = document.createElement("table");
    table.className = "cm-table-rendered";

    // A cell has two faces: a DISPLAY face (the FULL BLOCK markdown render — the same reading
    // engine a note body uses, so lists/paragraphs in a cell look exactly like reading mode, #15)
    // and an EDIT face — a REAL nested CodeMirror editor (cellEditor.ts) running the SAME
    // live-preview + markdown + autocomplete stack the note body uses, so editing a cell reveals raw
    // markdown per-token exactly like the note editor (#15) and pops the same emoji/wikilink/tag
    // autocomplete (#49). We swap between them on focus so the user reads formatted prose but edits
    // through the identical editor code.
    const renderDisplay = (cell: HTMLElement): void => {
      // Block render (bases/markdown.ts renderNoteBody over the <br>→newline source), then swap
      // the sanitize-surviving embed slots for real media from GET /asset (#30) — see
      // cellBlockRender.ts. Math placeholders self-upgrade when KaTeX lands (the reader's own
      // scheduleMathUpgrade), so no per-cell onMathReady wiring is needed here.
      cell.innerHTML = renderCellBlockHtml(cell.dataset.src ?? "");
      upgradeCellEmbeds(cell, api.assetUrl);
    };
    // Enter edit mode: clear the display face and mount a nested CodeMirror editor. The editor
    // module is loaded DYNAMICALLY (its live-preview stack pulls in Solid `.tsx` that would taint
    // this widget's headless tests), so the mount completes on a microtask — the guards below bail
    // if the cell already left edit mode (a fast blur) or the user moved focus away meanwhile.
    const enterEdit = (cell: CellHost, r: number, c: number, atCoords?: { x: number; y: number }): void => {
      if (cell.dataset.editing === "1") {
        cell._cellCM?.contentDOM.focus({ preventScroll: true });
        return;
      }
      cell.dataset.editing = "1";
      cell.replaceChildren();
      const getNotes = view.state.facet(noteNamesFacet);
      const getTags = view.state.facet(tagNamesFacet);
      void loadCellEditor().then((mod) => {
        if (cell.dataset.editing !== "1" || !cell.isConnected || cell._cellCM) return; // left edit / torn down / already mounted
        const ae = cell.ownerDocument.activeElement as HTMLElement | null;
        // Don't steal focus if the user moved to something outside this table while the chunk loaded.
        if (ae && ae !== cell.ownerDocument.body && !root.contains(ae) && !cell.contains(ae)) {
          cell.dataset.editing = "";
          renderDisplay(cell);
          return;
        }
        cell._cellCM = mod.mountCellEditor({
          parent: cell,
          source: cell.dataset.src ?? "",
          popupParent: view.dom,
          getNotes,
          getTags,
          isLastRow: r === this.cells.length - 1,
          onNav: (dir) => moveCell(r, c, dir),
          onEscape: blurCell,
          // Last row, non-list Enter → append a blank row + drop the caret into it (#42). Deferred
          // to a microtask inside cellEditor so this commit never runs mid-keydispatch.
          onGrowRow: () => {
            pendingCellFocus = { key: sizeKey(this.cells), r: this.cells.length, c };
            this.commit(view, root, (g) => insertRow(g, g.cells.length));
          },
          atCoords,
        });
      });
    };
    // Leave edit mode: read the nested editor's doc back into the cell source, destroy it, and
    // re-render the display face. Synchronous — triggered by focusout, so the editor isn't
    // mid-dispatch. The DOC → `<br>`-joined source round-trip is lossless (cellBlockRender.ts).
    const leaveEdit = (cell: CellHost): void => {
      if (cell.dataset.editing !== "1") return;
      cell.dataset.editing = "";
      const cm = cell._cellCM;
      if (cm) {
        cell.dataset.src = cmDocToCellSource(cm.state.doc.toString());
        cm.destroy();
        cell._cellCM = undefined;
      }
      renderDisplay(cell); // back to the formatted face
    };

    // Move focus to cell (r, c), entering its edit face (which mounts + focuses its editor). The
    // previously-focused cell's editor blurs → its focusout commits it (leaveEdit) — so cell-to-cell
    // navigation never touches the doc, only the per-cell source cache (parity with the old widget).
    const focusCell = (r: number, c: number): void => {
      const el = root.querySelector<HTMLElement>(`[data-cell][data-r="${r}"][data-c="${c}"]`);
      if (el) enterEdit(el as CellHost, r, c);
    };

    // Tab / Shift-Tab: hop to the next / previous cell, wrapping across rows; past the last (or
    // before the first) cell, blur out of the table so it commits.
    const moveCell = (r: number, c: number, dir: "next" | "prev"): void => {
      const cols = this.cells[0]?.length ?? 0;
      if (dir === "next") {
        if (c + 1 < cols) focusCell(r, c + 1);
        else if (r + 1 < this.cells.length) focusCell(r + 1, 0);
        else blurCell();
      } else {
        if (c - 1 >= 0) focusCell(r, c - 1);
        else if (r - 1 >= 0) focusCell(r - 1, cols - 1);
        else blurCell();
      }
    };

    // Blur whatever is focused inside the table (the active cell's editor) so focus leaves the whole
    // widget → the root focusout commits the table.
    const blurCell = (): void => {
      const ae = root.ownerDocument.activeElement as HTMLElement | null;
      if (ae && root.contains(ae)) ae.blur();
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
        const cell = document.createElement(isHeader ? "th" : "td") as CellHost;
        cell.className = "cm-td";
        cell.setAttribute("data-cell", "");
        cell.setAttribute("data-r", String(r));
        cell.setAttribute("data-c", String(c));
        // The cell is NOT contenteditable — its edit face is a nested CodeMirror editor (mounted on
        // focus) whose own contentDOM owns editing. Marked non-editable so the outer editor treats it
        // (like the wrap) as opaque.
        cell.setAttribute("contenteditable", "false");
        // Apply only left/right alignment. Center is NOT rendered (#53): "centering in tables
        // should not be possible." A `:-:` separator still PARSES to `"center"` (source stays
        // valid + round-trips), but a center column renders left — so no cell is ever centered and
        // there's no widget affordance that produces one. (The widget offers no alignment UI at all;
        // alignment comes only from the raw separator row.)
        const a = this.aligns[c] ?? "none";
        if (a === "left" || a === "right") cell.style.textAlign = a;
        cell.dataset.src = row[c] ?? ""; // raw markdown source (source of truth)
        renderDisplay(cell); // initial face: block-rendered markdown
        // When focus leaves the cell's editor (blur, or a hop to another cell), commit its doc back
        // into the source cache and re-render the display face. A focus move that stays inside this
        // cell (CM internals) is ignored. The whole-table commit is the root focusout below.
        cell.addEventListener("focusout", (e) => {
          const rt = (e as FocusEvent).relatedTarget as Node | null;
          if (rt && cell.contains(rt)) return; // focus still inside this cell
          leaveEdit(cell);
        });
        cell.addEventListener("mousedown", (e) => {
          const me = e as MouseEvent;
          // Right-click (#43): show ONLY the context menu, never a NEW selection. `preventDefault`
          // suppresses Chromium's select-word-on-right-mousedown default (without clearing an
          // EXISTING selection — a right-click on a selection keeps it), and the separate
          // `contextmenu` listener still opens the menu. But WebKit/Safari (the packaged Tauri
          // WKWebView) word-selects REGARDLESS of the mousedown default, so we also install a
          // `selectstart`-cancel + save/restore guard for the press and tear it down when the
          // gesture ends. stopPropagation keeps CM from also acting.
          if (me.button === 2) {
            e.preventDefault();
            e.stopPropagation();
            const finalize = suppressRightClickWordSelect(cell);
            const onEnd = (): void => {
              cell.ownerDocument.removeEventListener("contextmenu", onEnd, true);
              cell.ownerDocument.removeEventListener("mouseup", onEnd, true);
              finalize();
            };
            // Capture phase so the restore runs BEFORE the table's bubble-phase contextmenu opens
            // the menu (the menu then sees the correct, preserved selection state).
            cell.ownerDocument.addEventListener("contextmenu", onEnd, true);
            cell.ownerDocument.addEventListener("mouseup", onEnd, true);
            return;
          }
          // Already editing → let the nested editor handle its own clicks (drag-select, caret).
          if (cell.dataset.editing === "1") return;
          // A left-click on a RENDERED wikilink chip in the display face OPENS the target (#33)
          // instead of entering edit mode. Two chip shapes exist: the reader engine's
          // `a.bismuth-wikilink[data-href]` (the block display face, #15) and the embed fallback's
          // `span.cm-wikilink[data-wikilink]`.
          if (me.button === 0) {
            const link = (me.target as HTMLElement | null)?.closest?.(".cm-wikilink, .bismuth-wikilink") as HTMLElement | null;
            if (link && cell.contains(link)) {
              e.preventDefault();
              e.stopPropagation();
              // data-href carries `Target.md` (reader anchor); strip the extension so
              // openCellWikilink's resolve + `.md` append treats both shapes identically.
              const raw = link.dataset.wikilink ?? (link.dataset.href ?? "").replace(/\.md$/, "");
              openCellWikilink(view, raw);
              return;
            }
          }
          // Enter edit mode from the display face: stop CM moving its own selection to the (atomic)
          // widget boundary, and mount the nested editor with the caret at the click point. The
          // editor focuses with preventScroll so this never yanks the viewport (#50).
          e.preventDefault();
          e.stopPropagation();
          enterEdit(cell, r, c, { x: me.clientX, y: me.clientY });
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

    // ---- Drag-to-resize: COLUMN WIDTHS ONLY ----------------------------------
    // GFM has no syntax for cell sizes, so widths live outside the source. A thin grab strip on
    // each column border lives in an overlay (kept OUT of the contenteditable cells, which rewrite
    // their content on focus). Chosen widths are persisted per-note in localStorage so they survive
    // both a widget rebuild and a full reload. ROW HEIGHT IS NOT RESIZABLE (#52): a row's height is
    // always automatic from its content — only column width is user-adjustable. (Any `rows` heights
    // in older persisted data are ignored; height stays auto.)
    const MIN_COL = 40;

    const stored = loadSizes(this.notePath, sizeKey(this.cells));
    if (stored && stored.cols.some((w) => w != null)) {
      table.style.tableLayout = "fixed";
      stored.cols.forEach((w, c) => {
        if (w != null && colEls[c]) colEls[c].style.width = `${w}px`;
      });
    }

    const overlay = document.createElement("div");
    overlay.className = "cm-table-overlay";
    overlay.setAttribute("contenteditable", "false");
    const colHandles: HTMLElement[] = [];

    const persist = (): void => {
      // Only column widths are persisted; row heights are always auto (#52) → `rows: []`.
      saveSizes(this.notePath, sizeKey(this.cells), {
        cols: colEls.map((c) => (c.style.width ? parseFloat(c.style.width) : null)),
        rows: [],
      });
    };

    // Re-place every COLUMN handle on its border. The table sits at the wrap origin, so offsets
    // are measured against it; called after attach, on table resize, and live mid-drag.
    const layout = (): void => {
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
    };

    // Column-drag plumbing: freeze the start width, follow the pointer along X, then persist +
    // restore the cursor on release. (Row-height drag was removed for #52 — height is auto.)
    const startColDrag = (
      getStart: () => number,
      apply: (delta: number, start: number) => void,
      e: MouseEvent,
    ): void => {
      e.preventDefault();
      e.stopPropagation();
      const start = getStart();
      const origin = e.clientX;
      const onMove = (me: MouseEvent): void => {
        apply(me.clientX - origin, start);
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
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    for (let c = 0; c < cols; c++) {
      const handle = document.createElement("div");
      handle.className = "cm-col-resize";
      handle.addEventListener("mousedown", (e) =>
        startColDrag(
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

  // Stop the layout observer + tear down any mounted in-cell editor when CodeMirror drops this
  // widget's DOM (e.g. a commit rebuild). CM hands us the toDOM root (the outer block); the
  // observer lives on the inner `.cm-table-wrap`, the editors on each focused cell.
  destroy(dom: HTMLElement): void {
    const wrap = (dom.classList.contains("cm-table-wrap") ? dom : dom.querySelector(".cm-table-wrap")) as HTMLElement | null;
    (wrap as unknown as { _tableRO?: ResizeObserver } | null)?._tableRO?.disconnect();
    // Destroy any live nested cell editor so a commit-rebuild (or view teardown) leaks no EditorView.
    for (const cell of Array.from(dom.querySelectorAll<HTMLElement>("[data-cell]"))) {
      (cell as CellHost)._cellCM?.destroy();
      (cell as CellHost)._cellCM = undefined;
    }
  }

  // Build + dispatch the right-click menu for the cell at (r, c). Insert/delete act on
  // the grid read fresh from the DOM at apply time, then commit to the markdown source.
  private openCellMenu(view: EditorView, root: HTMLElement, e: MouseEvent, r: number, c: number): void {
    const cols = this.cells[0]?.length ?? 0;
    const rowCount = this.cells.length;
    // Each action re-reads the grid fresh from the DOM (in `commit`) and returns a NEW
    // grid via the pure tableModel ops, keeping the markdown source valid after every op.
    // Every handler below focuses the CM view FIRST: the menu itself is a separate DOM
    // overlay, so clicking one of its items leaves DOM focus on the (now-removed) button —
    // NOT on the editor. Without reclaiming focus here, CM's own history keymap never sees
    // an immediate Cmd+Z right after the click (it silently no-ops until the user clicks
    // back into the note), which reads as "undo is broken" for exactly the single-step
    // undo Delete table promises. Mirrors the "Edit source" item below, which already did this.
    const commitFocused = (transform?: (g: TableGrid) => TableGrid | void) => {
      view.focus();
      this.commit(view, root, transform);
    };
    const items: TableMenuItem[] = [
      { label: "Insert row above", icon: "ArrowUp", disabled: r === 0, onSelect: () => commitFocused((g) => insertRow(g, r)) },
      { label: "Insert row below", icon: "ArrowDown", onSelect: () => commitFocused((g) => insertRow(g, r + 1)) },
      {
        label: "Delete row",
        icon: "Trash2",
        disabled: rowCount <= 2 || r === 0, // keep the header + ≥1 body row
        onSelect: () => commitFocused((g) => deleteRow(g, r)),
      },
      {
        label: "Insert column left",
        icon: "ArrowLeft",
        separatorBefore: true,
        onSelect: () => commitFocused((g) => insertColumn(g, c)),
      },
      {
        label: "Insert column right",
        icon: "ArrowRight",
        onSelect: () => commitFocused((g) => insertColumn(g, c + 1)),
      },
      {
        label: "Delete column",
        icon: "Trash2",
        disabled: cols <= 1,
        onSelect: () => commitFocused((g) => deleteColumn(g, c)),
      },
      {
        // Delete the WHOLE table (#59) — the affordance that replaces caret-beside-the-table +
        // backspace (the cursor can no longer sit there, see tableSelectionGuard). One dispatch,
        // one whole-block change → ONE undo step restores the entire table.
        label: "Delete table",
        icon: "Trash2",
        separatorBefore: true,
        onSelect: () => {
          const range = currentRange(view, root);
          if (!range) return;
          // Reclaim focus before dispatching (see commitFocused above) so a Cmd+Z right after
          // this click reaches CM's history and restores the table in that ONE undo step.
          view.focus();
          // Take one adjacent newline with the block so no stray blank line is left behind.
          const from = range.from > 0 ? range.from - 1 : range.from;
          const to = range.from > 0 ? range.to : Math.min(range.to + 1, view.state.doc.length);
          // Move CM's selection to the deletion site FIRST (the #44 undo-anchoring pattern used
          // by commit()): a selection-only dispatch records no history event, so the delete
          // below stays a single undo step whose undo returns the cursor here.
          view.dispatch({ selection: { anchor: from } });
          dispatchKeepScroll(view, { changes: { from, to, insert: "" }, userEvent: "delete" });
        },
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
