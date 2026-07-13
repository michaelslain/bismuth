import { createSignal, createMemo, createEffect, untrack, For, Show, batch, onCleanup } from "solid-js";
import { stringify as yamlStringify } from "yaml";
import { Icon } from "../icons/Icon";
import type { ViewResult, BaseConfig, Row, ResultGroup } from "../../../core/src/bases/types";
import { placeholderFile } from "../../../core/src/bases/types";
import { resolveProperty } from "../../../core/src/bases/query";
import { api } from "../api";
import { KanbanCard } from "./KanbanCard";
import { metaColumns, metaSource, writableKey } from "./kanbanMeta";
import { declaredDefaults } from "../../../core/src/bases/properties";
import { STATUS_COLOR } from "../ui/StatusDot";
import styles from "./BaseView.module.css";

// Frontmatter key used to persist manual within-column ordering.
const ORDER_KEY = "order";

// The active theme's graph-node ramp (`accentPalette` → --graph-0..4), a designed set of
// distinguishable-yet-cohesive colors. Used as the per-column fallback so columns vary out of
// the box (issue: every custom column was the same accent color) AND as the picker swatches —
// so it stays on-theme and adapts to light/dark + whichever theme is active.
const PALETTE = ["var(--graph-0)", "var(--graph-1)", "var(--graph-2)", "var(--graph-3)", "var(--graph-4)"];

// Module-level stash for the dragged row's vault-relative path.
let draggedPath: string | null = null;

