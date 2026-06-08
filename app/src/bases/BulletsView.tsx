import { For, Show } from "solid-js";
import type { ViewResult, BaseConfig } from "../../../core/src/bases/types";
import { renderValue } from "./renderValue";
import styles from "./BaseView.module.css";

/**
 * Plain markdown-style bullet list: one <li> per row (the first column, rendered as a
 * clickable link), grouped under each group key as a heading. No table chrome, no
 * column header, no per-row icons — reads like the note's own `- item` prose. Used for
 * reading-quote lists where the table UI is overkill.
 */
export function BulletsView(props: { result: ViewResult; config: BaseConfig }) {
  const col = (): string => props.result.columns[0] ?? "file.name";
  return (
    <div class={styles.bullets}>
      <For each={props.result.groups}>
        {(group) => (
          <div class={styles.bulletGroup}>
            <Show when={group.key !== ""}>
              <div class={styles.bulletGroupHead}>{group.key}</div>
            </Show>
            <ul class={styles.bulletList}>
              <For each={group.rows}>{(row) => <li class={styles.bulletItem}>{renderValue(col(), row)}</li>}</For>
            </ul>
          </div>
        )}
      </For>
    </div>
  );
}
