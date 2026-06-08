import { splitProps, createMemo, type JSX } from "solid-js";
import { Button } from "./Button";
import { Icon } from "../icons/Icon";
import { isIconName } from "../icons/registry";
import { warnBadIcon, warnNonUppercase } from "./devWarn";
import type { ButtonState, ButtonSize } from "./buttonClass";

/** Selection state — see buttonClass.ts. "normal" = standalone button. */
export type IconTextButtonVariant = ButtonState;

export type IconTextButtonProps = {
  /** Lucide icon name (rendered before the label). Must resolve to a Lucide icon. */
  icon: string;
  /** Icon pixel size (default 14, matching view-bar controls). */
  iconSize?: number;
  /** "normal" (standalone, default) | "selected" | "unselected" (toggle/series member). */
  variant?: IconTextButtonVariant;
  /** Destructive tone — orthogonal to variant. */
  danger?: boolean;
  size?: ButtonSize;
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Icon + text button — the combination of IconButton and TextButton. Shares the
 * `.btn` family chrome (so it gets the app Monaspace font, hover/selected states,
 * and uppercase labels), with a leading Lucide icon.
 *
 * Labels are UPPERCASE (same rule as TextButton) — pass already-uppercase text.
 */
export function IconTextButton(props: IconTextButtonProps) {
  const [local, rest] = splitProps(props, ["icon", "iconSize", "variant", "children"]);
  if (import.meta.env?.DEV && !isIconName(local.icon)) {
    warnBadIcon("IconTextButton", local.icon);
  }
  if (import.meta.env?.DEV) {
    createMemo(() => warnNonUppercase("IconTextButton", local.children));
  }
  return (
    <Button kind="text" state={local.variant ?? "normal"} {...rest}>
      <Icon value={local.icon} size={local.iconSize ?? 14} />
      {local.children}
    </Button>
  );
}
