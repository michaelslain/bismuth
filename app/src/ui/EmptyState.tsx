import { Show, type JSX } from "solid-js";
import "./ui.css";

export type EmptyStateProps = {
  /** Optional heading shown above the message. */
  title?: string;
  class?: string;
  children?: JSX.Element;
};

/**
 * The "nothing here / all done" message block, previously hand-rolled as
 * `<div class="review-done"><h2/><p class="deck-empty"/></div>` and bare
 * `<p class="deck-empty">` across flashcards and base settings.
 */
export function EmptyState(props: EmptyStateProps) {
  return (
    <div class={`ui-empty-block ${props.class ?? ""}`}>
      <Show when={props.title}>{(t) => <h2>{t()}</h2>}</Show>
      <Show when={props.children}>
        <p class="ui-empty">{props.children}</p>
      </Show>
    </div>
  );
}

/** The repeated `<div class="loading">Loading…</div>` placeholder. */
export function Loading(props: { children?: JSX.Element }) {
  return <div class="ui-loading">{props.children ?? "Loading…"}</div>;
}
