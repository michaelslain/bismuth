// Local type declaration for d3-force-3d (no @types package available)
declare module "d3-force-3d" {
  export interface SimNode {
    id?: string;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    [key: string]: unknown;
  }

  export interface SimLink<N extends SimNode = SimNode> {
    source: string | N;
    target: string | N;
    [key: string]: unknown;
  }

  export interface Force<N extends SimNode = SimNode> {
    (alpha: number): void;
    initialize?(nodes: N[], random?: () => number): void;
  }

  export interface ManyBodyForce<N extends SimNode = SimNode> extends Force<N> {
    strength(): number;
    strength(s: number | ((d: N, i: number, nodes: N[]) => number)): this;
    distanceMin(): number;
    distanceMin(d: number): this;
    distanceMax(): number;
    distanceMax(d: number): this;
    theta(): number;
    theta(t: number): this;
  }

  export interface LinkForce<N extends SimNode = SimNode, L extends SimLink<N> = SimLink<N>> extends Force<N> {
    id(): (d: N, i: number, nodes: N[]) => string;
    id(fn: (d: N, i: number, nodes: N[]) => string): this;
    distance(): number | ((d: L, i: number, links: L[]) => number);
    distance(d: number | ((d: L, i: number, links: L[]) => number)): this;
    strength(): number | ((d: L, i: number, links: L[]) => number);
    strength(s: number | ((d: L, i: number, links: L[]) => number)): this;
    iterations(): number;
    iterations(n: number): this;
    links(): L[];
    links(links: L[]): this;
  }

  export interface PositionForce<N extends SimNode = SimNode> extends Force<N> {
    strength(): number | ((d: N, i: number, nodes: N[]) => number);
    strength(s: number | ((d: N, i: number, nodes: N[]) => number)): this;
  }

  export interface CenterForce<N extends SimNode = SimNode> extends Force<N> {
    x(): number;
    x(x: number): this;
    y(): number;
    y(y: number): this;
    z(): number;
    z(z: number): this;
  }

  export interface CollideForce<N extends SimNode = SimNode> extends Force<N> {
    radius(): (d: N, i: number, nodes: N[]) => number;
    radius(r: number | ((d: N, i: number, nodes: N[]) => number)): this;
    strength(): number;
    strength(s: number): this;
    iterations(): number;
    iterations(n: number): this;
  }

  export interface Simulation<N extends SimNode = SimNode> {
    restart(): this;
    stop(): this;
    tick(iterations?: number): this;
    nodes(): N[];
    nodes(nodes: N[]): this;
    alpha(): number;
    alpha(a: number): this;
    alphaMin(): number;
    alphaMin(a: number): this;
    alphaDecay(): number;
    alphaDecay(d: number): this;
    alphaTarget(): number;
    alphaTarget(a: number): this;
    velocityDecay(): number;
    velocityDecay(d: number): this;
    force(name: string): Force<N> | undefined;
    force(name: string, f: Force<N> | null): this;
    find(x: number, y: number, z?: number, radius?: number): N | undefined;
    on(typenames: string, listener: ((this: Simulation<N>) => void) | null): this;
    on(typenames: string): ((this: Simulation<N>) => void) | undefined;
    numDimensions(): number;
    numDimensions(n: number): this;
  }

  export function forceSimulation<N extends SimNode = SimNode>(nodes?: N[], numDimensions?: number): Simulation<N>;
  export function forceManyBody<N extends SimNode = SimNode>(): ManyBodyForce<N>;
  export function forceLink<N extends SimNode = SimNode, L extends SimLink<N> = SimLink<N>>(links?: L[]): LinkForce<N, L>;
  export function forceCenter<N extends SimNode = SimNode>(x?: number, y?: number, z?: number): CenterForce<N>;
  export function forceCollide<N extends SimNode = SimNode>(radius?: number | ((d: N, i: number, nodes: N[]) => number)): CollideForce<N>;
  export function forceX<N extends SimNode = SimNode>(x?: number | ((d: N, i: number, nodes: N[]) => number)): PositionForce<N>;
  export function forceY<N extends SimNode = SimNode>(y?: number | ((d: N, i: number, nodes: N[]) => number)): PositionForce<N>;
  export function forceZ<N extends SimNode = SimNode>(z?: number | ((d: N, i: number, nodes: N[]) => number)): PositionForce<N>;
}
