import { createSignal, For, Show, batch, onMount, onCleanup } from "solid-js";
import type { ViewResult, BaseConfig, Row, ResultGroup } from "../../../core/src/bases/types";
import { api } from "../api";
import { CardBody } from "./CardBody";
import styles from "./BaseView.module.css";

// Frontmatter key used to persist manual within-column ordering.
const ORDER_KEY = "order";

// Status palette from the design: Reading=teal, To Read=blue, Finished=green,
// Abandoned=rose; unknown columns get the accent.
const STATUS_COLOR: Record<string, string> = {
  reading: "var(--teal)",
  "to read": "var(--blue)",
  toread: "var(--blue)",
  finished: "var(--green)",
  done: "var(--green)",
  complete: "var(--green)",
  abandoned: "var(--rose)",
  dropped: "var(--rose)",
};
function columnColor(key: string): string {
  return STATUS_COLOR[key.trim().toLowerCase()] ?? "var(--accent)";
}

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

  // `order` is a persistence detail (within-column sort). Hide it unless the user
  // explicitly listed it in `view.order`, which is the per-view "show everything" lever.
  const cols = () => {
    const hasExplicitOrder = props.result.view.order && props.result.view.order.length > 0;
    if (hasExplicitOrder) return props.result.columns;
    return props.result.columns.filter((c) => c !== "note.order" && c !== "order");
  };
  const [overCol, setOverCol] = createSignal<string | null>(null);
  const [overIndex, setOverIndex] = createSignal(0);
  const [dragPath, setDragPath] = createSignal<string | null>(null);
  const [fromCol, setFromCol] = createSignal<string | null>(null);

  // FLIP (First-Last-Invert-Play): snapshot card rects, let Solid re-render, then
  // animate each card from its old position back to its new one. Without this the
  // placeholder pops open and the surrounding cards snap instantly — Trello slides.
  let rootEl: HTMLDivElement | undefined;
  const prevRects = new Map<string, DOMRect>();
  function snapshotRects() {
    if (!rootEl) return;
    prevRects.clear();
    for (const el of rootEl.querySelectorAll<HTMLElement>("[data-kbcard][data-path]")) {
      const p = el.dataset.path;
      if (p) prevRects.set(p, el.getBoundingClientRect());
    }
  }
  function playFlip() {
    if (!rootEl || prevRects.size === 0) return;
    for (const el of rootEl.querySelectorAll<HTMLElement>("[data-kbcard][data-path]")) {
      const p = el.dataset.path;
      const prev = p ? prevRects.get(p) : undefined;
      if (!prev) continue;
      const now = el.getBoundingClientRect();
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (dx === 0 && dy === 0) continue;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // Force a reflow so the next style change actually transitions.
      el.getBoundingClientRect();
      el.style.transition = "transform 180ms cubic-bezier(.2,.7,.2,1)";
      el.style.transform = "translate(0, 0)";
    }
    prevRects.clear();
  }

  function clearDrag(): void {
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

  const dragActive = (): boolean => dragPath() !== null;

  // Cards shown in column: while hovering, lift the dragged card so the
  // placeholder represents its new home.
  const visibleRows = (group: ResultGroup): Row[] => {
    const rows = sortedRows(group);
    const draggingThisCol = dragActive() && overCol() === group.key;
    return draggingThisCol ? rows.filter((r) => r.file.path !== dragPath()) : rows;
  };

  function onColumnDragOver(e: DragEvent, group: ResultGroup): void {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

    const colEl = e.currentTarget as HTMLElement;
    const cardEls = [...colEl.querySelectorAll<HTMLElement>("[data-kbcard]")].filter(
      (el) => el.getAttribute("data-path") !== dragPath(),
    );

    // Find insertion point by mouse Y position.
    let idx = cardEls.length;
    for (let k = 0; k < cardEls.length; k++) {
      const r = cardEls[k].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        idx = k;
        break;
      }
    }

    // Only snapshot when the placeholder actually moves to avoid unnecessary
    // DOM reads on every dragover tick (which fires constantly).
    const moved = overCol() !== group.key || overIndex() !== idx;
    if (moved) snapshotRects();
    batch(() => {
      setOverCol(group.key);
      setOverIndex(idx);
    });
    if (moved) requestAnimationFrame(playFlip);
  }

  async function handleDrop(group: ResultGroup): Promise<void> {
    const path = draggedPath;
    const insertAt = overIndex();
    const from = fromCol();
    clearDrag();
    if (!path) return;

    const gb = groupBy();
    if (!gb) return;
    const statusKey = writableKey(gb.property);

    // Locate the dragged row across all groups.
    const dragged = props.result.groups.flatMap((g) => g.rows).find((r) => r.file.path === path);
    if (!dragged) return;

    // Build target column's new ordering with the dragged card inserted at position i.
    const others = sortedRows(group).filter((r) => r.file.path !== path);
    const i = Math.max(0, Math.min(insertAt, others.length));
    const newList = [...others.slice(0, i), dragged, ...others.slice(i)];

    // Cross-column move: write status first, then order (same file, sequential to avoid races).
    if (statusKey !== null && from !== group.key) {
      await api.setProperty(path, statusKey, group.key);
    }
    await api.setProperty(path, ORDER_KEY, i);

    // Reindex remaining cards to clean integers (only those whose order changed).
    const sideWrites: Promise<unknown>[] = [];
    for (let k = 0; k < newList.length; k++) {
      const row = newList[k];
      if (row.file.path === path) continue;
      const current = (row.note as Record<string, unknown>)[ORDER_KEY];
      if (current !== k) sideWrites.push(api.setProperty(row.file.path, ORDER_KEY, k));
    }
    await Promise.all(sideWrites);
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
      <div class={styles.kanban} ref={rootEl}>
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
              <div class={styles.kanbanColHeader} style={{ color: columnColor(group.key) }}>
                <span class={styles.dot} />
                <span class={styles.kanbanColTitle} style={{ color: "var(--fg)" }}>
                  {group.key === "" ? "(empty)" : group.key}
                </span>
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
                        <div class={styles.cardBodyInner}>
                          <CardBody cols={cols()} row={row} config={props.config} />
                        </div>
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
