// app/src/editor/tableWidget.ts
// A block-level CodeMirror widget that renders a GFM pipe table as a real, editable
// HTML <table>. Cells are contenteditable; edits commit back to the underlying
// markdown (replacing the table block's source range) when focus leaves the table.
// Tab / Shift-Tab / Enter move between cells; hover affordances add a row or column.
// The widget root is contenteditable=false so CodeMirror treats it as atomic and
// leaves its inner selection alone, while ignoreEvent() keeps CM from acting on
// clicks/keys inside it.
import { EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { EditorState, StateEffect, type TransactionSpec } from "@codemirror/state";
import { invertedEffects } from "@codemirror/commands";
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
  moveRow,
  moveColumn,
  reorderDropIndex,
  reorderFinalIndex,
  moveInArray,
  type MergeRegion,
  normalizeMergeRegions,
  coveredCells,
  mergeContaining,
  rectFromCells,
  addMergeRegion,
  removeMergeAt,
} from "./tableModel";
import { createResizeDrag, type ResizeDrag } from "./tableResizeDrag";
// CodeMirror's document `Text` — aliased so it never shadows the DOM `Text` node type used by
// the find-highlight text-node walk below.
import type { Text as CMText } from "@codemirror/state";
import { activeTableField, noteNamesFacet, tagNamesFacet, setActiveTableEffect } from "./tableState";
import { renderCellBlockHtml, upgradeCellEmbeds, cmDocToCellSource } from "./cellBlockRender";
import { minimalChange } from "./normalizeFrontmatter";
import { api } from "../api";
import { parseWikilink, resolveNotePath, wikilinkOpenPath } from "./wikilink";
// A synchronous, Solid-free read of "is a gallery modal open?" (galleryState.ts is a plain .ts, so
// importing it never taints this module's headless tests). Opening the emoji gallery from a `:`
// completion inside a cell grabs focus for the modal's search box, blurring the cell's nested
// CodeMirror — we DEFER the blur teardown (both leaveEdit + the root commit) while a gallery is up so
// the gallery's deferred applyInsert has a live editor to write into + refocus (#49).
import { isGalleryOpen } from "../ui/gallery/galleryState";
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
// The full out-of-source visual state for one table: column widths, plus the three attributes
// GFM markdown can't express — `compact` density, `infinity` (extend-horizontally-forever instead
// of squashing columns to page width), and merged cell `merges` (#62). All persist here (NOT in
// the markdown, which stays plain GFM) so they survive a widget rebuild AND a full reload.
type TableVisual = {
  cols: (number | null)[];
  rows: (number | null)[];
  infinity?: boolean;
  merges?: MergeRegion[];
};
const STORE_PREFIX = "bismuth:table-size:";
const memStore = new Map<string, TableVisual>();
const sizeKey = (cells: string[][]): string => JSON.stringify(cells[0] ?? []);

// A structural op (add/delete row or column, Enter-grows-row) REBUILDS the widget (a doc change →
// a fresh `TableWidget.toDOM`), so the committing widget's DOM — and any focused cell — is torn
// down. We stash the grid coordinate to re-focus and let the rebuilt widget claim it. The claim is
// matched by DOCUMENT POSITION (the commit anchors CM's selection to the table's block start, so the
// one rebuilt widget whose source range contains that selection is the table we just changed) — NOT
// by header content, so it survives COLUMN ops that change the header too (#62). Re-focusing a cell
// also unfocuses the outer editor, which is what stops CodeMirror from parking its full-height
// "big caret" on the atomic widget range after a reshape (#62 report 2). One-shot. Module-level
// because the committing widget instance is discarded on rebuild.
let pendingCellFocus: { r: number; c: number } | null = null;

