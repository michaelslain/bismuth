// CodeMirror extension that renders ```tasks query blocks like the Obsidian Tasks plugin.
// A StateField scans the doc for ```tasks fences and block-replaces each (when the cursor
// is outside it) with a widget that fetches all vault tasks, runs the query evaluator, and
// renders the matching rows. Block-replacing decorations must come from a StateField, not a
// ViewPlugin (CodeMirror disallows view-plugin block decorations), so this is separate from
// the inline livePreview ViewPlugin.
import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { api } from "../api";
import { runTaskQuery } from "../../../core/src/tasks-query";
import type { Task, Priority } from "../../../core/src/tasks";
import { todayISO } from "../../../core/src/dates";
import { lucideIconSpan } from "../icons/iconElement";

const OPEN = /^\s*```+\s*tasks\s*$/i; // opening fence with the "tasks" info string
const CLOSE = /^\s*```+\s*$/; // a bare fence line

// Lucide icon per priority (highest→lowest as a run of up/neutral/down chevrons).
const PRIORITY_ICON: Record<Priority, string | null> = {
  highest: "ChevronsUp", high: "ChevronUp", medium: "Equal", low: "ChevronDown", lowest: "ChevronsDown", none: null,
};

class TasksQueryWidget extends WidgetType {
  constructor(private readonly query: string) {
    super();
  }

