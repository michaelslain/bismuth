/** A popover/menu row. Hover and active share one treatment: accent-soft + accent text. */
export interface MenuRowProps {
  glyph?: string;
  kbd?: React.ReactNode;
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}
export declare function MenuRow(props: MenuRowProps): JSX.Element;
