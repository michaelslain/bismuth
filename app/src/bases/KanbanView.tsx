import { createSignal, For, Show, batch, onMount, onCleanup } from "solid-js";
import type { ViewResult, BaseConfig, Row, ResultGroup } from "../../../core/src/bases/types";
import { api } from "../api";
import { renderValue, columnLabel } from "./renderValue";
import styles from "./BaseView.module.css";

// Frontmatter key used to persist manual within-column ordering.
const ORDER_KEY = "order";

// Module-level stash for the dragged row's vault-relative path.
let draggedPath: string | null = null;

/** Resolve the frontmatter key to write from a groupBy property id.
 * Returns null for non-writable namespaces (file./formula./this.). */
function writableKey(property: string): string | null {
  if (property.startsWith("file.") || property.startsWith("formula.") || property.startsWith("this.")) {
    return null;
  }
  if (property.startsWith("note.")) return property.slice(5);
  return property; // bare property name
}

/** Effective sort order for a card: explicit `order` if numeric, else its
 * stable position in the group's engine order. */
function effOrder(row: Row, group: ResultGroup): number {
  const o = (row.note as Record<string, unknown>)[ORDER_KEY];
  return typeof o === "number" ? o : group.rows.indexOf(row);
}

function sortedRows(group: ResultGroup): Row[] {
  return [...group.rows].sort((a, b) => effOrder(a, group) - effOrder(b, group));
}

export function KanbanView(props: { result: ViewResult; config: BaseConfig; onChange: () => void }) {
  const groupBy = () => props.result.view.groupBy;
  const cols = () => props.result.columns;
  const [overCol, setOverCol] = createSignal<string | null>(null);
  const [overIndex, setOverIndex] = createSignal(0);
  const [dragPath, setDragPath] = createSignal<string | null>(null);
  const [fromCol, setFromCol] = createSignal<string | null>(null);

  function clearDrag() {
    draggedPath = null;
    batch(() => {
      setOverCol(null);
      setDragPath(null);
      setFromCol(null);
    });
  }

  // A drag can end outside any column (or the source card may unmount mid-drag),
  // so clean up globally rather than relying on the card's own dragend.
  const onWindowDragEnd = () => clearDrag();
  onMount(() => window.addEventListener("dragend", onWindowDragEnd));
  onCleanup(() => window.removeEventListener("dragend", onWindowDragEnd));

  const dragActive = () => dragPath() !== null;
  // Cards shown in a column: while hovering it, lift the dragged card out so the
  // placeholder represents its new home.
  const visibleRows = (group: ResultGroup): Row[] => {
    const rows = sortedRows(group);
    if (dragActive() && overCol() === group.key) return rows.filter((r) => r.file.path !== dragPath());
    return rows;
  };

  function onColumnDragOver(e: DragEvent, group: ResultGroup) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const colEl = e.currentTarget as HTMLElement;
    const cardEls = [...colEl.querySelectorAll<HTMLElement>("[data-kbcard]")].filter(
      (el) => el.getAttribute("data-path") !== dragPath(),
    );
    let idx = cardEls.length;
    for (let k = 0; k < cardEls.length; k++) {
      const r = cardEls[k].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        idx = k;
        break;
      }
    }
    batch(() => {
      setOverCol(group.key);
      setOverIndex(idx);
    });
  }

  async function handleDrop(group: ResultGroup) {
    const path = draggedPath;
    const insertAt = overIndex();
    const from = fromCol();
    clearDrag();
    if (!path) return;

    const gb = groupBy();
    if (!gb) return;
    const statusKey = writableKey(gb.property);

    // Target column's cards (sorted), excluding the dragged one — the neighbours
    // that determine the new fractional order value.
    const list = sortedRows(group).filter((r) => r.file.path !== path);
    const i = Math.max(0, Math.min(insertAt, list.length));
    let newOrder: number;
    if (list.length === 0) newOrder = 0;
    else if (i <= 0) newOrder = effOrder(list[0], group) - 1;
    else if (i >= list.length) newOrder = effOrder(list[list.length - 1], group) + 1;
    else newOrder = (effOrder(list[i - 1], group) + effOrder(list[i], group)) / 2;

    // Move to the column (status) only if it actually changed; always persist order.
    if (statusKey !== null && from !== group.key) {
      await api.setProperty(path, statusKey, group.key);
    }
    await api.setProperty(path, ORDER_KEY, newOrder);
    props.onChange();
  }

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
              onDragOver={(e) => onColumnDragOver(e, group)}
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
                <For each={visibleRows(group)}>
                  {(row: Row, i) => (
                    <>
                      <div
                        class={`${styles.kanbanPlaceholder} ${
                          overCol() === group.key && overIndex() === i() ? styles.kanbanPlaceholderActive : ""
                        }`}
                      />
                      <div
                        class={styles.card}
                        data-kbcard=""
                        data-path={row.file.path}
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
                      >
                        <For each={cols()}>
                          {(c, j) => (
                            <Show
                              when={j() === 0}
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
                    </>
                  )}
                </For>
                <div
                  class={`${styles.kanbanPlaceholder} ${
                    overCol() === group.key && overIndex() === visibleRows(group).length
                      ? styles.kanbanPlaceholderActive
                      : ""
                  }`}
                />
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
