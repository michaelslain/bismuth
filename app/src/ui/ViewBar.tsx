// app/src/ui/ViewBar.tsx
// The canonical view header used across content views (graph, bases, calendar,
// flashcards, …): a breadcrumb on the left, a flexible spacer, then right-aligned
// controls (SegmentedToggle switchers + VBtn buttons). Replaces per-view bespoke
// `.viewbar` markup so every header is structurally identical.
import { type JSX, Show } from "solid-js";
import { Icon } from "../icons/Icon";

/** The 46px header bar container. Compose <Crumb/>, <ViewBarSpacer/>, controls inside. */
export function ViewBar(props: { class?: string; children: JSX.Element }) {
  return <div class={`viewbar ${props.class ?? ""}`}>{props.children}</div>;
}

/** Breadcrumb: an optional leading icon + a bold title (the current view's name).
 *  `serif` renders the title in the editor serif (e.g. the standalone calendar month). */
export function Crumb(props: { icon?: string; iconSize?: number; serif?: boolean; children: JSX.Element }) {
  return (
    <span class="crumb">
      <Show when={props.icon}>{(i) => <Icon value={i()} size={props.iconSize ?? 15} />}</Show>
      <b classList={{ "crumb-serif": props.serif }}>{props.children}</b>
    </span>
  );
}

/** Flexible spacer that pushes subsequent controls to the right edge. */
export function ViewBarSpacer() {
  return <div class="vbar-sp" />;
}

/** A view-bar action button (28px, rounded). `active` gives the pressed/selected look. */
export function VBtn(props: {
  icon?: string;
  iconSize?: number;
  active?: boolean;
  title?: string;
  onClick?: (e: MouseEvent) => void;
  children?: JSX.Element;
}) {
  return (
    <button class="vbtn" classList={{ active: props.active }} title={props.title} onClick={(e) => props.onClick?.(e)}>
      <Show when={props.icon}>{(i) => <Icon value={i()} size={props.iconSize ?? 14} />}</Show>
      {props.children}
    </button>
  );
}
