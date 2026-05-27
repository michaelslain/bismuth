import { For, Show } from "solid-js";
import type { ViewResult, BaseConfig } from "../../../core/src/bases/types";
import { renderValue, columnLabel } from "./renderValue";
import styles from "./BaseView.module.css";

export function TableView(props: { result: ViewResult; config: BaseConfig }) {
  const cols = () => props.result.columns;
  return (
    <table class={styles.table}>
      <thead>
        <tr>
          <For each={cols()}>{(c) => <th>{columnLabel(c, props.config)}</th>}</For>
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
              {(c) => <td class={styles.summary}>{props.result.summaries[c] ?? ""}</td>}
            </For>
          </tr>
        </tfoot>
      </Show>
    </table>
  );
}
