// editor/taskFold.ts
// Collapsible "completed" sections inside markdown todo lists. The backend sinks resolved
// (done/cancelled) tasks to the bottom of each contiguous task block (see core/tasks.ts
// reorderTaskBlocks); this extension renders a clickable "▾ N completed" toggle above that
// trailing run and lets the user hide it — the same affordance the Cards/tasks view has.
//
// State: a position-mapped Set of collapsed anchor positions (the start of each block's
// first resolved task line). A ViewPlugin scans the doc into task blocks, finds each block's
// trailing run of resolved items, and emits either a block toggle widget (expanded) or a
// block replace that hides the run behind the toggle (collapsed).
import { StateField, StateEffect } from "@codemirror/state";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { reorderTaskBlocks } from "../../../core/src/taskReorder";

// `- `/`* `/`+ ` bullet then `[<one char>]` then a space. Mirrors core's TASK_LINE so the
// editor and backend agree on what counts as a task line.
const TASK_RE = /^(\s*)[-*+] \[(.)\] /;

function isTaskLine(text: string): boolean {
  return TASK_RE.test(text);
}
function statusChar(text: string): string | null {
  const m = TASK_RE.exec(text);
  return m ? m[2] : null;
}
function isResolvedChar(c: string | null): boolean {
  return c === "x" || c === "X" || c === "-";
}
function indentWidth(text: string): number {
  const m = /^[ \t]*/.exec(text);
  return m ? m[0].length : 0;
}

interface FoldGroup {
  anchorPos: number; // doc position: start of the first resolved task line in the run
  endPos: number; // doc position: end of the block's last line
  count: number; // number of resolved task items in the trailing run
}

// Walk one contiguous task block starting at `startLine` (1-indexed). A line joins the
// current item when indented deeper than the block's base indent; a task line at the base
// indent starts a new item; anything else ends the block. Mirrors core's collectBlock.
function scanBlock(state: EditorState, startLine: number): { items: { resolved: boolean; headLine: number }[]; endLine: number } {
  const doc = state.doc;
  const base = indentWidth(doc.line(startLine).text);
  const items: { resolved: boolean; headLine: number }[] = [];
  let i = startLine;
  while (i <= doc.lines) {
    const text = doc.line(i).text;
    const indent = indentWidth(text);
    if (isTaskLine(text) && indent === base) {
      items.push({ resolved: isResolvedChar(statusChar(text)), headLine: i });
      i++;
    } else if (items.length > 0 && indent > base && text.trim() !== "") {
      i++; // child / continuation of the current item
    } else {
      break;
    }
  }
  return { items, endLine: i - 1 };
}

// Find every block's foldable trailing run of resolved tasks. A block is only foldable when
// it has both open and resolved items (otherwise there's nothing to hide / no list context),
// and we only fold a *contiguous* trailing run so a manually-interleaved list stays intact.
function foldGroups(state: EditorState): FoldGroup[] {
  const doc = state.doc;
  const groups: FoldGroup[] = [];
  let line = 1;
  while (line <= doc.lines) {
    if (!isTaskLine(doc.line(line).text)) {
      line++;
      continue;
    }
    const { items, endLine } = scanBlock(state, line);
    let trailing = 0;
    for (let k = items.length - 1; k >= 0; k--) {
      if (items[k].resolved) trailing++;
      else break;
    }
    if (trailing > 0 && trailing < items.length) {
      const anchorLine = items[items.length - trailing].headLine;
      groups.push({
        anchorPos: doc.line(anchorLine).from,
        endPos: doc.line(endLine).to,
        count: trailing,
      });
    }
    line = endLine + 1;
  }
  return groups;
}

/**
 * After a task line's status changes, sink any newly-resolved task to the bottom of its
 * block — the in-editor checkbox edits the box char directly (it never hits the server's
 * /tasks/toggle reorder), so we mirror that reordering here. Returns a ChangeSpec replacing
 * just the affected block, or null if the block is already sorted. `lineNo` is 1-indexed.
 */
