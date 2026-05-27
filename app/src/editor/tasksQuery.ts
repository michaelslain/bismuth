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

const OPEN = /^\s*```+\s*tasks\s*$/i; // opening fence with the "tasks" info string
const CLOSE = /^\s*```+\s*$/; // a bare fence line

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const PRIORITY_LABEL: Record<Priority, string> = {
  highest: "🔺", high: "⏫", medium: "🔼", low: "🔽", lowest: "⏬", none: "",
};

class TasksQueryWidget extends WidgetType {
  constructor(private readonly query: string) {
    super();
  }

  eq(other: TasksQueryWidget): boolean {
    return other.query === this.query;
  }

  toDOM(): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-tasks-query";

    const render = async () => {
      let all: Task[];
      try {
        all = await api.tasks();
      } catch (e) {
        root.replaceChildren();
        root.textContent = `tasks: failed to load (${(e as Error).message})`;
        return;
      }
      const { tasks, errors } = runTaskQuery(all, this.query, todayStr());
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

        const text = document.createElement("span");
        text.className = "cm-tasks-text" + (t.status === "done" ? " done" : "");
        const pri = PRIORITY_LABEL[t.priority];
        text.textContent = (pri ? pri + " " : "") + t.description;
        text.title = t.path;
        text.addEventListener("click", (ev) => {
          ev.stopPropagation();
          window.dispatchEvent(new CustomEvent("oa-open", { detail: t.path }));
        });
        row.appendChild(text);

        if (t.due) {
          const due = document.createElement("span");
          due.className = "cm-tasks-due" + (t.due < todayStr() && t.status !== "done" ? " overdue" : "");
          due.textContent = "📅 " + t.due;
          row.appendChild(due);
        }
        if (t.recurrence) {
          const rec = document.createElement("span");
          rec.className = "cm-tasks-rec";
          rec.textContent = "🔁 " + t.recurrence;
          row.appendChild(rec);
        }

        root.appendChild(row);
      }
    };

    render();
    return root;
  }

  ignoreEvent(): boolean {
    return true; // let the widget handle its own clicks (checkbox/link) without moving the editor caret
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
    ".cm-tasks-text": { cursor: "pointer", flex: "1", "min-width": "0" },
    ".cm-tasks-text.done": { "text-decoration": "line-through", opacity: "0.5" },
    ".cm-tasks-due": { "font-size": "0.85em", opacity: "0.7", "white-space": "nowrap" },
    ".cm-tasks-due.overdue": { color: "var(--accent, #b00020)" },
    ".cm-tasks-rec": { "font-size": "0.85em", opacity: "0.5", "white-space": "nowrap" },
    ".cm-tasks-error": { color: "var(--accent, #b00020)", "font-size": "0.85em", "font-family": "monospace" },
    ".cm-tasks-empty": { opacity: "0.5", "font-style": "italic" },
  }),
];
