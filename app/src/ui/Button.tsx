import { splitProps, type JSX } from "solid-js";
import "./ui.css";

export type ButtonVariant = "primary" | "ghost" | "danger" | "icon" | "plain";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Highlights the button as the selected option in a group (adds .is-active). */
  active?: boolean;
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * The one button used across the app. Replaces the ad-hoc .card-btn / .icon-btn /
 * .empty-pane-btn / .srs-icon-btn / .cram-toggle / .srcBtn families and the inline
 * button styles that were duplicated per call site. Pass `class` to layer on
 * site-specific tweaks; all standard chrome lives in ui.css.
 */
export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "active", "class", "type", "children"]);
  const cls = () =>
    [
      "btn",
      `btn--${local.variant ?? "primary"}`,
      local.size && local.size !== "md" ? `btn--${local.size}` : "",
      local.active ? "is-active" : "",
      local.class ?? "",
    ]
      .filter(Boolean)
      .join(" ");
  return (
    <button type={local.type ?? "button"} class={cls()} {...rest}>
      {local.children}
    </button>
  );
}
