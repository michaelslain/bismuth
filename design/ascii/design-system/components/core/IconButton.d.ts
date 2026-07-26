/**
 * A glyph-only button. The glyph is a typed character — an ASCII control ("x", "+",
 * "<<") or one of the system's surface glyphs (⁘ ✎ ▤ ▦ ◈ ✳). Never an SVG icon.
 */
export interface IconButtonProps {
  /** The character to render. */
  glyph?: string;
  state?: "normal" | "selected" | "unselected";
  danger?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  children?: React.ReactNode;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
