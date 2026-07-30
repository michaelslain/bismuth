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
/**
 * Default glyph size. 16 -> 12 (2026-07-29): at 16px the icons read a size larger than everything
 * around them, which are 11.5px (--fs-ui, the app's workhorse); 12 sits with the text.
 *
 * 12 rather than 11.5 or 13 for a concrete reason: the pixel icons are authored on a 24x24 grid
 * (icons/pixelPaths.ts), so 12px is an exact 0.5 scale — every source pixel maps to the same number
 * of device pixels and the stems stay even. A fractional factor (11.5/24, 13/24) samples unevenly and
 * makes some strokes visibly heavier than others.
 */
export const ICON_PX = 12;

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
      <Icon value={local.icon} size={local.iconSize ?? ICON_PX} />
    </Button>
  );
}
