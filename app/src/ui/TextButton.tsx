import { splitProps, createMemo, type JSX } from "solid-js";
import { Button } from "./Button";
import type { ButtonSize } from "./buttonClass";
import { uppercaseWarning } from "./uiLint";

export type TextButtonVariant = "primary" | "ghost" | "danger" | "plain";

export type TextButtonProps = {
  variant?: TextButtonVariant;
  size?: ButtonSize;
  active?: boolean;
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Text-label button. The default app button.
 *
 * Standardization rules this component enforces:
 *  • Labels are UPPERCASE — pass already-uppercase text (no hidden CSS
 *    transform; what you pass is what shows). Lowercase input warns in dev.
 *  • Appearance comes from `variant`/`size` only — call sites pass layout
 *    (flex/margin/position) via `style`, never colors/borders/padding.
 */
export function TextButton(props: TextButtonProps) {
  const [local, rest] = splitProps(props, ["variant"]);
  if (import.meta.env?.DEV) {
    createMemo(() => {
      const w = uppercaseWarning(rest.children);
      if (w) console.warn(w);
    });
  }
  return <Button variant={local.variant ?? "primary"} {...rest} />;
}
