import { For, Show, createSignal } from "solid-js";
import type { ViewResult, BaseConfig } from "../../../core/src/bases/types";
import { canonicalId } from "../../../core/src/bases/query";
import { renderValue, columnLabel } from "./renderValue";
import styles from "./BaseView.module.css";

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
  const [dragIdx, setDragIdx] = createSignal<number | null>(null);
  const [overIdx, setOverIdx] = createSignal<number | null>(null);
  const [w, setW] = createSignal<Record<string, number>>(props.widths ?? {});
  let theadRef: HTMLTableSectionElement | undefined;

  const headerEls = () => (theadRef ? (Array.from(theadRef.querySelectorAll("th")) as HTMLElement[]) : []);

  // Pointer-based column reorder (deterministic; no HTML5 DnD). Header body only —
  // the right-edge resize handle stops propagation so it never starts a reorder.
  const startReorder = (fromIdx: number, e: PointerEvent) => {
    if (!props.onReorder) return;
    e.preventDefault();
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

  // Pointer-based column resize. Seeds unset widths from rendered header widths so the
  // switch to fixed layout doesn't jump.
  const startResize = (col: string, e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ths = headerEls();
    const seed: Record<string, number> = { ...w() };
    cols().forEach((c, i) => {
      if (seed[c] == null && ths[i]) seed[c] = ths[i].offsetWidth;
    });
    const startX = e.clientX;
    const startW = seed[col] ?? 120;
    setW(seed);
    const onMove = (ev: PointerEvent) => setW({ ...seed, [col]: Math.max(60, Math.round(startW + (ev.clientX - startX))) });
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      props.onWidthsChange?.(w());
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const hasWidths = () => Object.keys(w()).length > 0;

  return (
    <table class={styles.table} style={hasWidths() ? { "table-layout": "fixed" } : undefined}>
      <Show when={hasWidths()}>
        <colgroup>
          <For each={cols()}>{(c) => <col style={w()[c] ? { width: `${w()[c]}px` } : undefined} />}</For>
        </colgroup>
      </Show>
      <thead ref={theadRef}>
        <tr>
          <For each={cols()}>
            {(c, i) => (
              <th
                classList={{ [styles.thDrag]: !!props.onReorder, [styles.thOver]: overIdx() === i() }}
                onPointerDown={(e) => startReorder(i(), e)}
              >
                <span class={styles.thLabel}>{columnLabel(c, props.config)}</span>
                <Show when={props.onWidthsChange}>
                  <span class={styles.thResize} onPointerDown={(e) => startResize(c, e)} />
                </Show>
              </th>
            )}
          </For>
        </tr>
      </thead>
      <tbody>
        <For each={props.result.groups}>
          {(group) => (
            <>
              <Show when={group.key !== ""}>
                <tr class={styles.groupRow}>
                  <td colspan={cols().length}>{group.key}</td>
                </tr>
              </Show>
              <For each={group.rows}>
                {(row) => (
                  <tr>
                    <For each={cols()}>{(c) => <td>{renderValue(c, row)}</td>}</For>
                  </tr>
                )}
              </For>
            </>
          )}
        </For>
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