  eq(other: TasksQueryWidget): boolean {
    return other.query === this.query;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-tasks-query";

    // A block-replace decoration is atomic — the caret can't reach it via mouse or arrow
    // keys, so the cursor-inside reveal never fires on its own. Explicitly move the caret
    // into the block on mousedown so its raw source shows for editing. Clicks on the
    // checkbox are excluded (it toggles instead).
    root.addEventListener("mousedown", (ev) => {
      if ((ev.target as HTMLElement).closest(".cm-tasks-check")) return;
      ev.preventDefault();
      // posAtDOM returns the position just before the widget (end of the previous line),
      // so +1 lands on the opening fence line — inside the block range, which makes build()
      // drop the replacement and reveal the raw source for editing.
      const pos = Math.min(view.posAtDOM(root) + 1, view.state.doc.length);
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    });

    // Solid roots mounted for inline icons; disposed on every re-render and on destroy.
    const iconDisposers: (() => void)[] = [];
    const clearIcons = () => {
      for (const d of iconDisposers) d();
      iconDisposers.length = 0;
    };
    // Build an icon span and track its disposer so it's cleaned up with the widget.
    const icon = (name: string, size: number): HTMLSpanElement => {
      const { el, dispose } = lucideIconSpan(name, size);
      iconDisposers.push(dispose);
      return el;
    };
    (root as HTMLElement & { __clearIcons?: () => void }).__clearIcons = clearIcons;

    const render = async () => {
      let all: Task[];
      try {
        all = await api.tasks();
      } catch (e) {
        clearIcons();
        root.replaceChildren();
        root.textContent = `tasks: failed to load (${(e as Error).message})`;
        return;
      }
      const { tasks, errors } = runTaskQuery(all, this.query, todayISO());
      clearIcons();
      root.replaceChildren();

      for (const err of errors) {
        const e = document.createElement("div");
        e.className = "cm-tasks-error";
        e.textContent = err;
        root.appendChild(e);
      }

      if (tasks.length === 0) {
        const empty = document.createElement("div");
        empty.className = "cm-tasks-empty";
        empty.textContent = "No tasks match this query.";
        root.appendChild(empty);
      }

      for (const t of tasks) {
        const row = document.createElement("div");
        row.className = "cm-tasks-row";

        const box = document.createElement("input");
        box.type = "checkbox";
        box.className = "cm-tasks-check";
        box.checked = t.status === "done";
        box.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          try {
            await api.toggleTask(t.path, t.line);
          } catch {
            /* ignore — re-render reflects disk truth */
          }
          render();
        });
        row.appendChild(box);

        const priIcon = PRIORITY_ICON[t.priority];
        if (priIcon) {
          const p = icon(priIcon, 14);
          p.className = "cm-tasks-pri";
          row.appendChild(p);
        }

        const text = document.createElement("span");
        text.className = "cm-tasks-text" + (t.status === "done" ? " done" : "");
        text.textContent = t.description;
        text.title = t.path;
        // No click handler: clicking the text (like the rest of the block) lets the caret
        // enter the block and reveal the raw query source for editing.
        row.appendChild(text);

        if (t.due) {
          const due = document.createElement("span");
          due.className = "cm-tasks-due" + (t.due < todayISO() && t.status !== "done" ? " overdue" : "");
          due.appendChild(icon("Calendar", 12));
          due.appendChild(document.createTextNode(" " + t.due));
          row.appendChild(due);
        }
        if (t.recurrence) {
          const rec = document.createElement("span");
          rec.className = "cm-tasks-rec";
          rec.appendChild(icon("Repeat", 12));
          rec.appendChild(document.createTextNode(" " + t.recurrence));
          row.appendChild(rec);
        }

        root.appendChild(row);
      }
    };

    render();

    // Keep the query live: poll the backend version and re-evaluate when the vault
    // changes (a task toggled here or edited anywhere bumps it), so results never go stale.
    let lastVersion = -1;
    const timer = window.setInterval(async () => {
      try {
        const { version } = await api.version();
        if (lastVersion === -1) lastVersion = version; // record baseline on first poll
        else if (version !== lastVersion) {
          lastVersion = version;
          render();
        }
      } catch {
        /* network hiccup — try again next tick */
      }
    }, 3000);
    (root as HTMLElement & { __tasksTimer?: number }).__tasksTimer = timer;

    return root;
  }

  destroy(dom: HTMLElement): void {
    const timer = (dom as HTMLElement & { __tasksTimer?: number }).__tasksTimer;
    if (timer !== undefined) window.clearInterval(timer);
    // Tear down the Solid roots backing the inline Lucide icons.
    (dom as HTMLElement & { __clearIcons?: () => void }).__clearIcons?.();
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function build(state: EditorState): DecorationSet {
  const doc = state.doc;
  const head = state.selection.main.head;
  const decos: Range<Decoration>[] = [];

  let i = 1;
  while (i <= doc.lines) {
    const line = doc.line(i);
    if (OPEN.test(line.text)) {
      // collect query lines until the closing fence
      const queryLines: string[] = [];
      let j = i + 1;
      while (j <= doc.lines && !CLOSE.test(doc.line(j).text)) {
        queryLines.push(doc.line(j).text);
        j++;
      }
      if (j <= doc.lines) {
        const blockFrom = line.from;
        const blockTo = doc.line(j).to;
        const cursorInside = head >= blockFrom && head <= blockTo;
        if (!cursorInside) {
          decos.push(
            Decoration.replace({
              widget: new TasksQueryWidget(queryLines.join("\n")),
              block: true,
            }).range(blockFrom, blockTo),
          );
        }
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return Decoration.set(decos, true);
}

const field = StateField.define<DecorationSet>({
  create: (state) => build(state),
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return build(tr.state);
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const tasksQuery: Extension = [
  field,
  EditorView.theme({
    ".cm-tasks-query": {
      border: "1px solid var(--border, #444)",
      "border-radius": "6px",
      padding: "8px 12px",
      margin: "6px 0",
    },
    ".cm-tasks-row": { display: "flex", "align-items": "center", gap: "8px", padding: "3px 0" },
    ".cm-tasks-check": { cursor: "pointer", margin: "0" },
    ".cm-tasks-text": { flex: "1", "min-width": "0" },
    ".cm-tasks-text.done": { "text-decoration": "line-through", opacity: "0.5" },
    ".cm-tasks-pri": { display: "inline-flex", "flex-shrink": "0", opacity: "0.8" },
    ".cm-tasks-due": { display: "inline-flex", "align-items": "center", gap: "3px", "font-size": "0.85em", opacity: "0.7", "white-space": "nowrap" },
    ".cm-tasks-due.overdue": { color: "var(--accent, #b00020)" },
    ".cm-tasks-rec": { display: "inline-flex", "align-items": "center", gap: "3px", "font-size": "0.85em", opacity: "0.5", "white-space": "nowrap" },
    ".cm-tasks-error": { color: "var(--accent, #b00020)", "font-size": "0.85em", "font-family": "monospace" },
    ".cm-tasks-empty": { opacity: "0.5", "font-style": "italic" },
  }),
];
