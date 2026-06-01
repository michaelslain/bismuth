import { splitProps, type JSX } from "solid-js";
import { Button } from "./Button";
import { Icon } from "../icons/Icon";
import { isIconName } from "../icons/registry";
import type { ButtonSize } from "./buttonClass";

export type IconButtonVariant = "icon" | "ghost" | "plain" | "danger";

export type IconButtonProps = {
  /** Lucide icon name (any casing / Li-Lu legacy). Must resolve to a Lucide icon — not a literal glyph or emoji. */
  icon: string;
  /** Required accessible label — sets aria-label and title. */
  label: string;
  variant?: IconButtonVariant;
  size?: ButtonSize;
  active?: boolean;
  /** Icon pixel size (default 16). */
  iconSize?: number;
} & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">;

/**
 * Icon-only button. Icons must come from the Lucide set (via the icon
 * registry) — passing a literal glyph/emoji warns in dev.
 */
export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ["icon", "label", "variant", "iconSize", "title"]);
  if (import.meta.env?.DEV && !isIconName(local.icon)) {
    console.warn(`IconButton: "${local.icon}" is not a Lucide icon name. Use a Lucide icon, not a literal glyph/emoji.`);
  }
  return (
    <Button
      variant={local.variant ?? "icon"}
      aria-label={local.label}
      title={local.title ?? local.label}
      {...rest}
    >
      <Icon value={local.icon} size={local.iconSize ?? 16} />
    </Button>
  );
}