function loadVisual(path: string | null, key: string): TableVisual | null {
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

function saveVisual(path: string | null, key: string, val: TableVisual): void {
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

/** Read-modify-write a subset of a table's visual state without clobbering the other attributes
 *  (so toggling `compact` never drops persisted column widths, and vice-versa). */
function updateVisual(path: string | null, key: string, patch: Partial<TableVisual>): void {
  const cur = loadVisual(path, key) ?? { cols: [], rows: [] };
  saveVisual(path, key, { ...cur, ...patch });
}

/** Carry a table's out-of-source visual state across a STRUCTURAL RESHAPE that changes its
 *  localStorage key (#70b). The key is the header row, so any op that edits the header — add /
 *  remove / move a column, or rename a header cell — mints a fresh key and would otherwise ORPHAN
 *  the persisted `∞`/compact/widths/merges, silently resetting the ∞ toggle (add/remove ROW keeps
 *  the header, so it never hit this). `∞` and compact are shape-INDEPENDENT, so they always carry;
 *  column widths + merges only carry when the column COUNT is unchanged (a header rename), since an
 *  add/remove column invalidates their per-column indexing. Pure — the caller does the load/save.
 *  Returns the visual to persist under the new key, or null when there was nothing to carry. */
export function reshapeVisual(
  old: TableVisual | null,
  oldCols: number,
  newCols: number,
  existingNew: TableVisual | null,
): TableVisual | null {
  if (!old) return null; // nothing persisted under the old key → nothing to migrate
  const carried: TableVisual = existingNew ? { ...existingNew } : { cols: [], rows: [] };
  if (old.infinity !== undefined) carried.infinity = old.infinity;
  if (oldCols === newCols) {
    // Same column count (a header RENAME): per-column widths + merge regions are still valid.
    carried.cols = old.cols;
    carried.rows = old.rows;
    carried.merges = old.merges;
  }
  return carried;
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

// The standard 2×3-dot drag-grip glyph (Lucide `grip-horizontal` / `grip-vertical`), inlined as
// static SVG markup rather than imported from the icon registry (#69): the registry's icon element
// is a Solid `.tsx` module that bun's headless test transform can't compile, and this widget's own
// unit tests import this file directly — so an inline string keeps the module test-safe. `stroke:
// currentColor` lets the grip take its color from CSS. A COLUMN grip (a horizontal tab above the
// header) uses the horizontal glyph; a ROW grip (a vertical tab at the row's left) the vertical one.
const GRIP_SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const GRIP_HORIZONTAL_SVG =
  `<svg ${GRIP_SVG_ATTRS}><circle cx="5" cy="9" r="1"/><circle cx="12" cy="9" r="1"/><circle cx="19" cy="9" r="1"/>` +
  `<circle cx="5" cy="15" r="1"/><circle cx="12" cy="15" r="1"/><circle cx="19" cy="15" r="1"/></svg>`;
const GRIP_VERTICAL_SVG =
  `<svg ${GRIP_SVG_ATTRS}><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>` +
  `<circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;

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

// ── Undoable cell merge / unmerge (#71) ───────────────────────────────────────
// GFM has no colspan/rowspan, so a merge lives ONLY in the table's out-of-source visual state
// (localStorage) — invisible to CodeMirror's history, so shift-click merge/unmerge was not
// undoable. We make it participate in the SAME undo stack the editor uses: a merge dispatches a
// no-doc-change transaction carrying a `setTableMergesEffect` (prev → next regions). `invertedEffects`
// registers the inverse (next → prev) so CM's history stores it and a Cmd+Z / Cmd+Shift+Z produces
// the opposite effect; an `updateListener` applies whichever effect rides a transaction — the merge,
// its undo, or its redo — to BOTH the persisted state and the live table DOM (no widget rebuild, so
// an in-progress edit elsewhere survives). The merge state carried on the wrap (`_merges`) stays the
// single source of truth the menu reads, kept in sync here.

/** The payload of a merge-state change: the table it targets (note path + header key) and the
 *  region sets before/after, so the change is both applyable and invertible for undo. */
export interface TableMergeChange {
  path: string | null;
  key: string;
  prev: MergeRegion[];
  next: MergeRegion[];
}

/** A CodeMirror effect that mutates one table's merged-cell regions. Dispatched (no doc change) by
 *  the merge/unmerge menu actions; inverted for undo by `tableMergeUndo`. */
export const setTableMergesEffect = StateEffect.define<TableMergeChange>();

type WrapWithMerges = HTMLElement & { _merges?: MergeRegion[] };

/** Apply a set of merge regions to a rendered table wrap's cells: the anchor cell of each region
 *  gets colspan/rowspan (+ the `cm-td-merged` class), every covered cell is hidden, and any cell
 *  outside all regions is reset to a plain 1×1. Pure over the DOM (no source touch) so a merge —
 *  and its undo/redo — restyles in place without rebuilding the widget. */
function applyMergeRegionsToWrap(wrap: HTMLElement, regions: MergeRegion[]): void {
  const covered = coveredCells(regions);
  const cellAt = (r: number, c: number): HTMLElement | null =>
    wrap.querySelector<HTMLElement>(`[data-cell][data-r="${r}"][data-c="${c}"]`);
  for (const el of Array.from(wrap.querySelectorAll<HTMLElement>("[data-cell]"))) {
    el.style.display = "";
    (el as HTMLTableCellElement).colSpan = 1;
    (el as HTMLTableCellElement).rowSpan = 1;
    el.classList.remove("cm-td-merged");
  }
  for (const m of regions) {
    const anchor = cellAt(m.r, m.c);
    if (anchor) {
      (anchor as HTMLTableCellElement).colSpan = m.colSpan;
      (anchor as HTMLTableCellElement).rowSpan = m.rowSpan;
      anchor.classList.add("cm-td-merged");
    }
  }
  for (const cellKey of covered) {
    const [r, c] = cellKey.split(",").map(Number);
    const el = cellAt(r, c);
    if (el) el.style.display = "none";
  }
}

/** Persist a merge change + apply it to every rendered table in the view whose header matches the
 *  change's key (normally exactly one). Runs for the original merge, its undo, and its redo alike. */
function applyMergeChange(view: EditorView, ch: TableMergeChange): void {
  updateVisual(ch.path, ch.key, { merges: ch.next });
  for (const wrap of Array.from(view.dom.querySelectorAll<HTMLElement>(".cm-table-wrap"))) {
    if (sizeKey(readGrid(wrap)) !== ch.key) continue;
    (wrap as WrapWithMerges)._merges = ch.next;
    applyMergeRegionsToWrap(wrap, ch.next);
  }
}

/** Wire cell merge/unmerge into the editor's undo history (#71): register the inverse effect so
 *  history records each merge, and apply whichever `setTableMergesEffect` rides a transaction
 *  (merge / undo / redo) to storage + the live DOM. Added once to the editor extension stack. */
export const tableMergeUndo = [
  invertedEffects.of((tr) => {
    const out: StateEffect<TableMergeChange>[] = [];
    for (const e of tr.effects) {
      if (e.is(setTableMergesEffect))
        out.push(setTableMergesEffect.of({ path: e.value.path, key: e.value.key, prev: e.value.next, next: e.value.prev }));
    }
    return out;
  }),
  EditorView.updateListener.of((u) => {
    for (const tr of u.transactions) {
      for (const e of tr.effects) {
        if (e.is(setTableMergesEffect)) applyMergeChange(u.view, e.value);
      }
    }
  }),
];

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
    // #70b: a STRUCTURAL op can change the header row, which is this table's localStorage key for its
    // out-of-source visual state (∞ / compact / widths / merges). Add/remove/move column + a header
    // rename all mint a new key; without migrating, the widget rebuilds under it and the ∞ toggle
    // (and density) silently reset — the "∞ forgotten on reshape" bug. Carry them to the new key now,
    // BEFORE the rebuilding commit lands (add/remove ROW keeps the header, so it never needed this).
    if (transform) {
      const oldKey = sizeKey(this.cells);
      const newKey = sizeKey(grid.cells);
      if (oldKey !== newKey) {
        const migrated = reshapeVisual(
          loadVisual(this.notePath, oldKey),
          this.cells[0]?.length ?? 0,
          grid.cells[0]?.length ?? 0,
          loadVisual(this.notePath, newKey),
        );
        if (migrated) saveVisual(this.notePath, newKey, migrated);
      }
    }
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
    // Pre-warm the nested-cell-editor chunk as soon as a table renders (#62): the dynamic import is
    // memoized module-side, so kicking it off here means it is almost always resolved before the user
    // clicks a cell — closing the cold-start window where the first cell edit's keystrokes were
    // dropped (see enterEdit's sync-mount path). `.catch` swallows the load error the headless test
    // env throws when it can't compile the chunk's Solid `.tsx`, so this never surfaces a rejection.
    void loadCellEditor().catch(() => {});

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
      // A cell whose DISPLAY face is visually empty (a freshly-added row, or a cleared cell)
      // block-renders to no line box and collapses to a sliver, so its row would be shorter than
      // filled rows (#62 "new rows are really short" / "empty line hides itself" on blur). We inject
      // a REAL placeholder — `span.cm-td-ph` holding a genuine NON-BREAKING SPACE — that Editor.css
      // styles as a BLOCK whose actual nbsp content makes a line box WebKit cannot collapse (unlike
      // `min-height` on a `display: table-cell`, which WebKit ignores). Its line-height is the shared
      // `--cm-td-lh`, IDENTICAL to a filled cell AND to the nested EDIT editor (cellEditor.ts) — so an
      // empty cell, a filled single-line cell, and the edit face are all one line box tall and NOTHING
      // jumps on focus/blur (the real #62 fix: the always-compact display face was 1.3 while the edit
      // face was a hardcoded 1.5). The `cm-td-empty` class is kept as a hook (robust where `:empty`
      // is fragile — a stray reader whitespace node defeats `:empty`). Display-only — `readGrid` reads
      // `data-src`, never the cell's DOM text, so the source stays empty and the next `renderDisplay`
      // overwrites it. Skipped when the cell holds real media (img/iframe/…).
      const hasMedia = !!cell.querySelector("img, iframe, video, audio, svg, .cm-embed");
      const isEmpty = !hasMedia && (cell.textContent ?? "").trim() === "";
      cell.classList.toggle("cm-td-empty", isEmpty);
      if (isEmpty) cell.innerHTML = '<span class="cm-td-ph" aria-hidden="true"> </span>';
    };
    // Enter edit mode: clear the display face and mount a nested CodeMirror editor. The editor
    // module is loaded DYNAMICALLY (its live-preview stack pulls in Solid `.tsx` that would taint
    // this widget's headless tests). Once loaded it is cached module-side, so we mount SYNCHRONOUSLY
    // on the warm path (see below) — only the very first cell edit per session takes the async path,
    // where the guards bail if the cell already left edit mode (a fast blur) or the user moved focus
    // away while the chunk loaded.
    const enterEdit = (cell: CellHost, r: number, c: number, atCoords?: { x: number; y: number }): void => {
      if (cell.dataset.editing === "1") {
        cell._cellCM?.contentDOM.focus({ preventScroll: true });
        return;
      }
      cell.dataset.editing = "1";
      cell.replaceChildren();
      const getNotes = view.state.facet(noteNamesFacet);
      const getTags = view.state.facet(tagNamesFacet);
      // `checkFocus` guards ONLY the async (cold-chunk) path: if the user moved focus to a genuinely
      // different surface while the editor chunk loaded, don't steal it back. The SYNC path (module
      // warm) never applies it — the click just happened, so we mount unconditionally. Crucially, the
      // guard must NOT bail when `activeElement` is the OUTER editor content (an ANCESTOR of `root`):
      // after a table reshape CodeMirror re-homes focus onto its own `.cm-content`, and the previous
      // guard read that as "focus moved away" and refused to mount — the "can't edit a cell until I
      // click off and back" bug (#62 report 3). `ae.contains(root)` (ancestor) is now allowed. */
      const doMount = (mod: CellEditorModule, checkFocus: boolean): void => {
        if (cell.dataset.editing !== "1" || !cell.isConnected || cell._cellCM) return; // left edit / torn down / already mounted
        if (checkFocus) {
          const ae = cell.ownerDocument.activeElement as HTMLElement | null;
          const insideEditor = !!ae && (root.contains(ae) || cell.contains(ae) || ae.contains(root));
          if (ae && ae !== cell.ownerDocument.body && !insideEditor) {
            cell.dataset.editing = "";
            renderDisplay(cell);
            return;
          }
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
            pendingCellFocus = { r: this.cells.length, c };
            this.commit(view, root, (g) => insertRow(g, g.cells.length));
          },
          atCoords,
        });
      };
      // MOUNT SYNCHRONOUSLY when the editor module is already loaded (#62). Routing EVERY mount
      // through `loadCellEditor().then()` deferred the editor to a microtask even when the chunk was
      // long since cached — and in that gap the cell had no editor to receive input: the first
      // keystrokes after clicking/tabbing into a cell were DROPPED, and a rapid multi-click
      // (triple-click-to-select) fell through to the OUTER editor, escaping the widget entirely.
      // A cached module lets us mount now, so focus + caret are live before the next event; only the
      // first cell edit per session waits on the import (and `toDOM` pre-warms it, so even that is
      // usually ready by the first click).
      if (cellEditorModule) doMount(cellEditorModule, false);
      else void loadCellEditor().then((m) => doMount(m, true));
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
      // Belt-and-suspenders: explicitly clear any leftover editor DOM before re-rendering the
      // display face so the isEmpty check in renderDisplay sees only the source content.
      cell.innerHTML = "";
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
    const rowCount = this.cells.length;

    // ── Out-of-source visual state (#62): density, horizontal-extend, merged cells ─────────────
    // None of these have a GFM representation, so they live in the table's persisted visual state
    // (localStorage, keyed by note + header) and are RE-APPLIED on every rebuild here. `merges` is
    // normalized against the current grid so a shape change can't leave a dangling span.
    const visual = loadVisual(this.notePath, sizeKey(this.cells));
    let infinity = visual?.infinity ?? false;
    let merges = normalizeMergeRegions(visual?.merges ?? [], rowCount, cols);
    root.classList.add("cm-table-compact");
    root.classList.toggle("cm-table-infinity", infinity);

    // A grid of the cell elements (by [r][c]) so merge application, drag-reorder, and selection can
    // reach any cell without a DOM query per lookup.
    const cellEls: HTMLElement[][] = [];
    // Shift-click multi-select state (the rectangle a merge acts on). `selAnchor` is the last
    // plainly-clicked cell; `selFocus` the shift-clicked corner. Transient to this widget instance.
    let selAnchor: { r: number; c: number } | null = null;
    let selFocus: { r: number; c: number } | null = null;
    const cellAt = (r: number, c: number): HTMLElement | undefined => cellEls[r]?.[c];

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
      cellEls[r] = [];
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
          // A gallery modal (e.g. the `:` emoji picker) grabbed focus — this blur is NOT a real
          // click-away. Keep the nested editor alive so the gallery's deferred insert lands + can
          // refocus this cell; the normal teardown resumes on the next blur once the gallery closes (#49).
          if (isGalleryOpen()) return;
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
          // Shift+left-click multi-select (#62 merge): extend a rectangular selection from the
          // last plainly-clicked cell to this one instead of entering edit mode. The selection is
          // what "Merge cells" (context menu) acts on. Doesn't touch the doc.
          if (me.button === 0 && me.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            if (!selAnchor) selAnchor = { r, c };
            selFocus = { r, c };
            paintSelection();
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
          // A plain click clears any shift-selection and records this cell as the anchor for a
          // subsequent shift+click.
          if (selAnchor || selFocus) { selAnchor = null; selFocus = null; paintSelection(); }
          selAnchor = { r, c };
          // Enter edit mode from the display face: stop CM moving its own selection to the (atomic)
          // widget boundary, and mount the nested editor with the caret at the click point. The
          // editor focuses with preventScroll so this never yanks the viewport (#50).
          e.preventDefault();
          e.stopPropagation();
          enterEdit(cell, r, c, { x: me.clientX, y: me.clientY });
        });
        cellEls[r][c] = cell;
        tr.appendChild(cell);
      }
      table.appendChild(tr);
      rowEls.push(tr);
    });

    // The table lives in a dedicated scroll container so INFINITY mode can scroll it horizontally
    // (`overflow-x:auto`) WITHOUT clipping the hover toolbar / `+` edge bars, which sit on the
    // (non-clipping) wrap outside this box (#62). In normal mode the scroll box is inert.
    const scroll = document.createElement("div");
    scroll.className = "cm-table-scroll";
    scroll.appendChild(table);
    root.appendChild(scroll);

    // ── Merged cells: render spans in-place (#62) ──────────────────────────────────────────────
    // GFM can't express colspan/rowspan, so a merge is applied to the DOM without touching source:
    // the anchor cell gets colSpan/rowSpan, every covered cell is hidden (display:none removes it
    // from the table's grid so the anchor fills the span). Re-callable so the merge/unmerge menu
    // actions restyle live without a widget rebuild; also called once at initial render below.
    const applyMerges = (regions: MergeRegion[]): void => {
      merges = regions;
      (root as WrapWithMerges)._merges = regions;
      applyMergeRegionsToWrap(root, regions);
    };
    applyMerges(merges);

    // Paint the current shift-selection rectangle (a `.cm-td-selected` class per selected cell).
    // Reveal the reorder grip of any hovered OR selected column/row (#69); assigned its real body
    // once the grips + boundary helpers exist (below), forward-declared so paintSelection can call it.
    let refreshGrips: () => void = () => {};
    const paintSelection = (): void => {
      for (const rowArr of cellEls) for (const el of rowArr) el?.classList.remove("cm-td-selected");
      if (selAnchor && selFocus) {
        const rect = rectFromCells(selAnchor, selFocus);
        for (let r = rect.r; r < rect.r + rect.rowSpan; r++) {
          for (let c = rect.c; c < rect.c + rect.colSpan; c++) cellAt(r, c)?.classList.add("cm-td-selected");
        }
      }
      refreshGrips();
    };

    // ── Compact / infinity toggles (#62) ───────────────────────────────────────────────────────
    // A hover toolbar at the table's top-right with two persisted toggles: `∞` extends the table
    // horizontally forever (scroll) instead of squashing columns to page width, and the density
    // icon switches to compact padding (Claude-chat-style tight rows). Both flip a root class +
    // persist; no doc change, no rebuild.
    const toolbar = document.createElement("div");
    toolbar.className = "cm-table-toolbar";
    toolbar.setAttribute("contenteditable", "false");
    const toggleBtn = (cls: string, label: string, active: boolean, glyph: string, onToggle: (next: boolean) => void): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `cm-table-tool ${cls}${active ? " active" : ""}`;
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.textContent = glyph;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !btn.classList.contains("active");
        btn.classList.toggle("active", next);
        btn.setAttribute("aria-pressed", next ? "true" : "false");
        onToggle(next);
      });
      return btn;
    };
    toolbar.appendChild(
      toggleBtn("cm-table-tool-infinity", "Extend table horizontally", infinity, "∞", (next) => {
        infinity = next;
        root.classList.toggle("cm-table-infinity", next);
        updateVisual(this.notePath, sizeKey(this.cells), { infinity: next });
      }),
    );
    root.appendChild(toolbar);

    // Commit when focus leaves the whole table (moving between cells stays inside). This
    // covers Enter/Escape/Tab-out, which blur the cell without a CodeMirror view update.
    root.addEventListener("focusout", (e) => {
      const next = (e as FocusEvent).relatedTarget as Node | null;
      if (next && root.contains(next)) return;
      // A gallery modal grabbed focus (its search box) — committing now would rewrite the doc with
      // the in-progress `:query` still in the cell, rebuild the widget, and destroy the very
      // EditorView the gallery's deferred insert targets. Defer the commit until the gallery closes
      // and the insert has landed; the next real blur commits normally (#49).
      if (isGalleryOpen()) return;
      this.commit(view, root);
    });

    // Add-row / add-column `+` bars along the bottom and right edges (Notion-style),
    // shown on hover. `fit-content` on the wrap keeps them flush against the table.
    root.appendChild(
      edgeBar("cm-table-add-col", "Add column", () => {
        // Focus the header of the new (right-most) column so the user can name it immediately.
        pendingCellFocus = { r: 0, c: this.cells[0]?.length ?? 0 };
        this.commit(view, root, (g) => insertColumn(g, g.cells[0]?.length ?? 0));
      }),
    );
    root.appendChild(
      edgeBar("cm-table-add-row", "Add row", () => {
        pendingCellFocus = { r: this.cells.length, c: 0 };
        this.commit(view, root, (g) => insertRow(g, g.cells.length));
      }),
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

    // Merge / unmerge menu items (#62), built here in toDOM so they can reach the widget-instance
    // merge + selection state. "Merge cells" acts on the current shift-selection (body rows only —
    // a merged header cell would desync the column-resize layout, which measures header cells);
    // "Unmerge cells" splits whatever merge contains the right-clicked cell.
    const mergeMenuItems = (r: number, c: number): TableMenuItem[] => {
      const out: TableMenuItem[] = [];
      const cur = (root as WrapWithMerges)._merges ?? merges;
      const sel = selAnchor && selFocus ? rectFromCells(selAnchor, selFocus) : null;
      const canMerge = !!sel && (sel.rowSpan > 1 || sel.colSpan > 1) && sel.r >= 1;
      // Merge / unmerge dispatch a no-doc-change transaction carrying the region delta so the
      // change joins the editor's undo history (Cmd+Z reverts a merge, Cmd+Shift+Z redoes it, #71);
      // the `tableMergeUndo` updateListener persists it + restyles the DOM (see setTableMergesEffect).
      // `view.focus()` first so a Cmd+Z immediately after the menu click reaches CM's history.
      const dispatchMerge = (next: MergeRegion[]): void => {
        view.focus();
        view.dispatch({ effects: setTableMergesEffect.of({ path: this.notePath, key: sizeKey(this.cells), prev: cur, next }) });
      };
      if (canMerge && sel) {
        out.push({
          label: "Merge cells",
          icon: "Combine",
          separatorBefore: true,
          onSelect: () => {
            dispatchMerge(addMergeRegion(cur, sel, rowCount, cols));
            selAnchor = null;
            selFocus = null;
            paintSelection();
          },
        });
      }
      if (mergeContaining(cur, r, c)) {
        out.push({
          label: "Unmerge cells",
          icon: "Ungroup",
          separatorBefore: !canMerge,
          onSelect: () => dispatchMerge(removeMergeAt(cur, r, c)),
        });
      }
      return out;
    };

    // Right-click a cell → a table-specific menu (insert/delete row & column, merge/unmerge, edit
    // source), dispatched to App's shared <ContextMenu> via the `bismuth-context-menu` event.
    table.addEventListener("contextmenu", (e) => {
      const td = (e.target as HTMLElement).closest("[data-cell]");
      if (!td) return;
      e.preventDefault();
      e.stopPropagation();
      const r = Number(td.getAttribute("data-r"));
      const c = Number(td.getAttribute("data-c"));
      this.openCellMenu(view, root, e as MouseEvent, r, c, mergeMenuItems(r, c));
    });

    // ---- Drag-to-resize: COLUMN WIDTHS ONLY ----------------------------------
    // GFM has no syntax for cell sizes, so widths live outside the source. A thin grab strip on
    // each column border lives in an overlay (kept OUT of the contenteditable cells, which rewrite
    // their content on focus). Chosen widths are persisted per-note in localStorage so they survive
    // both a widget rebuild and a full reload. ROW HEIGHT IS NOT RESIZABLE (#52): a row's height is
    // always automatic from its content — only column width is user-adjustable. (Any `rows` heights
    // in older persisted data are ignored; height stays auto.)
    const MIN_COL = 40;

    const stored = visual;
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
    const colGrips: HTMLElement[] = [];
    const rowGrips: HTMLElement[] = [];
    // A single moving line that marks the insertion slot during a reorder drag (#62).
    const dropLine = document.createElement("div");
    dropLine.className = "cm-table-drop-line";
    dropLine.style.display = "none";
    overlay.appendChild(dropLine);

    const persist = (): void => {
      // Only column widths are persisted here; row heights are always auto (#52). `updateVisual`
      // merges so this never clobbers the compact / infinity / merges attributes (#62).
      updateVisual(this.notePath, sizeKey(this.cells), {
        cols: colEls.map((c) => (c.style.width ? parseFloat(c.style.width) : null)),
        rows: [],
      });
    };

    // Column x-boundaries (wrap-relative VISUAL coordinates, ascending, length cols+1). Header
    // cells are never merged (#62 merges are body-only), so the header row's cell edges give the
    // true column borders. Measured via `getBoundingClientRect()` relative to the wrap's own rect —
    // NOT `offsetLeft` + a manual `scrollLeft` subtraction (the prior #70a approach, which regressed:
    // `getBoundingClientRect` already reflects the ∞-mode horizontal scroll AND any WebKit
    // offsetParent divergence, so handles/grips track the visible border in EVERY engine, scrolled
    // or not — the same reason the native-drop hit-test switched off `elementFromPoint`). Reads live
    // geometry each call so a mid-drag / mid-scroll relayout stays exact.
    const colBoundaries = (): number[] => {
      const wrapRect = root.getBoundingClientRect();
      const headerCells = rowEls[0] ? (Array.from(rowEls[0].children) as HTMLElement[]) : [];
      if (headerCells.length === 0) return [table.getBoundingClientRect().left - wrapRect.left];
      const b: number[] = [headerCells[0].getBoundingClientRect().left - wrapRect.left];
      for (const cell of headerCells) b.push(cell.getBoundingClientRect().right - wrapRect.left);
      return b;
    };
    // Row y-boundaries (wrap-relative VISUAL coordinates, ascending, length rowCount+1). Same
    // rect-based measurement as the columns; no vertical scroll, but rect coords keep it uniform.
    const rowBoundaries = (): number[] => {
      const wrapRect = root.getBoundingClientRect();
      if (rowEls.length === 0) return [table.getBoundingClientRect().top - wrapRect.top];
      const b: number[] = [rowEls[0].getBoundingClientRect().top - wrapRect.top];
      for (const tr of rowEls) b.push(tr.getBoundingClientRect().bottom - wrapRect.top);
      return b;
    };

    // Re-place every COLUMN resize handle on its border + the drag grips. Called after attach, on
    // table resize, on horizontal SCROLL (∞ mode), and live mid-drag. Handles/grips whose border
    // has scrolled OUT of the visible scroller are hidden so a scrolled ∞ table never leaves a
    // resize strip floating over the wrong column (#70a).
    const layout = (): void => {
      const wrapRect = root.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();
      const th = tableRect.height;
      const oy = tableRect.top - wrapRect.top;
      const xs = colBoundaries();
      const ys = rowBoundaries();
      // Visible x-window of the scroller (wrap-relative VISUAL coords); a column border scrolled
      // past either edge in ∞ mode is hidden so a resize strip never floats over the wrong column.
      const viewL = scrollRect.left - wrapRect.left;
      const viewR = viewL + scroll.clientWidth;
      const inView = (px: number): boolean => px >= viewL - 0.5 && px <= viewR + 0.5;
      const base = xs[0] ?? 0;
      // Resize handles sit on the RIGHT border of each column.
      for (let c = 0; c < colHandles.length; c++) {
        const h = colHandles[c];
        if (!h) continue;
        const edge = xs[c + 1] ?? base;
        h.style.left = `${edge}px`;
        h.style.top = `${oy}px`;
        h.style.height = `${th}px`;
        h.style.display = inView(edge) ? "" : "none";
      }
      // Column drag grips: a tab centered over each column's header, just above the table.
      for (let c = 0; c < colGrips.length; c++) {
        const g = colGrips[c];
        if (!g || xs[c + 1] == null) continue;
        const mid = (xs[c] + xs[c + 1]) / 2;
        g.style.left = `${mid}px`;
        g.style.top = `${oy}px`;
        g.style.display = inView(mid) ? "" : "none";
      }
      // Row drag grips: a tab at each BODY row's left edge, pinned to the visible left so a scrolled
      // ∞ table keeps its row grips reachable instead of scrolling them off-screen.
      for (let r = 1; r < rowEls.length; r++) {
        const g = rowGrips[r];
        if (!g || ys[r + 1] == null) continue;
        g.style.left = `${Math.max(base, viewL)}px`;
        g.style.top = `${(ys[r] + ys[r + 1]) / 2}px`;
      }
    };

    // ── Drag-to-reorder a column / row (#62) ──────────────────────────────────────────────────
    // Grab a column grip (or body-row grip) and drop it into a new slot; the drop line tracks the
    // insertion point and the underlying markdown is rewritten via moveColumn / moveRow. Focus
    // follows the moved column/row so the reshape rebuild never leaves a big caret (see commit).
    // Add / remove the "this track is being dragged" tint on every cell of a column or body row, so
    // the drag reads as a real object picking up and moving into a slot (#69 smoothness) rather than
    // just a thin line appearing. Pure DOM class toggle, cheap.
    const markDragged = (axis: "col" | "row", idx: number, on: boolean): void => {
      const cls = axis === "col" ? "cm-td-drag-col" : "cm-td-drag-row";
      for (let r = 0; r < cellEls.length; r++) {
        for (let c = 0; c < (cellEls[r]?.length ?? 0); c++) {
          if ((axis === "col" ? c : r) === idx) cellEls[r]?.[c]?.classList.toggle(cls, on);
        }
      }
    };
    const startReorder = (axis: "col" | "row", from: number, e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      root.classList.add("cm-table-reordering");
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      markDragged(axis, from, true);
      let slot = from;
      // Coalesce pointer moves into ONE per animation frame: the raw mousemove stream fires far
      // faster than the display refreshes, and each handler reads live layout (getBoundingClientRect)
      // + writes the drop-line style — doing that every event thrashed layout and made the drag feel
      // laggy/steppy. rAF-throttling gives one smooth reposition per painted frame (#69).
      let raf = 0;
      let pending: MouseEvent | null = null;
      const apply = (me: MouseEvent): void => {
        const wrapRect = root.getBoundingClientRect();
        if (axis === "col") {
          const xs = colBoundaries();
          const pos = me.clientX - wrapRect.left; // wrap-relative VISUAL x, same space as `xs`
          slot = reorderDropIndex(xs, pos);
          dropLine.style.display = "block";
          dropLine.style.left = `${xs[slot] ?? xs[0] ?? 0}px`;
          dropLine.style.top = `${(rowBoundaries()[0] ?? 0)}px`;
          dropLine.style.width = "2px";
          dropLine.style.height = `${table.getBoundingClientRect().height}px`;
        } else {
          const ys = rowBoundaries();
          const pos = me.clientY - wrapRect.top; // wrap-relative VISUAL y
          slot = Math.max(reorderDropIndex(ys, pos), 1); // body rows only — never above the header
          const xs = colBoundaries();
          dropLine.style.display = "block";
          dropLine.style.left = `${xs[0] ?? 0}px`;
          dropLine.style.top = `${ys[slot] ?? ys[0] ?? 0}px`;
          dropLine.style.height = "2px";
          dropLine.style.width = `${table.getBoundingClientRect().width}px`;
        }
      };
      const onMove = (me: MouseEvent): void => {
        pending = me;
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; if (pending) apply(pending); });
      };
      const onUp = (): void => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        // Flush the final pointer position synchronously: a fast drag (or a background tab, where
        // rAF is throttled) can release the button before any throttled frame ran, which would leave
        // `slot` at its initial `from` and silently drop the reorder. Recompute from the last move.
        if (pending) apply(pending);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        root.classList.remove("cm-table-reordering");
        markDragged(axis, from, false);
        dropLine.style.display = "none";
        const to = reorderFinalIndex(from, slot);
        if (to !== from) {
          if (axis === "col") {
            // Carry this column's persisted WIDTH with it (#69): permute the stored per-column
            // width array with the SAME move BEFORE the commit, under the CURRENT header key — so
            // when the reshaping commit migrates the visual state onto the new header key
            // (reshapeVisual, same column count → widths kept), the widths already sit in their new
            // positions. Without this the moved column adopts its new neighbour's width (a reorder
            // looked like a shuffle, not a visual swap).
            const key = sizeKey(this.cells);
            const cur = loadVisual(this.notePath, key);
            if (cur && cur.cols.some((w) => w != null)) {
              const colCount = this.cells[0]?.length ?? cur.cols.length;
              const padded = cur.cols.slice();
              while (padded.length < colCount) padded.push(null);
              updateVisual(this.notePath, key, { cols: moveInArray(padded, from, to) });
            }
            pendingCellFocus = { r: 0, c: to };
            this.commit(view, root, (g) => moveColumn(g, from, to));
          } else {
            pendingCellFocus = { r: to, c: 0 };
            this.commit(view, root, (g) => moveRow(g, from, to));
          }
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    for (let c = 0; c < cols; c++) {
      const grip = document.createElement("div");
      grip.className = "cm-col-drag";
      grip.title = "Drag to reorder column";
      grip.innerHTML = GRIP_HORIZONTAL_SVG;
      grip.addEventListener("mousedown", (e) => startReorder("col", c, e as MouseEvent));
      overlay.appendChild(grip);
      colGrips.push(grip);
    }
    for (let r = 1; r < rowCount; r++) {
      const grip = document.createElement("div");
      grip.className = "cm-row-drag";
      grip.title = "Drag to reorder row";
      grip.innerHTML = GRIP_VERTICAL_SVG;
      grip.addEventListener("mousedown", (e) => startReorder("row", r, e as MouseEvent));
      overlay.appendChild(grip);
      rowGrips[r] = grip;
    }

    // ── Per-column / per-row grip reveal (#69) ──────────────────────────────────────────────────
    // Grips are invisible by default and fade in ONLY for the column/row the pointer is over (or
    // that a shift-selection covers), instead of every grip showing on any table hover. `refreshGrips`
    // (forward-declared above so paintSelection can reach it) recomputes which grips carry the
    // `--show` class from the current hover + selection; a wrap-level pointermove tracks the hovered
    // column/row from the same boundary geometry the handles use.
    let hoverCol = -1;
    let hoverRow = -1;
    refreshGrips = (): void => {
      const sel = selAnchor && selFocus ? rectFromCells(selAnchor, selFocus) : null;
      for (let c = 0; c < colGrips.length; c++) {
        const selHit = !!sel && c >= sel.c && c < sel.c + sel.colSpan;
        colGrips[c]?.classList.toggle("cm-col-drag--show", c === hoverCol || selHit);
      }
      for (let r = 1; r < rowGrips.length; r++) {
        const selHit = !!sel && r >= sel.r && r < sel.r + sel.rowSpan;
        rowGrips[r]?.classList.toggle("cm-row-drag--show", r === hoverRow || selHit);
      }
    };
    root.addEventListener("pointermove", (e) => {
      const wr = root.getBoundingClientRect();
      const px = e.clientX - wr.left;
      const py = e.clientY - wr.top;
      const xs = colBoundaries();
      const ys = rowBoundaries();
      let hc = -1;
      for (let c = 0; c < xs.length - 1; c++) { if (px >= xs[c] && px < xs[c + 1]) { hc = c; break; } }
      let hr = -1;
      for (let r = 0; r < ys.length - 1; r++) { if (py >= ys[r] && py < ys[r + 1]) { hr = r; break; } }
      if (hr === 0) hr = -1; // the header row has no reorder grip
      if (hc !== hoverCol || hr !== hoverRow) { hoverCol = hc; hoverRow = hr; refreshGrips(); }
    });
    root.addEventListener("pointerleave", () => {
      if (hoverCol !== -1 || hoverRow !== -1) { hoverCol = -1; hoverRow = -1; refreshGrips(); }
    });

    // Column-drag plumbing: freeze the start width, follow the pointer along X, then persist +
    // restore the cursor on release. Row-height drag was removed for #52 (height is auto).
    //
    // "Resize always releases" (the stuck-cursor fix): the drag is ended by a pure, IDEMPOTENT
    // controller (tableResizeDrag.ts) wired to EVERY plausible end — pointerup / pointercancel /
    // mouseup / window blur — plus POINTER CAPTURE on the handle, so a button released OUTSIDE the
    // window (WebKit drops that window `mouseup`), an alt-tab / OS focus-steal, or a cancelled
    // pointer still runs the one cleanup that resets `document.body.style.cursor`, drops the
    // `cm-col-resize--dragging` class, removes the listeners, and persists. `resizeActive` blocks a
    // re-entrant start: one physical grab fires BOTH pointerdown and its compat mousedown, and we
    // must not begin two drags for it.
    let resizeActive = false;
    const startColDrag = (
      getStart: () => number,
      applyWidth: (width: number) => void,
      e: PointerEvent | MouseEvent,
    ): void => {
      e.preventDefault();
      e.stopPropagation();
      if (resizeActive) return; // ignore the trailing compat event (pointerdown → mousedown, or vice-versa)
      resizeActive = true;
      const start = getStart();
      const origin = e.clientX;
      const handle = e.currentTarget as HTMLElement | null;
      handle?.classList.add("cm-col-resize--dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      // Capture the pointer so a release ANYWHERE (even outside the window) still delivers
      // pointerup/pointercancel to the handle — the primary guarantee the drag ends. Guarded: a
      // compat MouseEvent has no pointerId, and setPointerCapture may be unavailable (headless).
      const pointerId = typeof (e as Partial<PointerEvent>).pointerId === "number" ? (e as PointerEvent).pointerId : null;
      if (handle && pointerId != null && typeof handle.setPointerCapture === "function") {
        try { handle.setPointerCapture(pointerId); } catch { /* not capturable — window listeners cover it */ }
      }
      let drag: ResizeDrag;
      const onMove = (me: MouseEvent): void => drag.move(me.clientX);
      const onPointerMove = (pe: PointerEvent): void => drag.move(pe.clientX);
      const onEnd = (): void => drag.end();
      drag = createResizeDrag({
        originX: origin,
        startWidth: start,
        min: MIN_COL,
        onWidth: (w) => { applyWidth(w); layout(); },
        onEnd: () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onEnd);
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onEnd);
          window.removeEventListener("pointercancel", onEnd);
          window.removeEventListener("blur", onEnd);
          if (handle && pointerId != null && typeof handle.releasePointerCapture === "function") {
            try { handle.releasePointerCapture(pointerId); } catch { /* already released */ }
          }
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          handle?.classList.remove("cm-col-resize--dragging");
          resizeActive = false;
          persist();
          layout();
        },
      });
      // Listen on BOTH the mouse and pointer streams so the drag tracks + releases regardless of
      // which the engine delivers; `blur` releases if the pointer comes up while the window is
      // inactive (alt-tab / OS focus steal), where no up event arrives at all. `end()` is
      // idempotent, so whichever fires first wins and the rest no-op.
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onEnd);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      window.addEventListener("blur", onEnd);
    };

    for (let c = 0; c < cols; c++) {
      const handle = document.createElement("div");
      handle.className = "cm-col-resize";
      handle.setAttribute("role", "separator");
      handle.setAttribute("aria-label", "Resize column");
      handle.setAttribute("aria-orientation", "vertical");
      // Visible grip inside the wide hit strip — the strip itself is transparent, the grip is the
      // discoverable affordance. A separate child lets us widen the hit target without making the
      // visual line overly heavy, and it gives WebKit a concrete box to hit-test.
      const grip = document.createElement("div");
      grip.className = "cm-col-resize-grip";
      handle.appendChild(grip);
      const startDrag = (e: PointerEvent | MouseEvent): void => {
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
          (width) => {
            colEls[c].style.width = `${width}px`;
          },
          e,
        );
      };
      handle.addEventListener("mousedown", startDrag);
      handle.addEventListener("pointerdown", startDrag);
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
    // ∞ mode scrolls the table horizontally inside `scroll`; re-place the resize handles + grips on
    // every scroll so they track the visible column borders instead of drifting off (#70a).
    scroll.addEventListener("scroll", () => layout());
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => layout());
      ro.observe(table);
      (root as unknown as { _tableRO?: ResizeObserver })._tableRO = ro;
    }
    if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(layout);
    else layout();

    // Claim a pending cell-focus request left by a structural commit (add/delete row/column,
    // Enter-grows-row — #42/#62). The commit anchored CM's selection to this table's block start,
    // so THIS rebuilt widget is the right one iff its current source range contains that selection.
    // Matching by position (not header content) means a COLUMN op — which changes the header —
    // still re-focuses. Re-focusing a cell also unfocuses the outer editor, clearing any
    // full-height "big caret" CM parked on the atomic widget range (#62 report 2). One-shot; a fast
    // user click that already entered a cell wins (we skip if any cell is mid-edit).
    if (pendingCellFocus) {
      const want = pendingCellFocus;
      const claim = (): void => {
        if (!pendingCellFocus) return; // already claimed by another rebuilt widget
        const range = currentRange(view, root);
        if (!range) return;
        const head = view.state.selection.main.head;
        if (head < range.from || head > range.to) return; // not the table we just changed
        if (root.querySelector('[data-cell][data-editing="1"]')) { pendingCellFocus = null; return; } // user already editing
        pendingCellFocus = null;
        const rows = this.cells.length;
        const colCount = this.cells[0]?.length ?? 0;
        if (rows === 0 || colCount === 0) return;
        focusCell(Math.min(Math.max(want.r, 0), rows - 1), Math.min(Math.max(want.c, 0), colCount - 1));
      };
      if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(claim);
      else claim();
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
  private openCellMenu(view: EditorView, root: HTMLElement, e: MouseEvent, r: number, c: number, extraItems: TableMenuItem[] = []): void {
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
    // A structural op that reshapes the grid: stash the cell to re-focus AFTER the rebuild (which
    // both drops the caret into a sensible cell and unfocuses the outer editor, so no full-height
    // "big caret" is left parked on the atomic widget, #62), then commit through the same path.
    const commitStructural = (focus: { r: number; c: number }, transform: (g: TableGrid) => TableGrid | void) => {
      pendingCellFocus = focus;
      view.focus();
      this.commit(view, root, transform);
    };
    const items: TableMenuItem[] = [
      { label: "Insert row above", icon: "ArrowUp", disabled: r === 0, onSelect: () => commitStructural({ r, c }, (g) => insertRow(g, r)) },
      { label: "Insert row below", icon: "ArrowDown", onSelect: () => commitStructural({ r: r + 1, c }, (g) => insertRow(g, r + 1)) },
      {
        label: "Delete row",
        icon: "Trash2",
        disabled: rowCount <= 2 || r === 0, // keep the header + ≥1 body row
        onSelect: () => commitStructural({ r: Math.min(r, rowCount - 2), c }, (g) => deleteRow(g, r)),
      },
      {
        label: "Insert column left",
        icon: "ArrowLeft",
        separatorBefore: true,
        onSelect: () => commitStructural({ r, c }, (g) => insertColumn(g, c)),
      },
      {
        label: "Insert column right",
        icon: "ArrowRight",
        onSelect: () => commitStructural({ r, c: c + 1 }, (g) => insertColumn(g, c + 1)),
      },
      {
        label: "Delete column",
        icon: "Trash2",
        disabled: cols <= 1,
        onSelect: () => commitStructural({ r, c: Math.min(c, cols - 2) }, (g) => deleteColumn(g, c)),
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
    // Splice merge/unmerge (built in toDOM with the widget's live selection + merge state) in
    // just before "Edit source" (#62).
    if (extraItems.length) items.splice(items.length - 1, 0, ...extraItems);
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
