/**
 * Selectable pill — tags, filters, export options. `tone` tints the selected
 * state to one of the category hues (the app's PALETTE_TOKENS).
 */
export interface ChipProps {
  tone?: "accent" | "teal" | "blue" | "violet" | "green" | "gold" | "rose";
  selected?: boolean;
  glyph?: string;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  children?: React.ReactNode;
}
export declare function Chip(props: ChipProps): JSX.Element;
