/** Glyph + label button — used where a surface needs naming as well as marking. */
export interface IconTextButtonProps {
  glyph: string;
  state?: "normal" | "selected" | "unselected";
  size?: "sm" | "md" | "lg";
  danger?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  children?: React.ReactNode;
}
export declare function IconTextButton(props: IconTextButtonProps): JSX.Element;
