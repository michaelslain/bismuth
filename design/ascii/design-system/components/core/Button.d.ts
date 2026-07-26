/**
 * The system's action button. Two kinds (text | icon) x three selection states
 * (normal | selected | unselected), with `danger` and `primary` as orthogonal tones.
 * `bracket` wraps the label in the ASCII brackets used for in-content actions.
 *
 * @startingPoint section="Core" subtitle="Bracketed ASCII action button" viewport="700x120"
 */
export interface ButtonProps {
  kind?: "text" | "icon";
  state?: "normal" | "selected" | "unselected";
  size?: "sm" | "md" | "lg";
  /** Destructive tone. */
  danger?: boolean;
  /** The single accent-filled call to action in a view. */
  primary?: boolean;
  /** Wrap the label in "[ … ]" — use for in-content actions, not chrome. */
  bracket?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;
export declare function buttonClass(opts: Omit<ButtonProps, "children">): string;
