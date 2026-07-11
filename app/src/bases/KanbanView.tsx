import { createSignal, For, Index, Show, batch, onMount, onCleanup } from "solid-js";
import { stringify as yamlStringify } from "yaml";
import type { ViewResult, BaseConfig, Row, ResultGroup } from "../../../core/src/bases/types";
import { api } from "../api";
import { KanbanCard } from "./KanbanCard";
import { STATUS_COLOR } from "../ui/StatusDot";
import styles from "./BaseView.module.css";

// Frontmatter key used to persist manual within-column ordering.
const ORDER_KEY = "order";
// Default frontmatter property holding a card's editable description.
const DEFAULT_DESC_FIELD = "description";

// The active theme's graph-node ramp (`accentPalette` → --graph-0..4), a designed set of
// distinguishable-yet-cohesive colors. Used as the per-column fallback so columns vary out of
// the box (issue: every custom column was the same accent color) AND as the picker swatches —
// so it stays on-theme and adapts to light/dark + whichever theme is active.
const PALETTE = ["var(--graph-0)", "var(--graph-1)", "var(--graph-2)", "var(--graph-3)", "var(--graph-4)"];

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

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

/** Make a title safe as a filename: strip path/YAML-hostile chars, collapse whitespace. */
function safeFilename(title: string): string {
  const s = title.replace(/[\\/:*?"<>|#[\]]/g, "-").replace(/\s+/g, " ").replace(/^\.+/, "").trim();
  return s.slice(0, 120) || "Untitled";
}

export function KanbanView(props: { result: ViewResult; config: BaseConfig; basePath?: string; viewIndex?: number; onChange: () => void }) {
  const groupBy = () => props.result.view.groupBy;
  const descField = () => props.result.view.descriptionField ?? DEFAULT_DESC_FIELD;
  // Editing (rename / description / reorder / colors / add) only works against a real base
  // file to persist into. Embedded ```query kanbans stay read-only.
  const editable = () => !!props.basePath;
  // Adding a card also needs a WRITABLE groupBy: we can only place a new card in the clicked
  // column by writing that column's value onto the note. A file./formula./this. groupBy has no
  // writable target, so the composer is hidden rather than silently creating a mis-placed card.
  const canAdd = () => editable() && !!groupBy() && writableKey(groupBy()!.property) !== null;
  const groupColors = (): Record<string, string> => props.result.view.groupColors ?? {};

  // A kanban card IS a note; its title is the note's filename (editing it renames the file).
  // Bound to file.name — NOT the base's first display column — so an explicit `order:` that puts
  // a property first can't turn a title-edit into a rename-to-a-property-value.
  const titleCol = () => "file.name";

  // Per-column color: explicit override > known-status palette > distinct auto palette.
  function colColor(key: string, index: number): string {
    const override = groupColors()[key];
    if (override) return override;
    return STATUS_COLOR[key.trim().toLowerCase()] ?? PALETTE[index % PALETTE.length];
  }

  const [overCol, setOverCol] = createSignal<string | null>(null);
  const [overIndex, setOverIndex] = createSignal(0);
  const [dragPath, setDragPath] = createSignal<string | null>(null);
  const [fromCol, setFromCol] = createSignal<string | null>(null);

  // Column (header) drag-reorder state — distinct from card drag above.
  const [colDrag, setColDrag] = createSignal<string | null>(null);
  const [colOver, setColOver] = createSignal<string | null>(null);

  // UI popovers / composers, keyed by column key (only one open at a time).
  const [pickerCol, setPickerCol] = createSignal<string | null>(null);
  const [composerCol, setComposerCol] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  // Paths minted this session, so two quick adds don't collide before a refetch lands.
  const created = new Set<string>();

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
      setColDrag(null);
      setColOver(null);
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
    // Column reorder in progress: this column is a reorder target, not a card drop zone.
    if (colDrag() !== null) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      setColOver(group.key);
      return;
    }
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

  async function handleDrop(e: DragEvent, group: ResultGroup): Promise<void> {
    // Column reorder drop.
    if (colDrag() !== null) {
      const from = colDrag();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      clearDrag();
      if (from !== null) void reorderColumns(from, group.key, after);
      return;
    }

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

  // ── Column reorder — persist the full visible key order to `columns` (groupOrder). ──
  async function reorderColumns(from: string, over: string, after: boolean): Promise<void> {
    if (!props.basePath || from === over) return;
    const keys = props.result.groups.map((g) => g.key).filter((k) => k !== from);
    let ti = keys.indexOf(over);
    if (ti < 0) ti = keys.length;
    if (after) ti += 1;
    keys.splice(ti, 0, from);
    await api.setViewProperty(props.basePath, props.viewIndex ?? 0, "columns", keys);
    props.onChange();
  }

  // ── Column color — persist/clear an override in `groupColors`. ──
  async function setColColor(key: string, color: string | null): Promise<void> {
    if (!props.basePath) return;
    setPickerCol(null);
    const next = { ...groupColors() };
    if (color === null) delete next[key];
    else next[key] = color;
    const idx = props.viewIndex ?? 0;
    if (Object.keys(next).length === 0) await api.deleteViewProperty(props.basePath, idx, "groupColors");
    else await api.setViewProperty(props.basePath, idx, "groupColors", next);
    props.onChange();
  }

  // ── Card rename (title = filename) ──
  // A rename changes the note's path, so the refetch below re-keys the row and remounts the card
  // (its identity genuinely changed). Editing is single-mode, so there's no open description edit
  // to lose in the normal flow; only a description typed into the SAME card during the brief
  // in-flight window of a just-committed rename would be dropped — a narrow, no-existing-data-loss
  // race we accept rather than couple the two async writes.
  async function renameCard(row: Row, newTitle: string): Promise<void> {
    const dir = dirOf(row.file.path);
    const desired = `${dir ? dir + "/" : ""}${safeFilename(newTitle)}.md`;
    if (desired === row.file.path) return;
    const target = dedupe(desired, takenPaths());
    await api.move(row.file.path, target);
    props.onChange();
  }

  // ── Card description (a frontmatter property) ──
  async function setDescription(row: Row, value: string): Promise<void> {
    if (value.trim() === "") await api.deleteProperty(row.file.path, descField());
    else await api.setProperty(row.file.path, descField(), value);
  }

  // ── Add card — create a note in the board's folder with the column's status set. ──
  function boardFolder(): string {
    const first = props.result.groups.flatMap((g) => g.rows)[0];
    if (first) return dirOf(first.file.path);
    return props.basePath ? props.basePath.replace(/\.md$/, "") : "";
  }
  // Frontmatter shared by EVERY existing card (e.g. `board`, or a `tags` array the base filters
  // on) — copied onto new cards so they keep matching the base's source/filter. Compared by value
  // (JSON) so array/object fields count as equal across notes, and carried through as-is (the YAML
  // serializer handles arrays/objects). Excludes the status/description/order keys.
  function constProps(exclude: Set<string>): Record<string, unknown> {
    const rows = props.result.groups.flatMap((g) => g.rows);
    if (rows.length === 0) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rows[0].note)) {
      if (exclude.has(k) || v == null) continue;
      const s = JSON.stringify(v);
      if (rows.every((r) => JSON.stringify((r.note as Record<string, unknown>)[k]) === s)) out[k] = v;
    }
    return out;
  }
  const takenPaths = (): Set<string> =>
    new Set([...props.result.groups.flatMap((g) => g.rows).map((r) => r.file.path), ...created]);
  // Resolve a non-colliding path against the board's own notes + this session's fresh adds. (A
  // same-named note the board's FILTER hides isn't covered — but for the common folder-scoped
  // board every note is a visible row, and there's no reliable client-side disk-existence probe:
  // /file and /meta both 200 for missing paths.)
  function dedupe(desired: string, taken: Set<string>): string {
    if (!taken.has(desired)) return desired;
    const stem = desired.replace(/\.md$/, "");
    for (let n = 2; ; n++) { const cand = `${stem} ${n}.md`; if (!taken.has(cand)) return cand; }
  }
  async function addCard(colKey: string): Promise<void> {
    const title = draft().trim();
    const gb = groupBy();
    const statusKey = gb ? writableKey(gb.property) : null;
    if (!title || !statusKey || busy()) return;
    const folder = boardFolder();

    // Use an existing card's actual (typed) status value for this column when there is one, so a
    // numeric/boolean groupBy writes the same type as its siblings (a stringified key would fail
    // a numeric filter / type-aware sort). Fall back to the string key for an empty column.
    const sibling = props.result.groups.find((g) => g.key === colKey)?.rows[0];
    const statusValue = sibling ? (sibling.note as Record<string, unknown>)[statusKey] : colKey;

    const front: Record<string, unknown> = {
      [statusKey]: statusValue ?? colKey,
      ...constProps(new Set([statusKey, descField(), ORDER_KEY])),
    };
    const content = `---\n${yamlStringify(front)}---\n`;
    const path = dedupe(`${folder ? folder + "/" : ""}${safeFilename(title)}.md`, takenPaths());

    setBusy(true);
    try {
      await api.write(path, content);
      created.add(path);
      setDraft("");
      props.onChange();
    } finally {
      setBusy(false);
    }
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
        {/* Index-keyed columns (see ListView): a re-resolve (e.g. a status toggle that moves a
            card between columns) mints new group OBJECTS for both the source and destination
            columns; a reference-keyed <For> would remount every card in both. Index keeps the
            columns mounted and hands a reactive `group()` accessor, so only the inner card <For>
            diffs — the moved card animates, the rest stay put. */}
        <Index each={props.result.groups}>
          {(group, index) => {
            const color = () => colColor(group().key, index);
            return (
              <div
                class={styles.kanbanColumn}
                classList={{
                  [styles.kanbanColumnOver]: overCol() === group().key && colDrag() === null,
                  [styles.kanbanColReorder]: colOver() === group().key && colDrag() !== null && colDrag() !== group().key,
                  [styles.kanbanColDragging]: colDrag() === group().key,
                }}
                style={{ "--kb-col-color": color() }}
                onDragOver={(e) => onColumnDragOver(e, group())}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleDrop(e, group());
                }}
              >
                <div
                  class={styles.kanbanColHeader}
                  draggable={editable()}
                  onDragStart={(e) => {
                    if (!editable()) return;
                    setColDrag(group().key);
                    if (e.dataTransfer) {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", group().key);
                    }
                  }}
                >
                  <button
                    type="button"
                    class={styles.kbDotBtn}
                    title={editable() ? "Column color" : undefined}
                    disabled={!editable()}
                    onClick={() => setPickerCol(pickerCol() === group().key ? null : group().key)}
                  >
                    <span class={styles.dot} />
                  </button>
                  <span class={styles.kanbanColTitle}>
                    {group().key === "" ? "(empty)" : group().key}
                  </span>
                  <span class={styles.kanbanCount}>{group().rows.length}</span>
                </div>

                {/* Color picker popover */}
                <Show when={pickerCol() === group().key}>
                  <div class={styles.kbColorBackdrop} onClick={() => setPickerCol(null)} />
                  <div class={styles.kbColorPop}>
                    <For each={PALETTE}>
                      {(c) => (
                        <button
                          type="button"
                          class={styles.kbSwatch}
                          style={{ background: c }}
                          onClick={() => void setColColor(group().key, c)}
                        />
                      )}
                    </For>
                    <button
                      type="button"
                      class={styles.kbSwatchAuto}
                      title="Auto"
                      onClick={() => void setColColor(group().key, null)}
                    >
                      Auto
                    </button>
                  </div>
                </Show>

                <div class={styles.kanbanCards}>
                  <For each={visibleRows(group())}>
                    {(row: Row, i) => {
                      const [editing, setEditing] = createSignal(false);
                      return (
                        <>
                          <div
                            class={`${styles.kanbanPlaceholder} ${
                              overCol() === group().key && overIndex() === i() ? styles.kanbanPlaceholderActive : ""
                            }`}
                          />
                          <div
                            class={styles.card}
                            data-kbcard=""
                            data-path={row.file.path}
                            draggable={!editing()}
                            onDragStart={(e) => {
                              draggedPath = row.file.path;
                              setDragPath(row.file.path);
                              setFromCol(group().key);
                              if (e.dataTransfer) {
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", row.file.path);
                              }
                            }}
                          >
                            <div class={styles.cardBodyInner}>
                              <KanbanCard
                                row={row}
                                titleCol={titleCol()}
                                descField={descField()}
                                editable={editable()}
                                onEditingChange={setEditing}
                                onRename={(t) => void renameCard(row, t)}
                                onSetDescription={(v) => void setDescription(row, v)}
                              />
                            </div>
                          </div>
                        </>
                      );
                    }}
                  </For>
                  <div
                    class={`${styles.kanbanPlaceholder} ${
                      overCol() === group().key && overIndex() === visibleRows(group()).length
                        ? styles.kanbanPlaceholderActive
                        : ""
                    }`}
                  />

                  {/* Add-card composer (Trello-style) — only when the column value is writable. */}
                  <Show when={canAdd()}>
                    <Show
                      when={composerCol() === group().key}
                      fallback={
                        <button
                          type="button"
                          class={styles.kbAddBtn}
                          onClick={() => { setComposerCol(group().key); setDraft(""); }}
                        >
                          + Add a card
                        </button>
                      }
                    >
                      <textarea
                        class={styles.kbComposer}
                        value={draft()}
                        rows={2}
                        placeholder="Card title…  (⏎ to add, Esc to close)"
                        ref={(el) => queueMicrotask(() => el.focus())}
                        onInput={(e) => setDraft(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void addCard(group().key).then(() => e.currentTarget.focus());
                          } else if (e.key === "Escape") {
                            setComposerCol(null);
                            setDraft("");
                          }
                        }}
                        onBlur={() => { if (draft().trim() === "") setComposerCol(null); }}
                      />
                    </Show>
                  </Show>
                </div>
              </div>
            );
          }}
        </Index>
      </div>
    </Show>
  );
}
