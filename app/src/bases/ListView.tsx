import { For, Show } from "solid-js";
import type { ViewResult, BaseConfig } from "../../../core/src/bases/types";
import { renderValue } from "./renderValue";
import styles from "./BaseView.module.css";

export function ListView(props: { result: ViewResult; config: BaseConfig }) {
  const firstCol = (): string => props.result.columns[0] ?? "file.name";

  return (
    <div class={styles.list}>
      <For each={props.result.groups}>
        {(group) => (
          <>
            <Show when={group.key !== ""}>
              <div class={styles.groupHeader}>{group.key}</div>
            </Show>
            <ul>
              <For each={group.rows}>{(row) => <li>{renderValue(firstCol(), row)}</li>}</For>
            </ul>
          </>
        )}
      </For>
    </div>
  );
}
