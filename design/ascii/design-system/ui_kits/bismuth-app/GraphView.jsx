const NODES = [
  { x: 10, y: 13 }, { x: 74, y: 9 }, { x: 40, y: 29 }, { x: 70, y: 41 },
  { x: 20, y: 45 }, { x: 12, y: 58 }, { x: 56, y: 20 }, { x: 62, y: 54 },
];
const EDGES = [[2,0],[2,1],[2,3],[2,4],[2,6],[0,4],[1,3],[4,5],[3,7],[6,1],[5,2],[7,2]];
/* Labels are placed in GRID CELLS, then converted to px against the same cell
   metrics the field uses — so a label can never drift off a narrower pane. */
const CELL_W = 6.3, CELL_H = 11, PAD_X = 8, PAD_Y = 10;
const LABEL_CELLS = [
  { text: "[[attention as a resource]]", col: 5, row: 11, color: "var(--graph-0)" },
  { text: "[[reading.base]]", col: 66, row: 7, color: "var(--graph-2)" },
  { text: "[[2029-09-15 journal]]", col: 34, row: 27, active: true },
  { text: "[[third brain]]", col: 64, row: 39, color: "var(--graph-3)" },
  { text: "[[walking notes]]", col: 15, row: 43, color: "var(--graph-1)" },
  { text: "[[graphis scripta]]", col: 7, row: 56, color: "var(--graph-4)" },
];

/** Convert cell coords to px, clamping each label inside `cols` so none can overflow. */
function placeLabels(cols) {
  return LABEL_CELLS.map((l) => {
    const wide = l.text.length + 2;
    const col = Math.max(0, Math.min(cols - wide, l.col));
    return { ...l, left: PAD_X + col * CELL_W + "px", top: PAD_Y + l.row * CELL_H - 8 + "px" };
  });
}

function GraphView() {
  const [brain, setBrain] = React.useState("2nd");
  const [dim, setDim] = React.useState("2d");
  const [zoom, setZoom] = React.useState(0);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="viewbar">
        <div style={{ flex: 1 }} />
        <span style={{ color: "var(--faint)", fontSize: "var(--fs-micro)" }}>{zoom}%</span>
        <SegmentedToggle value={dim} onChange={setDim}
          options={[{ id: "2d", label: "2D" }, { id: "3d", label: "3D" }]} />
        <SegmentedToggle value={brain} onChange={setBrain}
          options={[{ id: "2nd", label: "2ND BRAIN" }, { id: "3rd", label: "3RD BRAIN" }, { id: "daemon", label: "DAEMON" }]} />
      </div>
      <div onWheel={(e) => setZoom((z) => Math.max(0, Math.min(100, z + (e.deltaY > 0 ? -10 : 10))))}
           style={{ flex: 1, cursor: "grab", position: "relative", overflow: "hidden" }}>
        <GraphField showNoise={false} cols={110} rows={62} nodes={NODES} edges={EDGES} labels={placeLabels(110)}
                    style={{ position: "absolute", inset: 0,
                             transform: dim === "3d" ? "rotateX(56deg) rotateZ(-20deg)" : "none" }} />
      </div>
    </div>
  );
}

/** Node glyphs on their own grid layer: weight is degree, the active note is accented. */
function nodeLayer(cols, rows, nodes, edges, pick) {
  const deg = nodes.map(() => 0);
  edges.forEach(([a, b]) => { if (deg[a] !== undefined) deg[a]++; if (deg[b] !== undefined) deg[b]++; });
  const grid = [];
  for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill(" "));
  nodes.forEach((n, i) => {
    if (n.y < 0 || n.y >= rows || n.x < 0 || n.x >= cols) return;
    const glyph = deg[i] >= 5 ? "@" : deg[i] >= 2 ? "o" : ".";
    if (pick(i, deg[i])) grid[n.y][n.x] = glyph;
  });
  return grid.map((r) => r.join("")).join("\n");
}

function MiniGraph() {
  const small = NODES.map((n) => ({ x: Math.round(n.x * 0.5), y: Math.round(n.y * 0.55) }));
  return (
    <React.Fragment>
      <Glyph text={rasterEdges(55, 33, small, EDGES)} dense color="var(--faint)"
             style={{ position: "absolute", left: 5, top: 5 }} />
      <Glyph text={nodeLayer(55, 33, small, EDGES, (i) => i !== 2)} dense color="var(--graph-2)"
             style={{ position: "absolute", left: 5, top: 5 }} />
      <Glyph text={nodeLayer(55, 33, small, EDGES, (i) => i === 2)} dense color="var(--accent)"
             style={{ position: "absolute", left: 5, top: 5 }} />
    </React.Fragment>
  );
}
