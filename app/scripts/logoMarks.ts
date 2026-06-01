// app/scripts/logoMarks.ts
// Pure SVG-string emitters for the 14 Bismuth logo marks, ported from the
// reference logos.jsx. Each emitter returns a COMPLETE, self-contained <svg> (any
// gradient defs inlined) so the output works standalone as a favicon / <img>.
// gen-logos.ts writes these to app/public/logos. Math mirrors logos.jsx exactly.

const BIS = {
  rose: "#F0509B", violet: "#9B53E8", blue: "#3F6BF0",
  cyan: "#27C7D9", green: "#43D49A", gold: "#F2C53D",
};
const IRID = [BIS.rose, BIS.violet, BIS.blue, BIS.cyan, BIS.green, BIS.gold];

/** Trim a number to 3 decimals, no trailing zeros, so SVG output stays compact. */
const f = (x: number): string => Number(x.toFixed(3)).toString();
const wrap = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${body}</svg>`;

function rect(x: number, y: number, w: number, h: number, attrs: string): string {
  return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${attrs}/>`;
}
function circle(cx: number, cy: number, r: number, fill: string): string {
  return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}"/>`;
}
function line(a: number[], b: number[], attrs: string): string {
  return `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" ${attrs}/>`;
}

// ---- nested-squares family (Crystal + its rotations) --------------------
function crystal(rings: number, baseRot: number, rotStep: number): string {
  const cx = 50, cy = 50;
  let body = "";
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const half = 38 * (1 - t * 0.82);
    const rot = baseRot + i * rotStep;
    const col = IRID[Math.round(t * (IRID.length - 1))];
    body += rect(cx - half, cy - half, half * 2, half * 2,
      `rx="2.5" ry="2.5" transform="rotate(${f(rot)} ${cx} ${cy})" fill="${col}" stroke="rgba(0,0,0,0.18)" stroke-width="0.8"`);
  }
  return wrap(body);
}

// ---- regular-polygon bloom family ---------------------------------------
function polyPoints(cx: number, cy: number, r: number, sides: number, rotDeg: number): number[][] {
  const pts: number[][] = [];
  for (let k = 0; k < sides; k++) {
    const a = ((rotDeg + (k * 360) / sides - 90) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
function polyBloom(sides: number, rings: number, rotStep: number, baseRot: number): string {
  const cx = 50, cy = 50;
  let body = "";
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const r = 44 * (1 - t * 0.82);
    const col = IRID[Math.round(t * (IRID.length - 1))];
    const pts = polyPoints(cx, cy, r, sides, baseRot + i * rotStep)
      .map((p) => `${f(p[0])},${f(p[1])}`).join(" ");
    body += `<polygon points="${pts}" fill="${col}" stroke="rgba(20,21,27,0.16)" stroke-width="0.7" stroke-linejoin="round"/>`;
  }
  return wrap(body);
}

// ---- node-b (letter B from nodes, vertical iridescent gradient) ----------
function nodeB(): string {
  const N = [[30,16],[30,38],[30,62],[30,84],[52,16],[66,27],[52,38],[56,50],[72,67],[54,84],[30,50]];
  const E = [[0,1],[1,10],[10,2],[2,3],[0,4],[4,5],[5,6],[6,1],[10,7],[7,8],[8,9],[9,3]];
  const defs =
    `<defs><linearGradient id="bis-irid-v" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${BIS.gold}"/><stop offset="25%" stop-color="${BIS.green}"/>` +
    `<stop offset="50%" stop-color="${BIS.cyan}"/><stop offset="75%" stop-color="${BIS.blue}"/>` +
    `<stop offset="100%" stop-color="${BIS.rose}"/></linearGradient></defs>`;
  let edges = `<g stroke="url(#bis-irid-v)" stroke-width="3" stroke-linecap="round">`;
  for (const [a, b] of E) edges += line(N[a], N[b], "");
  edges += "</g>";
  let nodes = "";
  N.forEach((n, i) => { nodes += circle(n[0], n[1], 4, IRID[i % IRID.length]); });
  return wrap(defs + edges + nodes);
}

// ---- square-funnel ------------------------------------------------------
function squareFunnel(): string {
  const n = 7;
  let body = "";
  for (let i = 0; i < n; i++) {
    const half = 40 - i * 4.6;
    const off = i * 2.0;
    const t = i / (n - 1);
    body += rect(50 + off - half, 50 + off - half, half * 2, half * 2,
      `rx="2" fill="${IRID[Math.round(t * (IRID.length - 1))]}" stroke="rgba(20,21,27,0.18)" stroke-width="0.7"`);
  }
  return wrap(body);
}

// ---- node-crystal -------------------------------------------------------
function nodeCrystal(): string {
  const cx = 50, cy = 50, rings = 4;
  let body = "";
  for (let i = 0; i < rings; i++) {
    const half = 36 - i * 8;
    body += rect(cx - half, cy - half, half * 2, half * 2,
      `rx="2" fill="none" stroke="rgba(174,180,194,0.42)" stroke-width="1.3"`);
    const col = IRID[i % IRID.length];
    for (const p of [[cx-half,cy-half],[cx+half,cy-half],[cx+half,cy+half],[cx-half,cy+half]]) {
      body += circle(p[0], p[1], 3, col);
    }
  }
  body += circle(cx, cy, 3.8, BIS.cyan);
  return wrap(body);
}

// ---- lattice + node-diamond (square grid; node-diamond rotates 45°) ------
function grid(a: number, b: number): { pts: number[][]; edges: number[][][] } {
  const n = 4, step = (b - a) / (n - 1);
  const pts: number[][] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) pts.push([a + c * step, a + r * step, r, c]);
  const edges: number[][][] = [];
  pts.forEach(([x, y, r, c]) => {
    if (c < n - 1) edges.push([[x, y], [x + step, y]]);
    if (r < n - 1) edges.push([[x, y], [x, y + step]]);
  });
  return { pts, edges };
}
function latticeBody(a: number, b: number): string {
  const { pts, edges } = grid(a, b);
  let g = `<g stroke="rgba(174,180,194,0.35)" stroke-width="1.2">`;
  for (const [p, q] of edges) g += line(p, q, "");
  g += "</g>";
  let nodes = "";
  pts.forEach(([x, y, r, c]) => { nodes += circle(x, y, 3, IRID[(r + c) % IRID.length]); });
  return g + nodes;
}
function lattice(): string { return wrap(latticeBody(20, 80)); }
function nodeDiamond(): string {
  return wrap(`<g transform="rotate(45 50 50)">${latticeBody(30, 70)}</g>`);
}

// ---- radial-graph -------------------------------------------------------
function radialGraph(): string {
  const cx = 50, cy = 50;
  const inner: number[][] = [], outer: number[][] = [], edges: number[][][] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((k * 60 - 90) * Math.PI) / 180;
    inner.push([cx + 17 * Math.cos(a), cy + 17 * Math.sin(a)]);
  }
  for (let k = 0; k < 12; k++) {
    const a = ((k * 30 - 90) * Math.PI) / 180;
    outer.push([cx + 36 * Math.cos(a), cy + 36 * Math.sin(a)]);
  }
  inner.forEach((p, k) => {
    edges.push([[cx, cy], p]);
    edges.push([p, inner[(k + 1) % 6]]);
  });
  outer.forEach((p, k) => { edges.push([p, inner[Math.floor(k / 2)]]); });
  let g = `<g stroke="rgba(174,180,194,0.34)" stroke-width="1">`;
  for (const [p, q] of edges) g += line(p, q, "");
  g += "</g>";
  let nodes = "";
  outer.forEach((p, i) => { nodes += circle(p[0], p[1], 2.6, IRID[i % IRID.length]); });
  inner.forEach((p, i) => { nodes += circle(p[0], p[1], 3.2, IRID[i % IRID.length]); });
  nodes += circle(cx, cy, 4.4, BIS.cyan);
  return wrap(g + nodes);
}

