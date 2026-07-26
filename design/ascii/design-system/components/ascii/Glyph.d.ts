/**
 * Raw character block on the grid — the base of every ASCII primitive.
 * `dense` switches to the 7px cell used by the 1000-node field.
 */
export interface GlyphProps {
  text: string;
  dense?: boolean;
  color?: string;
  opacity?: number;
  /** Apply --glow-accent (only visible in the Cathode scope). */
  glow?: boolean;
  style?: React.CSSProperties;
  className?: string;
}
export declare function Glyph(props: GlyphProps): JSX.Element;
export declare function noiseField(cols: number, rows: number, density?: number, seed?: number): string;
