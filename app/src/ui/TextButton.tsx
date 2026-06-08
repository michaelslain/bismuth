import { splitProps, createMemo, type JSX } from "solid-js";
import { Button } from "./Button";
import type { ButtonState, ButtonSize } from "./buttonClass";
import { warnNonUppercase } from "./devWarn";

/** Selection state — see buttonClass.ts. "normal" = standalone button. */
export type TextButtonVariant = ButtonState;

export type TextButtonProps = {
  /** "normal" (standalone, default) | "selected" | "unselected" (toggle/series member). */
  variant?: TextButtonVariant;
  /** Destructive tone (e.g. Delete) — orthogonal to variant. */
  danger?: boolean;
  size?: ButtonSize;
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Text-label button. The default app button.
 *
 * Standardization rules this component enforces:
 *  • Labels are UPPERCASE — pass already-uppercase text (no hidden CSS
 *    transform; what you pass is what shows). Lowercase input warns in dev.
 *  • Appearance comes from `variant` (selection state) only — call sites pass
 *    layout (flex/margin/position) via `style`, never colors/borders/padding.
 */
export function TextButton(props: TextButtonProps) {
  const [local, rest] = splitProps(props, ["variant"]);
  if (import.meta.env?.DEV) {
    createMemo(() => warnNonUppercase("TextButton", rest.children));
  }
  return <Button kind="text" state={local.variant ?? "normal"} {...rest} />;
}