// ---- node-rings ---------------------------------------------------------
function nodeRings(): string {
  const cx = 50, cy = 50, rings = 3;
  let body = "";
  for (let i = 0; i < rings; i++) {
    const h = 34 - i * 11;
    body += rect(cx - h, cy - h, h * 2, h * 2,
      `rx="2" fill="none" stroke="rgba(174,180,194,0.4)" stroke-width="1.2"`);
    const ring = [
      [cx-h,cy-h],[cx,cy-h],[cx+h,cy-h],[cx+h,cy],
      [cx+h,cy+h],[cx,cy+h],[cx-h,cy+h],[cx-h,cy],
    ];
    ring.forEach((p, k) => { body += circle(p[0], p[1], k % 2 ? 2.2 : 3, IRID[(i + k) % IRID.length]); });
  }
  body += circle(cx, cy, 3.4, BIS.cyan);
  return wrap(body);
}

/** Ordered mark names = the schema's appearance.icon enum (hopper-crystal first). */
export const MARK_NAMES = [
  "hopper-crystal", "node-b", "square-funnel", "nested-diamonds",
  "pinwheel", "node-crystal", "lattice", "diamond-bloom",
  "node-diamond", "octagon-bloom", "spin-cross", "tri-bloom",
  "radial-graph", "node-rings",
] as const;

export type MarkName = (typeof MARK_NAMES)[number];

const BUILDERS: Record<MarkName, () => string> = {
  "hopper-crystal": () => crystal(6, 0, 11),
  "node-b": nodeB,
  "square-funnel": squareFunnel,
  "nested-diamonds": () => crystal(6, 45, 5),
  "pinwheel": () => crystal(7, 0, 20),
  "node-crystal": nodeCrystal,
  "lattice": lattice,
  "diamond-bloom": () => crystal(7, 45, 18),
  "node-diamond": nodeDiamond,
  "octagon-bloom": () => polyBloom(8, 6, 14, 0),
  "spin-cross": () => polyBloom(4, 6, 45, 45),
  "tri-bloom": () => polyBloom(3, 6, 30, 0),
  "radial-graph": radialGraph,
  "node-rings": nodeRings,
};

export function buildMark(name: MarkName | string): string {
  const b = BUILDERS[name as MarkName];
  if (!b) throw new Error(`unknown logo mark: ${name}`);
  return b();
}
