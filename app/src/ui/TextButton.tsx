import { splitProps, type JSX } from "solid-js";
import { Button } from "./Button";
import type { ButtonSize } from "./buttonClass";

export type TextButtonVariant = "primary" | "ghost" | "danger" | "plain";

export type TextButtonProps = {
  variant?: TextButtonVariant;
  size?: ButtonSize;
  active?: boolean;
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>;

/** Text-label button. The default app button. */
export function TextButton(props: TextButtonProps) {
  const [local, rest] = splitProps(props, ["variant"]);
  return <Button variant={local.variant ?? "primary"} {...rest} />;
}
