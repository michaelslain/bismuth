import { For, Show } from "solid-js";
import type { ViewType } from "../../../core/src/bases/types";
import styles from "./BaseSkeleton.module.css";

/**
 * Shaped loading placeholder for a base view. Instead of a generic spinner, it
 * paints the silhouette of the view kind (a table's header + rows, or a grid of
 * card outlines) so the pane shows structure the instant it opens while the rows
 * resolve. Used as the BaseView fallback before any cached/fetched rows arrive.
 *
 * Only the table and card silhouettes are distinct; every other kind falls back
 * to the table outline (a header row over body rows reads as "data loading" for
 * lists/kanban/charts too).
 */
export function BaseSkeleton(props: { type: ViewType }) {
  const isCards = () => props.type === "cards";
  return (
    <div class={styles.skeleton} aria-hidden="true">
      <Show when={isCards()} fallback={<TableSkeleton />}>
        <CardsSkeleton />
      </Show>
    </div>
  );
}

/** A header row over evenly-spaced body rows — the generic "table loading" shape. */
function TableSkeleton() {
  return (
    <div class={styles.table}>
      <div class={styles.head}>
        <For each={[0, 1, 2, 3]}>{() => <div class={styles.headCell} />}</For>
      </div>
      <For each={Array.from({ length: 8 })}>
        {() => (
          <div class={styles.row}>
            <For each={[0, 1, 2, 3]}>{() => <div class={styles.cell} />}</For>
          </div>
        )}
      </For>
    </div>
  );
}

/** A grid of card outlines (cover bar + a couple of text lines). */
function CardsSkeleton() {
  return (
    <div class={styles.cards}>
      <For each={Array.from({ length: 10 })}>
        {() => (
          <div class={styles.card}>
            <div class={styles.cardCover} />
            <div class={styles.cardLineWide} />
            <div class={styles.cardLine} />
          </div>
        )}
      </For>
    </div>
  );
}
