import { splitProps, type JSX } from "solid-js";
import { buttonClass, type ButtonVariant, type ButtonSize } from "./buttonClass";
import "./ui.css";

export type { ButtonVariant, ButtonSize };

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Internal base button: owns the shared .btn chrome. App code should import
 * TextButton / IconButton, not this directly.
 */
export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "active", "class", "type", "children"]);
  return (
    <button
      type={local.type ?? "button"}
      class={buttonClass({ variant: local.variant, size: local.size, active: local.active, class: local.class })}
      {...rest}
    >
      {local.children}
    </button>
  );
}
