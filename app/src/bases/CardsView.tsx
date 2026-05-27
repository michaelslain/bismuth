import { For, Show } from "solid-js";
import type { ViewResult, BaseConfig } from "../../../core/src/bases/types";
import { renderValue, columnLabel } from "./renderValue";
import styles from "./BaseView.module.css";

export function CardsView(props: { result: ViewResult; config: BaseConfig }) {
  const cols = () => props.result.columns;
  return (
    <div class={styles.cards}>
      <For each={props.result.groups}>
        {(group) => (
          <>
            <Show when={group.key !== ""}>
              <div class={styles.groupHeader}>{group.key}</div>
            </Show>
            <div class={styles.cardGrid}>
              <For each={group.rows}>
                {(row) => (
                  <div class={styles.card}>
                    <For each={cols()}>
                      {(c, i) => (
                        <Show
                          when={i() === 0}
                          fallback={
                            <div class={styles.cardField}>
                              <span class={styles.cardKey}>{columnLabel(c, props.config)}</span>
                              <span>{renderValue(c, row)}</span>
                            </div>
                          }
                        >
                          <div class={styles.cardTitle}>{renderValue(c, row)}</div>
                        </Show>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </>
        )}
      </For>
    </div>
  );
}
