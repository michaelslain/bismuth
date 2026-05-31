import { For, Show } from "solid-js";
import type { ViewResult, BaseConfig } from "../../../core/src/bases/types";
import { BodyCard } from "./BodyCard";
import { CardBody } from "./CardBody";
import styles from "./BaseView.module.css";

export function CardsView(props: { result: ViewResult; config: BaseConfig }) {
  const cols = () => props.result.columns;
  const isBody = () => props.result.view.cardContent === "body";

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
                  <Show
                    when={isBody()}
                    fallback={
                      <div class={styles.card}>
                        <CardBody cols={cols()} row={row} config={props.config} />
                      </div>
                    }
                  >
                    <BodyCard row={row} result={props.result} config={props.config} />
                  </Show>
                )}
              </For>
            </div>
          </>
        )}
      </For>
    </div>
  );
}
