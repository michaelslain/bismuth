/** A borderless label button for inline affordances ("[ open ]", "…8 more"). */
export interface TextButtonProps {
  state?: "normal" | "selected" | "unselected";
  size?: "sm" | "md" | "lg";
  bracket?: boolean;
  danger?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  children?: React.ReactNode;
}
export declare function TextButton(props: TextButtonProps): JSX.Element;
