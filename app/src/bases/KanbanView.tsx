import { createSignal, For, Show } from "solid-js";
import type { ViewResult, BaseConfig, Row, ResultGroup } from "../../../core/src/bases/types";
import { api } from "../api";
import { renderValue, columnLabel } from "./renderValue";
import styles from "./BaseView.module.css";

// Module-level stash for the dragged row's vault-relative path.
let draggedPath: string | null = null;

/** Resolve the frontmatter key to write from a groupBy property id.
 * Returns null for non-writable namespaces (file./formula./this.). */
function writableKey(property: string): string | null {
  if (
    property.startsWith("file.") ||
    property.startsWith("formula.") ||
    property.startsWith("this.")
  ) {
    return null;
  }
  if (property.startsWith("note.")) return property.slice(5);
  return property; // bare property name
}

export function KanbanView(props: { result: ViewResult; config: BaseConfig; onChange: () => void }) {
  const groupBy = () => props.result.view.groupBy;
  const cols = () => props.result.columns;
  // Reactive drag state for the Trello-style placeholder + ghost.
  const [overCol, setOverCol] = createSignal<string | null>(null);
  const [dragPath, setDragPath] = createSignal<string | null>(null);
  const [fromCol, setFromCol] = createSignal<string | null>(null);

  function clearDrag() {
    draggedPath = null;
    setOverCol(null);
    setDragPath(null);
    setFromCol(null);
  }

  async function handleDrop(group: ResultGroup) {
    const path = draggedPath;
    clearDrag();
    if (!path) return;

    const gb = groupBy();
    if (!gb) return;
    const key = writableKey(gb.property);
    if (key === null) return; // not a writable frontmatter property

    // No-op when dropping onto the column the card already belongs to.
    if (group.rows.some((r) => r.file.path === path)) return;

    await api.setProperty(path, key, group.key);
    props.onChange();
  }

  // Show the drop placeholder in the hovered column, but not in the card's source column.
  const showPlaceholder = (groupKey: string) =>
    !!dragPath() && overCol() === groupKey && fromCol() !== groupKey;

  return (
    <Show
      when={groupBy()}
      fallback={
        <div class={styles.kanbanHint}>
          This kanban view needs a "groupBy" property. Add e.g. groupBy: note.status to the view.
        </div>
      }
    >
      <div class={styles.kanban}>
        <For each={props.result.groups}>
          {(group) => (
            <div
              class={`${styles.kanbanColumn} ${overCol() === group.key ? styles.kanbanColumnOver : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                setOverCol(group.key);
              }}
              onDrop={(e) => {
                e.preventDefault();
                void handleDrop(group);
              }}
            >
              <div class={styles.kanbanColHeader}>
                <span class={styles.kanbanColTitle}>{group.key === "" ? "(empty)" : group.key}</span>
                <span class={styles.kanbanCount}>{group.rows.length}</span>
              </div>
              <div class={styles.kanbanCards}>
                <For each={group.rows}>
                  {(row: Row) => (
                    <div
                      class={`${styles.card} ${dragPath() === row.file.path ? styles.cardDragging : ""}`}
                      draggable={true}
                      onDragStart={(e) => {
                        draggedPath = row.file.path;
                        setDragPath(row.file.path);
                        setFromCol(group.key);
                        if (e.dataTransfer) {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", row.file.path);
                        }
                      }}
                      onDragEnd={clearDrag}
                    >
                      <For each={cols()}>
                        {(c, i) => (
                          <Show
                            when={i() === 0}
                            fallback={
                              <div class={styles.cardField}>
                                <span class={styles.cardKey}>{columnLabel(c, props.config)}</span>
                                <span>{renderValue(c, row)}</span>
                              </div>
                            }
                          >
                            <div class={styles.cardTitle}>{renderValue(c, row)}</div>
                          </Show>
                        )}
                      </For>
                    </div>
                  )}
                </For>
                <div
                  class={`${styles.kanbanPlaceholder} ${showPlaceholder(group.key) ? styles.kanbanPlaceholderActive : ""}`}
                />
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
