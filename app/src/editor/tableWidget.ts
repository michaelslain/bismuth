// app/src/editor/tableWidget.ts
// A block-level CodeMirror widget that renders a GFM pipe table as a real, editable
// HTML <table>. Cells are contenteditable; edits commit back to the underlying
// markdown (replacing the table block's source range) when focus leaves the table.
// Tab / Shift-Tab / Enter move between cells; hover affordances add a row or column.
// The widget root is contenteditable=false so CodeMirror treats it as atomic and
// leaves its inner selection alone, while ignoreEvent() keeps CM from acting on
// clicks/keys inside it.
import { EditorView, WidgetType } from "@codemirror/view";
import { type Align, groupTableBlocks, serializeTable } from "./tableModel";
import { setActiveTableEffect } from "./tableState";
import { renderInlineMarkdown } from "./inlineMarkdown";
import { onMathReady } from "./katexLoader";

// Item shape understood by App's shared `oa-context-menu` handler (mirrors EditorMenuItem).
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
        cells.map((c) => {
          const raw = c.dataset.editing === "1" ? (c.innerText ?? "") : (c.dataset.src ?? "");
          return raw.replace(/\r?\n/g, " ").trim();
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

export class TableWidget extends WidgetType {
  constructor(
    private readonly cells: string[][],
    private readonly aligns: Align[],
  ) {
    super();
  }

  // Re-render only when the rendered content changes. Identical content (e.g. on a
  // cursor move elsewhere) keeps the existing DOM, preserving any in-progress edit.
  eq(other: TableWidget): boolean {
    return serializeTable(this.cells, this.aligns) === serializeTable(other.cells, other.aligns);
  }

  // Commit the DOM grid (optionally transformed) back to the markdown source.
  private commit(view: EditorView, root: HTMLElement, transform?: (g: { cells: string[][]; aligns: Align[] }) => void): void {
    const range = currentRange(view, root);
    if (!range) return;
    const grid: { cells: string[][]; aligns: Align[] } = { cells: readGrid(root), aligns: this.aligns.slice() };
    transform?.(grid);
    const md = serializeTable(grid.cells, grid.aligns);
    if (view.state.sliceDoc(range.from, range.to) === md) return; // no-op: skip churn
    view.dispatch({ changes: { from: range.from, to: range.to, insert: md } });
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
      cell.innerHTML = renderInlineMarkdown(cell.dataset.src ?? "");
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
      cell.textContent = cell.dataset.src ?? ""; // reveal raw markdown for editing
    };
    const leaveEdit = (cell: HTMLElement): void => {
      if (cell.dataset.editing !== "1") return;
      cell.dataset.editing = "";
      cell.dataset.src = (cell.innerText ?? "").replace(/\r?\n/g, " ").trim();
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
        // Take full control of clicks: CodeMirror's own mousedown would move the editor
        // selection to the (atomic) widget boundary and focus the doc instead of the
        // cell, so we stop it, then focus the cell and drop the caret at the click point
        // ourselves. This makes a single click reliably land in the cell for editing.
        cell.addEventListener("mousedown", (e) => {
          const me = e as MouseEvent;
          e.stopPropagation();
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
          // The cell is an editing island: stop the keydown reaching CM's contentDOM
          // keymap so editor shortcuts don't act on the whole document.
          ev.stopPropagation();
          const mod = ev.metaKey || ev.ctrlKey;
          // Mod-A natively selects the whole contenteditable host (the editor), not the
          // nested cell — scope it to the cell ourselves.
          if (mod && (ev.key === "a" || ev.key === "A")) {
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
          // Block native rich-text formatting (Mod-B/I/U would inject <b>/<i>/<u> markup
          // into the cell, which has no place in a plain-text markdown cell).
          if (mod && ["b", "i", "u"].includes(ev.key.toLowerCase())) {
            ev.preventDefault();
            return;
          }
          if (ev.key === "Tab") {
            ev.preventDefault();
            const next = ev.shiftKey ? c - 1 : c + 1;
            if (next >= 0 && next < cols) focusCell(r, next);
            else if (!ev.shiftKey && r + 1 < this.cells.length) focusCell(r + 1, 0);
            else if (ev.shiftKey && r - 1 >= 0) focusCell(r - 1, cols - 1);
            else cell.blur();
          } else if (ev.key === "Enter") {
            ev.preventDefault();
            if (r + 1 < this.cells.length) focusCell(r + 1, c);
            else cell.blur(); // last row → commit on focusout
          } else if (ev.key === "Escape") {
            ev.preventDefault();
            cell.blur();
          }
        });
        tr.appendChild(cell);
      }
      table.appendChild(tr);
    });

    root.appendChild(table);

    // Commit when focus leaves the whole table (moving between cells stays inside).
    root.addEventListener("focusout", (e) => {
      const next = (e as FocusEvent).relatedTarget as Node | null;
      if (next && root.contains(next)) return;
      this.commit(view, root);
    });

    // Add-row / add-column `+` bars along the bottom and right edges (Notion-style),
    // shown on hover. `fit-content` on the wrap keeps them flush against the table.
    root.appendChild(
      edgeBar("cm-table-add-col", "Add column", () =>
        this.commit(view, root, (g) => {
          g.cells.forEach((row) => row.push(""));
          g.aligns.push("none");
        }),
      ),
    );
    root.appendChild(
      edgeBar("cm-table-add-row", "Add row", () =>
        this.commit(view, root, (g) => {
          const n = g.cells[0]?.length ?? 1;
          g.cells.push(Array.from({ length: n }, () => ""));
        }),
      ),
    );

    // Right-click a cell → a table-specific menu (insert/delete row & column, edit
    // source), dispatched to App's shared <ContextMenu> via the `oa-context-menu` event.
    table.addEventListener("contextmenu", (e) => {
      const td = (e.target as HTMLElement).closest("[data-cell]");
      if (!td) return;
      e.preventDefault();
      e.stopPropagation();
      this.openCellMenu(view, root, e as MouseEvent, Number(td.getAttribute("data-r")), Number(td.getAttribute("data-c")));
    });

    return root;
  }

  // Build + dispatch the right-click menu for the cell at (r, c). Insert/delete act on
  // the grid read fresh from the DOM at apply time, then commit to the markdown source.
  private openCellMenu(view: EditorView, root: HTMLElement, e: MouseEvent, r: number, c: number): void {
    const cols = this.cells[0]?.length ?? 0;
    const rowCount = this.cells.length;
    const blankRow = (g: { cells: string[][] }) => Array.from({ length: g.cells[0]?.length ?? 1 }, () => "");
    const items: TableMenuItem[] = [
      { label: "Insert row above", icon: "ArrowUp", onSelect: () => this.commit(view, root, (g) => g.cells.splice(r, 0, blankRow(g))) },
      { label: "Insert row below", icon: "ArrowDown", onSelect: () => this.commit(view, root, (g) => g.cells.splice(r + 1, 0, blankRow(g))) },
      {
        label: "Delete row",
        icon: "Trash2",
        disabled: rowCount <= 1,
        onSelect: () => this.commit(view, root, (g) => g.cells.splice(r, 1)),
      },
      {
        label: "Insert column left",
        icon: "ArrowLeft",
        separatorBefore: true,
        onSelect: () => this.commit(view, root, (g) => { g.cells.forEach((row) => row.splice(c, 0, "")); g.aligns.splice(c, 0, "none"); }),
      },
      {
        label: "Insert column right",
        icon: "ArrowRight",
        onSelect: () => this.commit(view, root, (g) => { g.cells.forEach((row) => row.splice(c + 1, 0, "")); g.aligns.splice(c + 1, 0, "none"); }),
      },
      {
        label: "Delete column",
        icon: "Trash2",
        disabled: cols <= 1,
        onSelect: () => this.commit(view, root, (g) => { g.cells.forEach((row) => row.splice(c, 1)); g.aligns.splice(c, 1); }),
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
          view.dispatch({ selection: { anchor: range.from }, effects: setActiveTableEffect.of(line) });
        },
      },
    ];
    window.dispatchEvent(new CustomEvent("oa-context-menu", { detail: { x: e.clientX, y: e.clientY, items } }));
  }

  // Let CodeMirror ignore events originating inside the widget — the contenteditable
  // cells handle their own input; CM should not move its cursor or reveal raw source.
  ignoreEvent(): boolean {
    return true;
  }
}
