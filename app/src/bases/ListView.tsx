import { For, Show } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { resolveProperty } from "../../../core/src/bases/query";
import { renderValue } from "./renderValue";
import { Icon } from "../icons/Icon";
import styles from "./BaseView.module.css";

// Reuse the design's status palette for the grouped-by-status colored dots.
const STATUS_COLOR: Record<string, string> = {
  reading: "var(--teal)",
  "to read": "var(--blue)",
  toread: "var(--blue)",
  finished: "var(--green)",
  done: "var(--green)",
  complete: "var(--green)",
  abandoned: "var(--rose)",
  dropped: "var(--rose)",
};
function groupColor(key: string): string {
  return STATUS_COLOR[key.trim().toLowerCase()] ?? "var(--accent)";
}

export function ListView(props: { result: ViewResult; config: BaseConfig }) {
  const firstCol = (): string => props.result.columns[0] ?? "file.name";
  const authorCol = (): string | undefined => props.result.columns[1];
  const rightCol = (): string | undefined => props.result.columns[2];

  const open = (row: Row) => window.dispatchEvent(new CustomEvent("oa-open", { detail: row.file.path }));

  return (
    <div class={styles.list}>
      <For each={props.result.groups}>
        {(group) => (
          <div class={styles.lgroup}>
            <Show when={group.key !== ""}>
              <div class={styles.lghead} style={{ color: groupColor(group.key) }}>
                <span class={styles.dot} />
                {group.key}
                <span class={styles.count}>· {group.rows.length}</span>
              </div>
            </Show>
            <For each={group.rows}>
              {(row) => {
                const title = resolveProperty(firstCol(), row);
                const author = authorCol() ? resolveProperty(authorCol()!, row) : null;
                return (
                  <div class={styles.lrow} onClick={() => open(row)} style={{ cursor: "pointer" }}>
                    <Icon value="Book" size={15} />
                    <span class={styles.ltext}>
                      {title == null ? row.file.name : String(title)}
                      <Show when={author != null && typeof author !== "object"}>
                        <span style={{ color: "var(--faint)" }}> — {String(author)}</span>
                      </Show>
                    </span>
                    <Show when={rightCol()}>
                      <span style={{ color: "var(--text-muted)", "font-size": "11px", "flex": "0 0 auto" }}>
                        {renderValue(rightCol()!, row)}
                      </span>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
