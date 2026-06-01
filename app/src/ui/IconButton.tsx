import { splitProps, type JSX } from "solid-js";
import { Button } from "./Button";
import { Icon } from "../icons/Icon";
import type { ButtonSize } from "./buttonClass";

export type IconButtonVariant = "ghost" | "plain";

export type IconButtonProps = {
  /** Icon value passed to <Icon> (Lucide name, Li/Lu legacy, or emoji). */
  icon: string;
  /** Required accessible label — sets aria-label and title. */
  label: string;
  variant?: IconButtonVariant;
  size?: ButtonSize;
  active?: boolean;
  /** Icon pixel size (default 16). */
  iconSize?: number;
} & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">;

/** Icon-only button. */
export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ["icon", "label", "variant", "iconSize", "title"]);
  return (
    <Button
      variant={local.variant ?? "ghost"}
      aria-label={local.label}
      title={local.title ?? local.label}
      {...rest}
    >
      <Icon value={local.icon} size={local.iconSize ?? 16} />
    </Button>
  );
}
