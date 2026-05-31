import { For, Show } from "solid-js";
import type { Row, BaseConfig } from "../../../core/src/bases/types";
import { renderValue, columnLabel } from "./renderValue";
import styles from "./BaseView.module.css";

/**
 * Shared card body: the first column becomes the card title; every other column
 * becomes a labeled field. Used identically by CardsView (non-body branch) and
 * KanbanView so card layout lives in one place.
 */
export function CardBody(props: { cols: string[]; row: Row; config: BaseConfig }) {
  return (
    <For each={props.cols}>
      {(c, i) => (
        <Show
          when={i() === 0}
          fallback={
            <div class={styles.cardField}>
              <span class={styles.cardKey}>{columnLabel(c, props.config)}</span>
              <span>{renderValue(c, props.row)}</span>
            </div>
          }
        >
          <div class={styles.cardTitle}>{renderValue(c, props.row)}</div>
        </Show>
      )}
    </For>
  );
}
