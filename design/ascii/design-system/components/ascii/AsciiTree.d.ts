/**
 * The vault file tree, drawn with typed connectors.
 *
 * @startingPoint section="ASCII" subtitle="Typed-connector file tree" viewport="700x220"
 */
export interface AsciiTreeRow {
  id: string;
  label: string;
  depth?: number;
  last?: boolean;
  /** Surface glyph: ▸ folder · ✎ note · ▤ base · ◈ agent · ✳ daemon. */
  glyph?: string;
  /** Right-hand count, e.g. "(3)". */
  meta?: string;
}
export interface AsciiTreeProps {
  rows: AsciiTreeRow[];
  activeId?: string;
  onSelect?: (id: string) => void;
  className?: string;
}
export declare function AsciiTree(props: AsciiTreeProps): JSX.Element;
export declare function treePrefix(depth: number, last: boolean): string;