// An optimistic move: the column key + order a just-dropped card should render at, before the
// backend write + refetch land. Keyed by note path.
type PendingMove = { key: string; order: number };

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
  // Editing (rename / reorder / colors / add) only works against a real base
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
  // The view's remaining `order:` properties — or, when the base declares its own property
  // set (list-form `properties:`), the engine-resolved columns — shown as editable meta chips
  // on each card below the title (which keeps its own dedicated editable slot). `description`
  // is not special-cased here (#103): a declared/`order`-listed `description` flows through
  // like any other property, rendered via its type (markdown by default — propertyEdit.ts).
  const metaCols = () =>
    metaColumns(
      metaSource(props.result.view.order, props.config.declaredProperties, props.result.columns, groupBy()?.property),
      titleCol(),
    );

  // Per-column color: explicit override > known-status palette > a palette slot chosen by a stable
  // hash of the column KEY (not its position) so reordering columns never recolors them.
  function colColor(key: string): string {
    const override = groupColors()[key];
    if (override) return override;
    if (STATUS_COLOR[key.trim().toLowerCase()]) return STATUS_COLOR[key.trim().toLowerCase()];
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(h) % PALETTE.length];
  }

  const [overCol, setOverCol] = createSignal<string | null>(null);
  const [overIndex, setOverIndex] = createSignal(0);
  const [dragPath, setDragPath] = createSignal<string | null>(null);
  const [fromCol, setFromCol] = createSignal<string | null>(null);
  // Height of the card currently being dragged, so the drop placeholder is exactly its size
  // (not a fixed 46px). Projected onto the board as the `--kb-drag-h` CSS var.
  const [dragH, setDragH] = createSignal(46);

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

  // Optimistic moves: on drop we place cards immediately from this overlay so a dragged card
  // never snaps back to its origin while the async setProperty writes + refetch are in flight
  // (the flicker). Each entry clears itself once the server data catches up (see the effect below).
  const [pending, setPending] = createSignal<Record<string, PendingMove>>({});
  // Just-created cards, shown INSTANTLY in their column before the file write's (debounced) refetch
  // brings the real row — so adding a card doesn't blink/hide-then-reappear. Each clears once the
  // server data contains its path.
  const [pendingAdds, setPendingAdds] = createSignal<Array<{ row: Row; col: string }>>([]);
  // Optimistic column order after a header drag — so the columns settle instantly instead of
  // snapping back while the `columns` write + refetch land. Cleared once the server order matches.
  const [pendingColOrder, setPendingColOrder] = createSignal<string[] | null>(null);

  /** Effective within-column sort order: the pending (optimistic) order if this card has one for
   * this column, else its explicit `order`, else its stable engine position. */
  function effOrder(row: Row, group: ResultGroup): number {
    const mv = pending()[row.file.path];
    if (mv && mv.key === group.key) return mv.order;
    const o = (row.note as Record<string, unknown>)[ORDER_KEY];
    return typeof o === "number" ? o : group.rows.indexOf(row);
  }
  function sortedRows(group: ResultGroup): Row[] {
    return [...group.rows].sort((a, b) => effOrder(a, group) - effOrder(b, group));
  }

  // The groups to render: the server groups with any pending optimistic moves applied (a moved
  // card is pulled from its server column and shown in its pending target column). Column set +
  // order are untouched, so the Index below stays stable.
  const displayGroups = (): ResultGroup[] => {
    const pend = pending();
    const adds = pendingAdds();
    const groups = props.result.groups;
    if (Object.keys(pend).length === 0 && adds.length === 0) return groups;
    const byPath = new Map<string, Row>();
    for (const g of groups) for (const r of g.rows) byPath.set(r.file.path, r);
    return groups.map((g) => {
      const rows = g.rows.filter((r) => { const mv = pend[r.file.path]; return !mv || mv.key === g.key; });
      for (const [path, mv] of Object.entries(pend)) {
        if (mv.key === g.key && !rows.some((x) => x.file.path === path)) {
          const r = byPath.get(path);
          if (r) rows.push(r);
        }
      }
      // Optimistic new cards land at the bottom of their column until the real row resolves.
      for (const a of adds) {
        if (a.col === g.key && !byPath.has(a.row.file.path) && !rows.some((x) => x.file.path === a.row.file.path)) rows.push(a.row);
      }
      return { key: g.key, rows };
    });
  };

  // Clear each optimistic move once the freshly-resolved server data matches it exactly (the card
  // is in the target column AND its `order` equals the pending order) — so the overlay hands off to
  // real data with no visible jump. Entries that never needed a write (order already correct) match
  // immediately and clear on the next resolve.
  createEffect(() => {
    const groups = props.result.groups; // re-run only when the server data changes
    untrack(() => {
      if (Object.keys(pending()).length === 0) return;
      const cur = new Map<string, { key: string; order: unknown }>();
      for (const g of groups) for (const r of g.rows) cur.set(r.file.path, { key: g.key, order: (r.note as Record<string, unknown>)[ORDER_KEY] });
      setPending((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [path, mv] of Object.entries(prev)) {
          const c = cur.get(path);
          if (c && c.key === mv.key && c.order === mv.order) { delete next[path]; changed = true; }
        }
        return changed ? next : prev;
      });
    });
  });

  // Drop an optimistic new card once the server data actually contains its path (the write's
  // refetch has landed) — the path-keyed row then just re-points at the real Row, no remount.
  createEffect(() => {
    const groups = props.result.groups;
    untrack(() => {
      if (pendingAdds().length === 0) return;
      const present = new Set<string>();
      for (const g of groups) for (const r of g.rows) present.add(r.file.path);
      setPendingAdds((prev) => {
        const next = prev.filter((a) => !present.has(a.row.file.path));
        return next.length === prev.length ? prev : next;
      });
    });
  });

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
  // Same FLIP, for whole COLUMNS on a header reorder (they only move horizontally).
  const prevColRects = new Map<string, DOMRect>();
  function snapshotColRects() {
    if (!rootEl) return;
    prevColRects.clear();
    for (const el of rootEl.querySelectorAll<HTMLElement>("[data-kbcol]")) {
      const k = el.dataset.kbcol;
      if (k != null) prevColRects.set(k, el.getBoundingClientRect());
    }
  }
  function playColFlip() {
    if (!rootEl || prevColRects.size === 0) return;
    for (const el of rootEl.querySelectorAll<HTMLElement>("[data-kbcol]")) {
      const k = el.dataset.kbcol;
      const prev = k != null ? prevColRects.get(k) : undefined;
      if (!prev) continue;
      const dx = prev.left - el.getBoundingClientRect().left;
      if (dx === 0) continue;
      el.style.transition = "none";
      el.style.transform = `translateX(${dx}px)`;
      el.getBoundingClientRect();
      el.style.transition = "transform 200ms cubic-bezier(.2,.7,.2,1)";
      el.style.transform = "translateX(0)";
    }
    prevColRects.clear();
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

  // Tear any in-progress drag down if the view unmounts mid-drag (removes window listeners + ghost).
  onCleanup(() => endDrag());

  const dragActive = (): boolean => dragPath() !== null;

  // Cards shown in column: while dragging, lift the dragged card out of EVERY column (the floating
  // ghost represents it) so the placeholder is the only thing marking its new home.
  const visibleRows = (group: ResultGroup): Row[] => {
    const rows = sortedRows(group);
    return dragActive() ? rows.filter((r) => r.file.path !== dragPath()) : rows;
  };
  // Path list per column (the <For> is keyed by these primitive strings, so a within-column
  // reorder MOVES card DOM instead of remounting it — an `order`-only change re-keys the Row via
  // reconcileRows, which a ref-keyed <For> would remount). Row content is looked up reactively.
  const visiblePaths = (group: ResultGroup): string[] => visibleRows(group).map((r) => r.file.path);
  const rowByPath = createMemo(() => {
    const m = new Map<string, Row>();
    for (const g of displayGroups()) for (const r of g.rows) m.set(r.file.path, r);
    return m;
  });

  // Column KEY order to render (the outer <For> is keyed by these strings, so a reorder MOVES the
  // column DOM instead of re-rendering every column's content). Applies the optimistic order.
  const columnKeys = (): string[] => {
    const keys = displayGroups().map((g) => g.key);
    const order = pendingColOrder();
    if (!order) return keys;
    const present = new Set(keys);
    const out = order.filter((k) => present.has(k));
    for (const k of keys) if (!out.includes(k)) out.push(k);
    return out;
  };
  const groupByKey = (key: string): ResultGroup => displayGroups().find((g) => g.key === key) ?? { key, rows: [] };

  // Clear the optimistic column order once the server's column order matches it.
  createEffect(() => {
    const groups = props.result.groups;
    untrack(() => {
      const order = pendingColOrder();
      if (!order) return;
      const serverKeys = groups.map((g) => g.key);
      const a = serverKeys.filter((k) => order.includes(k));
      const b = order.filter((k) => serverKeys.includes(k));
      if (a.length === b.length && a.every((k, i) => k === b[i])) setPendingColOrder(null);
    });
  });

  // ── Pointer-based drag ──────────────────────────────────────────────────────────────────────
  // The packaged app runs in WKWebView, which has broken HTML5 drag-and-drop — so, like the rest of
  // Bismuth (dnd/viewDrag.ts drives the file tree), the kanban drags with POINTER events: arm on
  // pointerdown, commit past a small threshold, follow a cloned floating ghost, and resolve the drop
  // target under the cursor via elementFromPoint on the data-kbcol / data-kbcard attributes.
  const DRAG_THRESHOLD = 5;
  let armMode: "card" | "col" | null = null;
  let armPath = "";
  let armColKey = "";
  let armOrigin = { x: 0, y: 0 };
  let armGrab = { dx: 0, dy: 0 };
  let armSourceEl: HTMLElement | null = null;
  let ghostEl: HTMLElement | null = null;

  function startCardDrag(e: PointerEvent, path: string, colKey: string): void {
    if (e.button !== 0 || !editable()) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, button") || t.isContentEditable) return; // let fields/buttons work
    armMode = "card"; armPath = path; armColKey = colKey;
    armSourceEl = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-kbcard]");
    armPointer(e);
  }
  function startColDrag(e: PointerEvent, colKey: string): void {
    if (e.button !== 0 || !editable()) return;
    if ((e.target as HTMLElement).closest("button")) return; // the color-dot picker button
    armMode = "col"; armColKey = colKey;
    armSourceEl = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-kbcol]");
    armPointer(e);
  }
  function armPointer(e: PointerEvent): void {
    if (!armSourceEl) { armMode = null; return; }
    const r = armSourceEl.getBoundingClientRect();
    armOrigin = { x: e.clientX, y: e.clientY };
    armGrab = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("keydown", onDragKey);
  }
  // A floating clone of the grabbed element that tracks the cursor (HTML5 DnD gave this for free).
  function beginGhost(): void {
    if (!armSourceEl) return;
    const r = armSourceEl.getBoundingClientRect();
    const g = armSourceEl.cloneNode(true) as HTMLElement;
    // Strip the data-* so the ghost isn't matched by the FLIP / drop-resolution queries.
    g.removeAttribute("data-kbcard"); g.removeAttribute("data-path"); g.removeAttribute("data-kbcol");
    g.querySelectorAll("[data-kbcard],[data-path]").forEach((n) => { n.removeAttribute("data-kbcard"); n.removeAttribute("data-path"); });
    g.setAttribute("data-kbghost", "");
    Object.assign(g.style, {
      position: "fixed", left: "0", top: "0", width: `${r.width}px`, height: `${r.height}px`,
      margin: "0", pointerEvents: "none", zIndex: "10000", opacity: "0.92", boxShadow: "0 10px 28px rgba(0,0,0,0.4)",
    } as CSSStyleDeclaration);
    document.body.appendChild(g);
    ghostEl = g;
    moveGhost(armOrigin.x, armOrigin.y);
  }
  function moveGhost(x: number, y: number): void {
    if (ghostEl) ghostEl.style.transform = `translate(${x - armGrab.dx}px, ${y - armGrab.dy}px) rotate(2deg)`;
  }
  function onPointerMove(e: PointerEvent): void {
    const committed = dragPath() !== null || colDrag() !== null;
    if (!committed && Math.hypot(e.clientX - armOrigin.x, e.clientY - armOrigin.y) < DRAG_THRESHOLD) return;
    e.preventDefault();
    if (!committed) {
      document.documentElement.classList.add("kb-dragging");
      beginGhost();
      if (armMode === "card") {
        draggedPath = armPath;
        setDragH(armSourceEl ? armSourceEl.offsetHeight : 46);
        setFromCol(armColKey);
        setDragPath(armPath);
      } else {
        setColDrag(armColKey);
      }
    }
    moveGhost(e.clientX, e.clientY);
    if (armMode === "card") resolveCardTarget(e.clientX, e.clientY);
    else resolveColTarget(e.clientX, e.clientY);
  }
  function resolveCardTarget(x: number, y: number): void {
    const colEl = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-kbcol]");
    if (!colEl) return; // off the board — keep the last valid slot
    const key = colEl.dataset.kbcol ?? "";
    const cardEls = [...colEl.querySelectorAll<HTMLElement>("[data-kbcard]")].filter((el) => el.getAttribute("data-path") !== dragPath());
    let idx = cardEls.length;
    for (let k = 0; k < cardEls.length; k++) {
      const r = cardEls[k].getBoundingClientRect();
      if (y < r.top + r.height / 2) { idx = k; break; }
    }
    const moved = overCol() !== key || overIndex() !== idx;
    if (moved) snapshotRects();
    batch(() => { setOverCol(key); setOverIndex(idx); });
    if (moved) requestAnimationFrame(playFlip);
  }
  function resolveColTarget(x: number, y: number): void {
    const colEl = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-kbcol]");
    if (colEl) setColOver(colEl.dataset.kbcol ?? null);
  }
  function onPointerUp(e: PointerEvent): void {
    if (armMode === "card" && dragPath() !== null) {
      void dropCard();
    } else if (armMode === "col" && colDrag() !== null) {
      const from = colDrag();
      const colEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-kbcol]");
      const over = colEl ? colEl.dataset.kbcol ?? null : colOver();
      const after = colEl ? e.clientX > colEl.getBoundingClientRect().left + colEl.getBoundingClientRect().width / 2 : false;
      if (from !== null && over !== null) void reorderColumns(from, over, after);
    }
    endDrag();
  }
  async function dropCard(): Promise<void> {
    const path = draggedPath;
    const insertAt = overIndex();
    const targetKey = overCol();
    const from = fromCol();
    if (!path || targetKey === null) return;
    const gb = groupBy();
    if (!gb) return;
    const statusKey = writableKey(gb.property);
    const group = groupByKey(targetKey);
    const dragged =
      props.result.groups.flatMap((g) => g.rows).find((r) => r.file.path === path) ??
      pendingAdds().find((a) => a.row.file.path === path)?.row;
    if (!dragged) return;

    // Target column's new integer ordering — explicit orders for every card keep the sort stable
    // (a fractional-only scheme drifts). Applied OPTIMISTICALLY (see the clear-effect above).
    const others = sortedRows(group).filter((r) => r.file.path !== path);
    const i = Math.max(0, Math.min(insertAt, others.length));
    const newList = [...others.slice(0, i), dragged, ...others.slice(i)];
    snapshotRects();
    setPending((prev) => {
      const next = { ...prev };
      newList.forEach((r, k) => { next[r.file.path] = { key: targetKey, order: k }; });
      return next;
    });
    requestAnimationFrame(playFlip);

    // ONE batched request → ONE invalidation → ONE refetch (separate writes stormed the view). The
    // status change + the dragged card's order + the reindex of shifted siblings are all folded in.
    const writes: Array<{ path: string; key: string; value: unknown }> = [];
    if (statusKey !== null && from !== targetKey) writes.push({ path, key: statusKey, value: targetKey });
    writes.push({ path, key: ORDER_KEY, value: i });
    for (let k = 0; k < newList.length; k++) {
      const row = newList[k];
      if (row.file.path === path) continue;
      if ((row.note as Record<string, unknown>)[ORDER_KEY] !== k) writes.push({ path: row.file.path, key: ORDER_KEY, value: k });
    }
    await api.setProperties(writes);
  }
  function onDragKey(e: KeyboardEvent): void { if (e.key === "Escape") endDrag(); }
  function endDrag(): void {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", endDrag);
    window.removeEventListener("keydown", onDragKey);
    document.documentElement.classList.remove("kb-dragging");
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }
    armMode = null;
    armSourceEl = null;
    clearDrag();
  }

  // ── Column reorder — persist the full visible key order to `columns` (groupOrder). ──
  async function reorderColumns(from: string, over: string, after: boolean): Promise<void> {
    if (!props.basePath || from === over) return;
    const keys = columnKeys().filter((k) => k !== from);
    let ti = keys.indexOf(over);
    if (ti < 0) ti = keys.length;
    if (after) ti += 1;
    keys.splice(ti, 0, from);
    // Optimistic: reorder instantly (FLIP the columns) so they don't snap back during the write's
    // refetch. The single `columns` write's SSE drives one refetch; the clear-effect then drops the
    // overlay (no props.onChange — a second refetch is unnecessary).
    snapshotColRects();
    setPendingColOrder(keys);
    requestAnimationFrame(playColFlip);
    await api.setViewProperty(props.basePath, props.viewIndex ?? 0, "columns", keys);
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

  // ── Card meta property (any `order:` property besides title — including `description`,
  // #103 dropped its own dedicated write path in favor of this one) ──
  // Persists a value the card's type-aware chip editor produced. `null` clears the key
  // entirely (rather than writing a literal null into frontmatter) — file./formula./this.
  // ids have no writable key and are silently ignored (KanbanCard already gates the click).
  async function setMetaProperty(row: Row, id: string, value: unknown): Promise<void> {
    const key = writableKey(id);
    if (key === null) return;
    if (value === null || value === undefined || value === "") await api.deleteProperty(row.file.path, key);
    else await api.setProperty(row.file.path, key, value);
  }

  // Every OTHER row's raw value for `id`, across the whole board — feeds the meta chip
  // editor's "select from known values" fallback (propertyEdit.ts). Computed on demand (a
  // click, not every render) so it's cheap even though it's an O(rows) scan.
  function siblingValuesFor(id: string): unknown[] {
    return props.result.groups.flatMap((g) => g.rows).map((r) => resolveProperty(id, r));
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
  // serializer handles arrays/objects). Excludes only the status/order keys — `description` is no
  // longer special-cased (#103), so a fresh card only "inherits" one when every existing card
  // happens to share the identical text (the normal constProps rule for any property).
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

    // Declared property defaults (list-form `properties:`) seed first; frontmatter shared by
    // every existing card overrides them (a new card must keep matching the base's filter),
    // and the clicked column's status value always wins.
    const exclude = new Set([statusKey, ORDER_KEY]);
    const front: Record<string, unknown> = {
      ...declaredDefaults(props.config, exclude),
      ...constProps(exclude),
      [statusKey]: statusValue ?? colKey,
    };
    const content = `---\n${yamlStringify(front)}---\n`;
    const path = dedupe(`${folder ? folder + "/" : ""}${safeFilename(title)}.md`, takenPaths());
    const name = safeFilename(title);

    setBusy(true);
    try {
      // Show the card OPTIMISTICALLY so it appears the instant you hit Enter — then just write the
      // file. No props.onChange(): a PUT /file doesn't bump the version, so an eager refetch would
      // read stale rows; the file-watcher's debounced SSE refetch brings the real row and the
      // clear-effect drops the optimistic one (path-keyed → the card never blinks).
      const optimistic: Row = { file: placeholderFile(name, path), note: { ...front }, formula: {} };
      created.add(path);
      setDraft("");
      setPendingAdds((prev) => [...prev, { row: optimistic, col: colKey }]);
      await api.write(path, content);
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
      <div class={styles.kanban} ref={rootEl} style={{ "--kb-drag-h": `${dragH()}px` }}>
        {/* Columns are keyed by their group KEY (a stable string), so a header reorder MOVES the
            column DOM (FLIP-animated via data-kbcol) rather than re-rendering every column's content,
            and a card status-toggle refetch (same keys) reuses columns. `group()` is looked up
            reactively; the inner card <For> is path-keyed. `columnKeys()` folds in the optimistic
            reorder so columns settle instantly instead of snapping back during the write round-trip. */}
        <For each={columnKeys()}>
          {(key) => {
            const group = () => groupByKey(key);
            const color = () => colColor(key);
            return (
              <div
                class={styles.kanbanColumn}
                data-kbcol={key}
                classList={{
                  [styles.kanbanColumnOver]: overCol() === key && colDrag() === null,
                  [styles.kanbanColReorder]: colOver() === key && colDrag() !== null && colDrag() !== key,
                  [styles.kanbanColDragging]: colDrag() === key,
                }}
                style={{ "--kb-col-color": color() }}
              >
                <div
                  class={styles.kanbanColHeader}
                  onPointerDown={(e) => startColDrag(e, key)}
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
                  <For each={visiblePaths(group())}>
                    {(path, i) => {
                      const [editing, setEditing] = createSignal(false);
                      const row = () => rowByPath().get(path);
                      return (
                        <>
                          <div
                            class={`${styles.kanbanPlaceholder} ${
                              overCol() === group().key && overIndex() === i() ? styles.kanbanPlaceholderActive : ""
                            }`}
                          />
                          <Show when={row()}>
                            {(r) => (
                              <div
                                class={styles.card}
                                data-kbcard=""
                                data-path={path}
                                onPointerDown={(e) => { if (!editing()) startCardDrag(e, path, group().key); }}
                              >
                                <div class={styles.cardBodyInner}>
                                  <KanbanCard
                                    row={r()}
                                    titleCol={titleCol()}
                                    metaCols={metaCols()}
                                    config={props.config}
                                    editable={editable()}
                                    onEditingChange={setEditing}
                                    onRename={(t) => void renameCard(r(), t)}
                                    onSetMeta={(id, v) => void setMetaProperty(r(), id, v)}
                                    siblingValues={siblingValuesFor}
                                  />
                                </div>
                              </div>
                            )}
                          </Show>
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
                          title="Add a card"
                          aria-label="Add a card"
                          onClick={() => { setComposerCol(group().key); setDraft(""); }}
                        >
                          <Icon value="Plus" size={16} />
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
        </For>
      </div>
    </Show>
  );
}
