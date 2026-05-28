import { createSignal, createMemo, For, Show, onMount } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { api } from "../api";
import { renderValue } from "./renderValue";
import styles from "./BaseView.module.css";

// Matches a markdown checklist line: indent, the check char, then the text.
const CHECKLIST_RE = /^(\s*)- \[([ xX])\]\s?(.*)$/;

interface TodoItem {
  lineIndex: number; // index into the full lines array
  indent: string;
  checked: boolean;
  text: string;
}

export function BodyCard(props: { row: Row; result: ViewResult; config: BaseConfig }) {
  const [content, setContent] = createSignal<string>("");
  const [loaded, setLoaded] = createSignal(false);

  onMount(async () => {
    try {
      const text = await api.read(props.row.file.path);
      setContent(text);
    } catch {
      setContent("");
    } finally {
      setLoaded(true);
    }
  });

  const firstCol = () => props.result.columns[0] ?? "file.name";

  // Derive checklist items from the current content. Recomputes on every write.
  const items = createMemo<TodoItem[]>(() => {
    const lines = content().split("\n");
    const out: TodoItem[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(CHECKLIST_RE);
      if (m) {
        out.push({
          lineIndex: i,
          indent: m[1],
          checked: m[2].toLowerCase() === "x",
          text: m[3],
        });
      }
    }
    return out;
  });

  // Rewrite a single line by its index in the full file, persist, and re-derive.
  async function writeLine(lineIndex: number, newLine: string) {
    const lines = content().split("\n");
    if (lineIndex < 0 || lineIndex >= lines.length) return;
    lines[lineIndex] = newLine;
    const next = lines.join("\n");
    setContent(next);
    await api.write(props.row.file.path, next);
  }

  function buildLine(indent: string, checked: boolean, text: string): string {
    return `${indent}- [${checked ? "x" : " "}] ${text}`;
  }

  async function toggle(item: TodoItem) {
    await writeLine(item.lineIndex, buildLine(item.indent, !item.checked, item.text));
  }

  async function commitText(item: TodoItem, newText: string) {
    if (newText === item.text) return;
    await writeLine(item.lineIndex, buildLine(item.indent, item.checked, newText));
  }

  async function removeItem(item: TodoItem) {
    const lines = content().split("\n");
    if (item.lineIndex < 0 || item.lineIndex >= lines.length) return;
    lines.splice(item.lineIndex, 1);
    const next = lines.join("\n");
    setContent(next);
    await api.write(props.row.file.path, next);
  }

  let listEl: HTMLDivElement | undefined;

  // Append a new empty todo to the end of the file, then focus its input.
  async function addItem() {
    const lines = content().split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    lines.push("- [ ] ");
    const next = lines.join("\n");
    setContent(next);
    await api.write(props.row.file.path, next);
    queueMicrotask(() => {
      const inputs = listEl?.querySelectorAll<HTMLInputElement>(`.${styles.todoText}`);
      inputs?.[inputs.length - 1]?.focus();
    });
  }

  // Insert a new empty todo immediately AFTER the given item (Trello-style:
  // Enter on any line creates the next one with matching indent). Persists the
  // current text of `item` along the way so the user doesn't lose what they typed.
  async function addAfter(item: TodoItem, currentText: string) {
    const lines = content().split("\n");
    if (item.lineIndex < 0 || item.lineIndex >= lines.length) return;
    lines[item.lineIndex] = buildLine(item.indent, item.checked, currentText);
    const newLine = `${item.indent}- [ ] `;
    lines.splice(item.lineIndex + 1, 0, newLine);
    const next = lines.join("\n");
    setContent(next);
    await api.write(props.row.file.path, next);
    // Focus the newly inserted input — it sits at the position the new item now
    // occupies in the rendered list (count of checklist lines up to and including
    // the new index in the file).
    queueMicrotask(() => {
      const inputs = listEl?.querySelectorAll<HTMLInputElement>(`.${styles.todoText}`);
      // We added at file index item.lineIndex+1; find its new index in `items()`.
      const newItem = items().find((t) => t.lineIndex === item.lineIndex + 1);
      const focusIdx = newItem ? items().indexOf(newItem) : (inputs?.length ?? 1) - 1;
      inputs?.[focusIdx]?.focus();
    });
  }

  return (
    <div class={styles.bodyCard}>
      <div class={styles.cardTitle}>{renderValue(firstCol(), props.row)}</div>
      <Show when={loaded()} fallback={<div class={styles.cardKey}>Loading…</div>}>
        <div class={styles.todoList} ref={listEl}>
          <For each={items()}>
            {(item) => (
              <div class={`${styles.todoItem} ${item.checked ? styles.todoDone : ""}`}>
                <input
                  type="checkbox"
                  class={styles.todoCheckbox}
                  checked={item.checked}
                  onChange={() => void toggle(item)}
                />
                <input
                  type="text"
                  class={styles.todoText}
                  value={item.text}
                  onBlur={(e) => void commitText(item, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      // Persist current text + add a new item right below; the new
                      // input gets focus so you can keep typing.
                      void addAfter(item, e.currentTarget.value);
                    }
                  }}
                />
                <button
                  type="button"
                  class={styles.todoRemove}
                  title="Remove item"
                  onClick={() => void removeItem(item)}
                >
                  ×
                </button>
              </div>
            )}
          </For>
          <button type="button" class={styles.todoAdd} onClick={() => void addItem()}>
            + Add item
          </button>
        </div>
      </Show>
    </div>
  );
}
