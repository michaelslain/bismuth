import { For, Index, Show, createSignal, createEffect, on } from "solid-js";
import type { ViewResult, BaseConfig } from "../../../core/src/bases/types";
import { canonicalId } from "../../../core/src/bases/query";
import { renderCell, renderTitle, columnLabel, isTagColumn, isRatingColumn } from "./renderValue";
import { settings } from "../settings";
import styles from "./BaseView.module.css";

// Pixels from the right edge of a header that count as the resize grab zone.
const RESIZE_GRAB_PX = 10;

export function TableView(props: {
  result: ViewResult;
  config: BaseConfig;
  /** When set, dragging a header body reorders columns; called with the new order. */
  onReorder?: (cols: string[]) => void;
  /** Initial per-column widths (px); called after a resize-drag to persist them. */
  widths?: Record<string, number>;
  onWidthsChange?: (widths: Record<string, number>) => void;
}) {
  const cols = (): string[] => props.result.columns;
  const [, setDragIdx] = createSignal<number | null>(null);
  const [overIdx, setOverIdx] = createSignal<number | null>(null);
  const [w, setW] = createSignal<Record<string, number>>(props.widths ?? {});
  // Index of the column currently being resized (drives the visual cue + table-layout:fixed lock).
  const [resizing, setResizing] = createSignal<number | null>(null);
  let theadRef: HTMLTableSectionElement | undefined;

  // Re-apply persisted widths whenever they change (e.g. on reload / refetch).
  // TableView stays mounted across BaseView refetches, so the createSignal
  // initializer above only runs once — without this effect, widths saved to
  // the file would never re-appear after a reload. Skip while a drag owns w().
  createEffect(
    on(
      () => props.widths,
      (incoming) => {
        if (resizing() !== null) return;
        setW(incoming ?? {});
      },
      { defer: true },
    ),
  );

  const headerEls = () => (theadRef ? (Array.from(theadRef.querySelectorAll("th")) as HTMLElement[]) : []);

  // Pointer-based column reorder (deterministic; no HTML5 DnD). Header body only —
  // the right-edge resize handle stops propagation so it never starts a reorder.
  const startReorder = (fromIdx: number, e: PointerEvent) => {
    if (!props.onReorder) return;
    e.preventDefault();
    document.body.style.userSelect = "none";
    setDragIdx(fromIdx);
    const ths = headerEls();
    const onMove = (ev: PointerEvent) => {
      let over: number | null = null;
      ths.forEach((t, idx) => {
        const r = t.getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right) over = idx;
      });
      setOverIdx(over);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      const to = overIdx();
      setDragIdx(null);
      setOverIdx(null);
      if (to !== null && to !== fromIdx) {
        const arr = [...cols()];
        const [moved] = arr.splice(fromIdx, 1);
        arr.splice(to, 0, moved);
        props.onReorder!(arr);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Which column a pointerdown on header `idx` would resize, or null if not in a resize
  // zone. A column boundary is shared by two cells, so it's grabbable from BOTH sides:
  // the right edge of column i and the left edge of column i+1 both resize column i. This
  // matters because the visible separator is centered on the boundary and overhangs into
  // the next cell — without the left-edge branch, clicking that half would start a reorder.
  const resizeTarget = (idx: number, e: PointerEvent): number | null => {
    if (!props.onWidthsChange) return null;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.right - e.clientX <= RESIZE_GRAB_PX) return idx;
    if (idx > 0 && e.clientX - rect.left <= RESIZE_GRAB_PX) return idx - 1;
    return null;
  };

  // th pointerdown: in a resize zone (either edge of the boundary) → resize that column;
  // otherwise begin a reorder drag.
  const onHeaderPointerDown = (idx: number, e: PointerEvent) => {
    const target = resizeTarget(idx, e);
    if (target !== null) startResize(cols()[target], target, e);
    else startReorder(idx, e);
  };

  // Pointer-based column resize. Seeds unset widths from rendered header widths so the
  // switch to fixed layout doesn't jump.
  const startResize = (col: string, idx: number, e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    setResizing(idx);
    const ths = headerEls();
    const seed: Record<string, number> = { ...w() };
    // Seed every column from its rendered width so switching to table-layout:fixed
    // doesn't reflow the untouched columns.
    cols().forEach((c, i) => {
      if (seed[c] == null && ths[i]) seed[c] = ths[i].offsetWidth;
    });
    const startX = e.clientX;
    const startW = seed[col] ?? ths[idx]?.offsetWidth ?? 120;
    setW(seed);
    const onMove = (ev: PointerEvent) =>
      setW({ ...seed, [col]: Math.max(settings.ui.tableMinColWidth, Math.round(startW + (ev.clientX - startX))) });
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setResizing(null);
      props.onWidthsChange?.(w());
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // We can pin the table to a rigid, spreadsheet-style layout only when EVERY visible
  // column has a known width. The pinned table width is the exact SUM of those widths,
  // so resizing one column never redistributes space to the others: the grabbed column
  // changes, columns after it shift as a block, and columns before it stay exactly put.
  // A partial map (e.g. a column added after widths were saved) falls back to the fluid
  // 100% layout until a resize re-seeds every column.
  const totalWidth = (): number | null => {
    const map = w();
    if (cols().length === 0) return null;
    let sum = 0;
    for (const c of cols()) {
      const cw = map[c];
      if (!cw) return null;
      sum += cw;
    }
    return sum;
  };
  const fixed = () => totalWidth() !== null;
  // Per-th hover flag: when the pointer is in the right-edge zone, show the
  // col-resize cursor on the whole cell so the affordance is discoverable.
  const [edgeIdx, setEdgeIdx] = createSignal<number | null>(null);

  // table-layout:fixed honors the <colgroup> px widths; pinning the table width to the
  // exact sum of those widths (NOT 100% / min-width:100%) is what stops the browser from
  // stretching columns to fill the container. That stretch is what made resizing one
  // column visibly reflow the columns before it — the leftover space was being shared
  // across every column. With an exact-sum width there is no leftover to redistribute.
  const tableStyle = () => {
    const total = totalWidth();
    return total != null
      ? { "table-layout": "fixed" as const, width: `${total}px` }
      : undefined;
  };

  return (
    <table class={styles.table} style={tableStyle()}>
      <Show when={fixed()}>
        <colgroup>
          <For each={cols()}>{(c) => <col style={w()[c] ? { width: `${w()[c]}px` } : undefined} />}</For>
        </colgroup>
      </Show>
      <thead ref={theadRef}>
        <tr>
          <For each={cols()}>
            {(c, i) => (
              <th
                classList={{
                  [styles.thDrag]: !!props.onReorder,
                  [styles.thOver]: overIdx() === i(),
                  [styles.thResizable]: !!props.onWidthsChange,
                  [styles.thAtEdge]: edgeIdx() === i(),
                }}
                onPointerDown={(e) => onHeaderPointerDown(i(), e)}
                onPointerMove={(e) => setEdgeIdx(resizeTarget(i(), e) !== null ? i() : null)}
                onPointerLeave={() => setEdgeIdx(null)}
              >
                <span class={styles.thLabel}>{columnLabel(c, props.config)}</span>
                <Show when={props.onWidthsChange}>
                  <span class={styles.thResize} />
                </Show>
              </th>
            )}
          </For>
        </tr>
      </thead>
      <tbody>
        {/* Index-keyed groups (see ListView): keeps each group's rows mounted across a
            re-resolve so only the inner reference-keyed row <For> diffs — no whole-table
            remount flash on a task toggle. */}
        <Index each={props.result.groups}>
          {(group) => (
            <>
              <Show when={group().key !== ""}>
                <tr class={styles.groupRow}>
                  <td colspan={cols().length}>{group().key}</td>
                </tr>
              </Show>
              <For each={group().rows}>
                {(row) => (
                  <tr>
                    <For each={cols()}>
                      {(c, ci) => {
                        const muted = !isTagColumn(c) && !isRatingColumn(c) && ci() !== 0;
                        return (
                          <td classList={{ [styles.cellMuted]: muted }}>
                            {ci() === 0 ? renderTitle(c, row) : renderCell(c, row)}
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                )}
              </For>
            </>
          )}
        </Index>
      </tbody>
      <Show when={Object.keys(props.result.summaries).length > 0}>
        <tfoot>
          <tr>
            <For each={cols()}>
              {(c) => <td class={styles.summary}>{props.result.summaries[canonicalId(c)] ?? ""}</td>}
            </For>
          </tr>
        </tfoot>
      </Show>
    </table>
  );
}
