import { splitProps, type JSX } from "solid-js";
import { buttonClass, type ButtonKind, type ButtonState, type ButtonSize } from "./buttonClass";
import "./ui.css";

export type { ButtonKind, ButtonState, ButtonSize };

export type ButtonProps = {
  kind?: ButtonKind;
  state?: ButtonState;
  size?: ButtonSize;
  danger?: boolean;
  /** Selected + a glow rim — the view's one emphasized action. See buttonClass.ts. */
  primary?: boolean;
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Internal base button: owns the shared .btn chrome. App code should import
 * TextButton / IconButton, not this directly.
 */
export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["kind", "state", "size", "danger", "primary", "class", "type", "children"]);
  return (
    <button
      type={local.type ?? "button"}
      class={buttonClass({ kind: local.kind, state: local.state, size: local.size, danger: local.danger, primary: local.primary, class: local.class })}
      {...rest}
    >
      {local.children}
    </button>
  );
}