export function reorderAroundLine(state: EditorState, lineNo: number): TransactionSpec | null {
  const doc = state.doc;
  if (lineNo < 1 || lineNo > doc.lines || !isTaskLine(doc.line(lineNo).text)) return null;
  let line = 1;
  while (line <= doc.lines) {
    if (!isTaskLine(doc.line(line).text)) {
      line++;
      continue;
    }
    const { endLine } = scanBlock(state, line);
    if (lineNo >= line && lineNo <= endLine) {
      const from = doc.line(line).from;
      const to = doc.line(endLine).to;
      const original = doc.sliceString(from, to);
      const reordered = reorderTaskBlocks(original);
      return reordered === original ? null : { changes: { from, to, insert: reordered } };
    }
    line = endLine + 1;
  }
  return null;
}

// Toggle the collapsed state of the block whose resolved run starts at `pos`.
const toggleTaskFold = StateEffect.define<number>({
  map: (pos, change) => change.mapPos(pos),
});

// Position-mapped set of collapsed anchor positions. Survives edits by mapping each stored
// position through the transaction's changes.
const foldedAnchors = StateField.define<Set<number>>({
  create: () => new Set(),
  update(set, tr) {
    let next = set;
    if (tr.docChanged) {
      next = new Set<number>();
      for (const p of set) next.add(tr.changes.mapPos(p));
    }
    for (const e of tr.effects) {
      if (e.is(toggleTaskFold)) {
        if (next === set) next = new Set(set);
        if (next.has(e.value)) next.delete(e.value);
        else next.add(e.value);
      }
    }
    return next;
  },
});

class TaskFoldWidget extends WidgetType {
  constructor(
    readonly count: number,
    readonly collapsed: boolean,
    readonly anchorPos: number,
  ) {
    super();
  }
  eq(other: TaskFoldWidget): boolean {
    return other.count === this.count && other.collapsed === this.collapsed && other.anchorPos === this.anchorPos;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-task-fold" + (this.collapsed ? " cm-task-fold-collapsed" : "");
    el.setAttribute("aria-expanded", String(!this.collapsed));
    const arrow = document.createElement("span");
    arrow.className = "cm-task-fold-arrow";
    arrow.textContent = this.collapsed ? "▸" : "▾";
    const label = document.createElement("span");
    label.className = "cm-task-fold-label";
    label.textContent = `${this.count} completed`;
    el.appendChild(arrow);
    el.appendChild(label);
    el.addEventListener("mousedown", (e) => {
      // mousedown (not click) so the editor doesn't move the selection into the fold first.
      e.preventDefault();
      view.dispatch({ effects: toggleTaskFold.of(this.anchorPos) });
    });
    return el;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const collapsed = state.field(foldedAnchors);
  const head = state.selection.main.head;
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  for (const g of foldGroups(state)) {
    const isCollapsed = collapsed.has(g.anchorPos);
    // Never hide the run while the caret is inside it — the user is editing those lines.
    const cursorInside = head >= g.anchorPos && head <= g.endPos;
    if (isCollapsed && !cursorInside) {
      ranges.push({
        from: g.anchorPos,
        to: g.endPos,
        deco: Decoration.replace({ block: true, widget: new TaskFoldWidget(g.count, true, g.anchorPos) }),
      });
    } else {
      ranges.push({
        from: g.anchorPos,
        to: g.anchorPos,
        deco: Decoration.widget({ block: true, side: -1, widget: new TaskFoldWidget(g.count, false, g.anchorPos) }),
      });
    }
  }
  return Decoration.set(
    ranges.map((r) => r.deco.range(r.from, r.to)),
    true,
  );
}

// Block decorations must be provided from the state (a ViewPlugin may not emit them), so we
// compute the set whenever the doc, the selection, or the collapsed-set field changes.
const taskFoldDecorations = EditorView.decorations.compute(["doc", "selection", foldedAnchors], (state) =>
  buildDecorations(state),
);

const taskFoldTheme = EditorView.baseTheme({
  ".cm-task-fold": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3em",
    cursor: "pointer",
    userSelect: "none",
    fontSize: "0.82em",
    opacity: "0.6",
    padding: "0.1em 0",
    color: "var(--text-muted, #888)",
  },
  ".cm-task-fold:hover": { opacity: "0.95" },
  ".cm-task-fold-arrow": { fontSize: "0.9em", width: "1em", textAlign: "center" },
});

/** Collapsible "completed" sections for markdown todo lists. Pair with livePreview. */
export function taskFold() {
  return [foldedAnchors, taskFoldDecorations, taskFoldTheme];
}
