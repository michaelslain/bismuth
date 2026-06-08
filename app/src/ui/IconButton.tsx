import { splitProps, type JSX } from "solid-js";
import { Button } from "./Button";
import { Icon } from "../icons/Icon";
import { isIconName } from "../icons/registry";
import { warnBadIcon } from "./devWarn";
import type { ButtonState, ButtonSize } from "./buttonClass";

/** Selection state — see buttonClass.ts. "normal" = standalone, full opacity. */
export type IconButtonVariant = ButtonState;

export type IconButtonProps = {
  /** Lucide icon name (any casing / Li-Lu legacy). Must resolve to a Lucide icon — not a literal glyph or emoji. */
  icon: string;
  /** Required accessible label — sets aria-label and title. */
  label: string;
  /** "normal" (standalone, default) | "selected" | "unselected" (toggle/series member). */
  variant?: IconButtonVariant;
  /** Destructive tone — orthogonal to variant. */
  danger?: boolean;
  size?: ButtonSize;
  /** Icon pixel size (default 16). */
  iconSize?: number;
} & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">;

/**
 * Icon-only button. Icons must come from the Lucide set (via the icon
 * registry) — passing a literal glyph/emoji warns in dev.
 * "normal" renders full-opacity; "unselected" is the same dimmed; "selected" is highlighted.
 */
export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ["icon", "label", "variant", "iconSize", "title"]);
  if (import.meta.env?.DEV && !isIconName(local.icon)) {
    warnBadIcon("IconButton", local.icon);
  }
  return (
    <Button
      kind="icon"
      state={local.variant ?? "normal"}
      aria-label={local.label}
      title={local.title ?? local.label}
      {...rest}
    >
      <Icon value={local.icon} size={local.iconSize ?? 16} />
    </Button>
  );
}
