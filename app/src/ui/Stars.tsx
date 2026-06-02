// app/src/ui/Stars.tsx
// Five-star rating: filled --gold up to `value`, faint outline for the remainder.
// Canonical across Bases (table/cards/list/kanban) and anywhere else ratings show.
import { For } from "solid-js";
import { Icon } from "../icons/Icon";
import "./ui.css";

export function Stars(props: { value: number; max?: number; size?: number }) {
  const max = () => props.max ?? 5;
  const score = () => Math.max(0, Math.min(max(), Math.round(props.value)));
  return (
    <span class="stars">
      <For each={Array.from({ length: max() }, (_, i) => i + 1)}>
        {(i) => <Icon value="Star" size={props.size ?? 13} strokeWidth={1.6} class={i <= score() ? "star-on" : undefined} />}
      </For>
    </span>
  );
}
