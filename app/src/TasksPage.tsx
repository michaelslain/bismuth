// app/src/TasksPage.tsx
// The Tasks view, rendered as a tab (sentinel "::tasks", like Settings). Fetches all
// vault tasks, offers status filters + text search, groups them by source file, and
// toggles completion in place via the backend. Styled with the same CSS-var inline
// style convention as SettingsPage.
import { createSignal, onMount, For, Show, createMemo } from "solid-js";
import { api } from "./api";
import type { Task, Priority } from "../../core/src/tasks";

type Filter = "open" | "all" | "overdue" | "today" | "done";

const PRIORITY_LABEL: Record<Priority, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
  none: "",
};

const FILTERS: Filter[] = ["open", "all", "overdue", "today", "done"];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TasksPage(props: { onOpen: (path: string) => void }) {
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [filter, setFilter] = createSignal<Filter>("open");
  const [query, setQuery] = createSignal("");

  const refresh = async () => setTasks(await api.tasks());
  onMount(refresh);

  const isOpen = (t: Task) => t.status === "todo" || t.status === "in-progress";

  const filtered = createMemo<Task[]>(() => {
    const q = query().toLowerCase();
    const today = todayStr();
    return tasks().filter((t) => {
      if (q && !t.description.toLowerCase().includes(q)) return false;
      switch (filter()) {
        case "open":
          return isOpen(t);
        case "done":
          return t.status === "done";
        case "overdue":
          return isOpen(t) && !!t.due && t.due < today;
        case "today":
          return isOpen(t) && t.due === today;
        default:
          return true;
      }
    });
  });

  const groups = createMemo<Array<[string, Task[]]>>(() => {
    const m = new Map<string, Task[]>();
    for (const t of filtered()) {
      const arr = m.get(t.path) ?? [];
      arr.push(t);
      m.set(t.path, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });

  const toggle = async (t: Task) => {
    await api.toggleTask(t.path, t.line);
    await refresh();
  };

  const fileName = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");

  return (
    <div style={{ padding: "24px 32px", overflow: "auto", height: "100%", "box-sizing": "border-box" }}>
      <h1 style={{ "font-size": "20px", margin: "0 0 16px" }}>Tasks</h1>
      <div style={{ display: "flex", gap: "8px", "margin-bottom": "20px", "align-items": "center", "flex-wrap": "wrap" }}>
        <For each={FILTERS}>
          {(f) => (
            <button
              onClick={() => setFilter(f)}
              style={{
                padding: "4px 12px",
                "border-radius": "6px",
                cursor: "pointer",
                "font-size": "13px",
                border: "1px solid var(--border)",
                "text-transform": "capitalize",
                background: filter() === f ? "var(--accent)" : "transparent",
                color: filter() === f ? "#fff" : "var(--fg)",
              }}
            >
              {f}
            </button>
          )}
        </For>
        <input
          placeholder="Search…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          style={{
            "margin-left": "auto",
            padding: "4px 10px",
            "border-radius": "6px",
            border: "1px solid var(--border)",
            background: "var(--panel)",
            color: "var(--fg)",
          }}
        />
        <span style={{ opacity: 0.5, "font-size": "12px" }}>{filtered().length} tasks</span>
      </div>
      <Show when={groups().length > 0} fallback={<div style={{ opacity: 0.5 }}>No tasks match.</div>}>
        <For each={groups()}>
          {([path, items]) => (
            <div style={{ "margin-bottom": "18px" }}>
              <div
                onClick={() => props.onOpen(path)}
                style={{
                  "font-size": "12px",
                  "text-transform": "uppercase",
                  "letter-spacing": "0.06em",
                  opacity: 0.5,
                  cursor: "pointer",
                  "margin-bottom": "6px",
                }}
              >
                {fileName(path)}
              </div>
              <For each={items}>
                {(t) => (
                  <div style={{ display: "flex", "align-items": "flex-start", gap: "8px", padding: "5px 0", "border-bottom": "1px solid var(--border)" }}>
                    <input
                      type="checkbox"
                      checked={t.status === "done"}
                      onChange={() => toggle(t)}
                      style={{ "margin-top": "3px", cursor: "pointer" }}
                    />
                    <div style={{ flex: 1, "min-width": 0 }}>
                      <span
                        style={{
                          "text-decoration": t.status === "done" ? "line-through" : "none",
                          opacity: t.status === "done" ? 0.5 : 1,
                        }}
                      >
                        {PRIORITY_LABEL[t.priority]} {t.description}
                      </span>
                      <Show when={t.due}>
                        <span
                          style={{
                            "margin-left": "8px",
                            "font-size": "11px",
                            color: t.due! < todayStr() && t.status !== "done" ? "var(--accent)" : "inherit",
                            opacity: 0.7,
                          }}
                        >
                          📅 {t.due}
                        </span>
                      </Show>
                      <Show when={t.recurrence}>
                        <span style={{ "margin-left": "8px", "font-size": "11px", opacity: 0.5 }}>🔁 {t.recurrence}</span>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
