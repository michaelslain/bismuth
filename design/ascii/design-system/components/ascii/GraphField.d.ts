/**
 * The knowledge graph as a character field: noise + rasterized edges + node
 * labels. Node weight is its glyph (. leaf, o linked, @ hub), colour is its
 * cluster. Zoom must be implemented as resolution, never CSS scale.
 *
 * @startingPoint section="ASCII" subtitle="Rasterized ASCII knowledge graph" viewport="700x320"
 */
export interface GraphNode { x: number; y: number; }
export interface GraphLabel { text: string; left: string; top: string; color?: string; active?: boolean; }
export interface GraphFieldProps {
  cols?: number;
  rows?: number;
  nodes?: GraphNode[];
  /** Index pairs into `nodes`. */
  edges?: [number, number][];
  labels?: GraphLabel[];
  density?: number;
  /** The glyph noise field. Off by default — texture, never the signal. */
  showNoise?: boolean;
  showEdges?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export declare function GraphField(props: GraphFieldProps): JSX.Element;
export declare function rasterEdges(cols: number, rows: number, nodes: GraphNode[], edges: [number, number][]): string;
