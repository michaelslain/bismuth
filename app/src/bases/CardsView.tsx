import { For, Show } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { resolveProperty } from "../../../core/src/bases/query";
import { BodyCard } from "./BodyCard";
import { CardBody } from "./CardBody";
import styles from "./BaseView.module.css";

export function CardsView(props: { result: ViewResult; config: BaseConfig }) {
  const cols = () => props.result.columns;
  const isBody = () => props.result.view.cardContent === "body";
  // Title = first column; author = second column (used for the generated cover).
  const titleCol = (): string => cols()[0] ?? "file.name";
  const authorCol = (): string | undefined => cols()[1];

  const coverTitle = (row: Row): string => {
    const v = resolveProperty(titleCol(), row);
    return v == null ? row.file.name : String(v);
  };
  const coverAuthor = (row: Row): string | null => {
    if (!authorCol()) return null;
    const v = resolveProperty(authorCol()!, row);
    return v == null || typeof v === "object" ? null : String(v);
  };

  return (
    <div class={styles.cards}>
      <For each={props.result.groups}>
        {(group) => (
          <>
            <Show when={group.key !== ""}>
              <div class={styles.groupHeader}>{group.key}</div>
            </Show>
            <div class={isBody() ? styles.bodyGrid : styles.cardGrid}>
              <For each={group.rows}>
                {(row) => (
                  <Show
                    when={isBody()}
                    fallback={
                      <div class={styles.card}>
                        <div class={styles.cardCover}>
                          <div class={styles.coverTitle}>{coverTitle(row)}</div>
                          <Show when={coverAuthor(row)}>
                            <div class={styles.coverAuthor}>{coverAuthor(row)}</div>
                          </Show>
                        </div>
                        <div class={styles.cardBodyInner}>
                          <CardBody cols={cols()} row={row} config={props.config} titleAsField />
                        </div>
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
