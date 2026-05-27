import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { api } from "../api";
import { parseBase } from "../../../core/src/bases/parse";
import { runView } from "../../../core/src/bases/query";
import type { BaseConfig, Row, ViewResult } from "../../../core/src/bases/types";
import { TableView } from "./TableView";
import { CardsView } from "./CardsView";
import { ListView } from "./ListView";
import styles from "./BaseView.module.css";

export function BaseView(props: { path?: string; source?: string }) {
  const [rows] = createResource(async () => (await api.vaultData()) as Row[]);
  const [sourceText] = createResource(
    () => props.path,
    async (p) => (p ? await api.read(p) : ""),
  );

  const config = createMemo<BaseConfig>(() => {
    const text = props.source ?? sourceText() ?? "";
    return parseBase(text);
  });

  const [activeView, setActiveView] = createSignal(0);

  const result = createMemo<ViewResult | null>(() => {
    const cfg = config();
    const data = rows();
    if (!data) return null;
    const idx = Math.min(activeView(), cfg.views.length - 1);
    return runView(cfg, data, idx);
  });

  return (
    <div class={styles.base}>
      <div class={styles.tabs}>
        <For each={config().views}>
          {(v, i) => (
            <button
              class={`${styles.tab} ${i() === activeView() ? styles.active : ""}`}
              onClick={() => setActiveView(i())}
            >
              {v.name}
            </button>
          )}
        </For>
      </div>
      <Show when={result()} fallback={<div class={styles.loading}>Loading…</div>}>
        {(res) => {
          const v = res().view;
          return (
            <Show when={v.type === "cards"} fallback={
              <Show when={v.type === "list"} fallback={<TableView result={res()} config={config()} />}>
                <ListView result={res()} config={config()} />
              </Show>
            }>
              <CardsView result={res()} config={config()} />
            </Show>
          );
        }}
      </Show>
    </div>
  );
}
