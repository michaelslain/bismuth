/**
 * The vertical right-hand tab strip. Collapsed to surface glyphs by default;
 * expands to glyph + filename. The active tab carries the sheen rule.
 *
 * @startingPoint section="ASCII" subtitle="Vertical glyph tab rail" viewport="700x300"
 */
export interface TabRailTab { id: string; glyph: string; label: string; }
export interface TabRailProps {
  tabs: TabRailTab[];
  value?: string;
  onChange?: (id: string) => void;
  open?: boolean;
  onToggle?: () => void;
  className?: string;
}
export declare function TabRail(props: TabRailProps): JSX.Element;
