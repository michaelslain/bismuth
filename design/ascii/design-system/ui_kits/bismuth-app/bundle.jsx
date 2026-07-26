/** @jsxRuntime classic */
/* Generated bundle — see readme.md "Build note". Do not edit. */

/* -- components/core/Button.jsx */
/** Class-string composition mirroring app/src/ui/buttonClass.ts. */
function buttonClass({ kind = "text", state = "normal", size = "md", danger, primary, className }) {
  return [
    "btn",
    `btn--${kind}`,
    `btn--${state}`,
    size && size !== "md" ? `btn--${size}` : "",
    primary ? "btn--primary" : "",
    danger ? "btn--danger" : "",
    className,
  ].filter(Boolean).join(" ");
}

/**
 * The bracketed action button. Labels are lowercase inside brackets for in-content
 * actions ("[ accept ]") and UPPERCASE bare for chrome segments ("MONTH").
 */
function Button({ kind = "text", state = "normal", size = "md", danger, primary,
                         bracket = false, disabled, title, onClick, className, children }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
            className={buttonClass({ kind, state, size, danger, primary, className })}>
      {bracket ? <>[&nbsp;{children}&nbsp;]</> : children}
    </button>
  );
}

/* -- components/core/IconButton.jsx */
/** A glyph-only button: window controls, tab-rail entries, row affordances. */
function IconButton({ glyph, state = "normal", danger, title, onClick, className, children }) {
  return (
    <button type="button" title={title} onClick={onClick}
            className={buttonClass({ kind: "icon", state, danger, className })}>
      {glyph ?? children}
    </button>
  );
}

/* -- components/core/TextButton.jsx */
/** A borderless label button — inline affordances like "[ open ]" in a panel header. */
function TextButton({ children, ...rest }) {
  return <Button {...rest} className={["btn--bare", rest.className].filter(Boolean).join(" ")}>{children}</Button>;
}

/* -- components/core/IconTextButton.jsx */
/** Glyph + label, in that order, on one cell of gap. */
function IconTextButton({ glyph, state = "normal", size, danger, title, onClick, className, children }) {
  return (
    <button type="button" title={title} onClick={onClick}
            className={buttonClass({ kind: "text", state, size, danger, className })}>
      <span className="btn-glyph">{glyph}</span>
      <span className="btn-label">{children}</span>
    </button>
  );
}

/* -- components/core/SegmentedToggle.jsx */
/**
 * A row of mutually exclusive buttons sharing one rule — the canonical
 * selected/unselected consumer (graph 2D/3D, calendar span, base view kind).
 */
function SegmentedToggle({ options, value, onChange, size, className }) {
  return (
    <div className={["segmented", className].filter(Boolean).join(" ")}>
      {options.map((opt) => (
        <Button key={String(opt.id)} size={size} title={opt.title}
                state={opt.id === value ? "selected" : "unselected"}
                onClick={() => onChange(opt.id)}>
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

/* -- components/core/Chip.jsx */
/** A selectable pill. `tone` tints the SELECTED state to a category hue. */
function Chip({ tone = "accent", selected, glyph, title, onClick, className, children }) {
  return (
    <button type="button" title={title} onClick={onClick}
            className={["chip-toggle", `tone-${tone}`, selected ? "selected" : "", className].filter(Boolean).join(" ")}>
      {glyph ? <span>{glyph}</span> : null}
      {children}
    </button>
  );
}

/* -- components/forms/Field.jsx */
/** A label that wraps its control. Labels are lowercase chrome, never uppercase. */
function Field({ label, hint, className, children }) {
  return (
    <label className={["ui-field", className].filter(Boolean).join(" ")}>
      <span>{label}</span>
      {children}
      {hint ? <span style={{ color: "var(--faint)", fontSize: "var(--fs-micro)" }}>{hint}</span> : null}
    </label>
  );
}

/* -- components/forms/TextInput.jsx */
/** Single-line or multiline text entry. Focus is an accent border + soft ring. */
function TextInput({ multiline, value, placeholder, onChange, className, ...rest }) {
  const cls = ["ui-input", className].filter(Boolean).join(" ");
  return multiline
    ? <textarea className={cls} value={value} placeholder={placeholder}
                onChange={(e) => onChange?.(e.target.value)} {...rest} />
    : <input className={cls} value={value} placeholder={placeholder}
             onChange={(e) => onChange?.(e.target.value)} {...rest} />;
}

/* -- components/forms/SearchBar.jsx */
/** Search entry. The lead is a typed prompt character, not a magnifier icon. */
function SearchBar({ value, placeholder = "search vault", lead = ">", onChange, trailing, className }) {
  return (
    <div className={["search-bar", className].filter(Boolean).join(" ")}>
      <span className="search-bar-lead">{lead}</span>
      <input className="search-bar-input" value={value} placeholder={placeholder}
             onChange={(e) => onChange?.(e.target.value)} />
      {trailing}
    </div>
  );
}

/* -- components/forms/MarkdownField.jsx */
/**
 * The note-editing surface: a frontmatter block, then ruled prose. Wikilinks and
 * tags are tinted inline; the underline IS the paper.
 */
function MarkdownField({ frontmatter, children, className }) {
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
      {frontmatter ? (
        <div className="asc-frontmatter">
          <div>---</div>
          {Object.entries(frontmatter).map(([k, v]) => (
            <div key={k} style={{ whiteSpace: "pre" }}>{k.padEnd(8)} {String(v)}</div>
          ))}
          <div>---</div>
        </div>
      ) : null}
      <div className="asc-prose">{children}</div>
    </div>
  );
}

/* -- components/display/StatusDot.jsx */
/** The category palette for statuses — mirrors app/src/ui/StatusDot.tsx. */
const STATUS_COLOR = {
  reading: "var(--teal)",
  "to read": "var(--blue)",
  toread: "var(--blue)",
  finished: "var(--green)",
  done: "var(--green)",
  complete: "var(--green)",
  abandoned: "var(--rose)",
  dropped: "var(--rose)",
};

function statusColor(s) {
  return STATUS_COLOR[String(s).trim().toLowerCase()] ?? "var(--faint)";
}

/** Just the dot. */
function StatusDot({ color, status }) {
  return <span className="status-dot" style={{ background: color ?? (status ? statusColor(status) : "var(--faint)") }} />;
}

/** Dot + word, both tinted to the status color. */
function StatusText({ status }) {
  return (
    <span className="status-text" style={{ color: statusColor(status) }}>
      <span className="status-dot" />{status}
    </span>
  );
}

/* -- components/display/Stars.jsx */
/** A typed rating: filled stars in gold, empty in faint. */
function Stars({ value = 0, max = 5 }) {
  return (
    <span className="stars">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? "star-on" : undefined}>{i < value ? "*" : "."}</span>
      ))}
    </span>
  );
}

/* -- components/display/Card.jsx */
/** Hairline surface card. `proposal` adds the 2px accent left edge. */
function Card({ label, meta, proposal, className, children }) {
  return (
    <div className={["asc-card", proposal ? "asc-card--proposal" : "", className].filter(Boolean).join(" ")}>
      {label || meta ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          {label ? <span className="asc-eyebrow">{label}</span> : null}
          <div style={{ flex: 1 }} />
          {meta ? <span style={{ color: "var(--faint)", fontSize: "var(--fs-micro)" }}>{meta}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/* -- components/display/Kbd.jsx */
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

/** Modifier → glyph, mirroring app/src/palette/CommandPalette.tsx formatShortcut(). */
const TOKEN = {
  Mod: () => (IS_MAC ? "\u2318" : "Ctrl"),
  Cmd: () => "\u2318", Meta: () => "\u2318", Ctrl: () => "Ctrl",
  Alt: () => (IS_MAC ? "\u2325" : "Alt"),
  Option: () => "\u2325",
  Shift: () => (IS_MAC ? "\u21E7" : "Shift"),
  Enter: () => "\u21B5", Return: () => "\u21B5",
  Backspace: () => "\u232B", Delete: () => "\u232B",
  Escape: () => "esc", Esc: () => "esc",
  Tab: () => "\u21E5", Space: () => "space",
  Up: () => "\u2191", Down: () => "\u2193", Left: () => "\u2190", Right: () => "\u2192",
};

/**
 * Split a stored combo into display caps. Accepts the app's keybinding syntax:
 *   "Mod+Shift+D"        → ["⌘","⇧","D"]        a chord
 *   "Mod+`, Mod+J"       → [["⌘","`"], ["⌘","J"]]  a sequence (comma-separated)
 */
function parseCombo(combo) {
  return String(combo || "")
    .split(",")
    .map((part) => part.trim()).filter(Boolean)
    .map((part) => part.split("+").map((t) => {
      const k = t.trim();
      return TOKEN[k] ? TOKEN[k]() : k;
    }));
}

/** One key cap. */
function Key({ children }) {
  return <span className="asc-key">{children}</span>;
}

/**
 * A keybinding. Pass `combo` in the app's syntax ("Mod+Shift+D") or literal
 * children. Chords render as adjacent caps; a comma-separated sequence renders
 * its groups separated by a faint "then".
 */
function Kbd({ combo, children, muted }) {
  if (!combo) return <span className={"asc-kbd" + (muted ? " muted" : "")}>{children}</span>;
  const groups = parseCombo(combo);
  return (
    <span className={"asc-kbd" + (muted ? " muted" : "")}>
      {groups.map((keys, gi) => (
        <React.Fragment key={gi}>
          {gi > 0 ? <span className="asc-kbd-then">then</span> : null}
          {keys.map((k, i) => <Key key={i}>{k}</Key>)}
        </React.Fragment>
      ))}
    </span>
  );
}

/** A labelled hint: caps followed by what they do. The status-bar / palette-footer unit. */
function KbdHint({ combo, keys, children }) {
  return (
    <span className="asc-kbd-hint">
      <Kbd combo={combo}>{keys}</Kbd>
      <span className="asc-kbd-desc">{children}</span>
    </span>
  );
}

/** A row of hints — the bottom bar and every overlay footer are built from this. */
function KbdHints({ items = [], className }) {
  return (
    <span className={["asc-kbd-hints", className].filter(Boolean).join(" ")}>
      {items.map((it) => (
        <KbdHint key={it.label} combo={it.combo} keys={it.keys}>{it.label}</KbdHint>
      ))}
    </span>
  );
}

/* -- components/display/EmptyState.jsx */
/** "Nothing here" block. The title is an uppercase eyebrow, not a heading. */
function EmptyState({ title, art, className, children }) {
  return (
    <div className={["ui-empty-block", className].filter(Boolean).join(" ")}>
      {art ? <pre className="asc-glyph" style={{ color: "var(--faint)", fontSize: "var(--fs-micro)", lineHeight: "11px" }}>{art}</pre> : null}
      {title ? <h2>{title}</h2> : null}
      {children ? <p className="ui-empty">{children}</p> : null}
    </div>
  );
}

function Loading({ children = "loading…" }) {
  return <div className="ui-loading">{children}<span className="asc-caret">_</span></div>;
}

/* -- components/display/MenuRow.jsx */
/** One row in a popover list: optional glyph, label, right-aligned shortcut. */
function MenuRow({ glyph, kbd, active, onClick, children }) {
  return (
    <div className={["asc-menurow", active ? "active" : ""].filter(Boolean).join(" ")} onClick={onClick}>
      {glyph ? <span style={{ color: "var(--faint)" }}>{glyph}</span> : null}
      <span>{children}</span>
      {kbd ? <span className="row-kbd">{kbd}</span> : null}
    </div>
  );
}

/* -- components/display/PopoverList.jsx */
/** Floating list surface: translucent, blurred, hairline-bordered. */
function PopoverList({ label, style, className, children }) {
  return (
    <div className={["asc-popover", className].filter(Boolean).join(" ")} style={{ padding: "6px 0", ...style }}>
      {label ? <div style={{ padding: "2px 12px 6px", color: "var(--faint)", fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-eyebrow)" }}>{label}</div> : null}
      {children}
    </div>
  );
}

/* -- components/display/ViewBar.jsx */
/** The 46px view header. Compose Crumb, ViewBarSpacer, then controls. */
function ViewBar({ className, children }) {
  return <div className={["viewbar", className].filter(Boolean).join(" ")}>{children}</div>;
}

/** Breadcrumb: an inverse-video eyebrow plus optional meta. */
function Crumb({ label, meta }) {
  return (
    <span className="crumb">
      <span className="asc-eyebrow">{label}</span>
      {meta ? <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{meta}</span> : null}
    </span>
  );
}

function ViewBarSpacer() { return <div className="vbar-sp" />; }

function VBtn({ active, title, onClick, children }) {
  return <button className={["vbtn", active ? "active" : ""].filter(Boolean).join(" ")} title={title} onClick={onClick}>{children}</button>;
}

/* -- components/ascii/Glyph.jsx */
/**
 * A raw character block on the grid. Every ASCII primitive renders through this,
 * so cell metrics live in exactly one place.
 */
function Glyph({ text, dense, color = "currentColor", opacity, glow, style, className }) {
  return (
    <pre className={["asc-glyph", className].filter(Boolean).join(" ")}
         style={{
           margin: 0,
           fontSize: dense ? "7px" : "var(--fs-ui)",
           lineHeight: dense ? "var(--cell-h-dense)" : "var(--cell-h)",
           color, opacity,
           textShadow: glow ? "var(--glow-accent)" : undefined,
           ...style,
         }}>{text}</pre>
  );
}

/** Deterministic noise field — the texture the graph sits in. */
function noiseField(cols, rows, density = 0.34, seed = 0x2f6e21) {
  const chars = "əɈKV9PC6WөJʌϘᴋϑЍɟϤ·:".split("");
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const out = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) line += rnd() < density ? chars[Math.floor(rnd() * chars.length)] : " ";
    out.push(line);
  }
  return out.join("\n");
}

/* -- components/ascii/AsciiTree.jsx */
/** Connector prefix for a node at `depth`, last child or not. */
function treePrefix(depth, last) {
  return depth === 0 ? (last ? "`-- " : "|-- ") : "|   ".repeat(depth) + (last ? "`-- " : "|-- ");
}

/**
 * The vault tree. Connectors are typed characters; each row carries the surface
 * glyph for its kind (▸ folder, ✎ note, ▤ base, ◈ agent, ✳ daemon).
 */
function AsciiTree({ rows = [], activeId, onSelect, className }) {
  return (
    <div className={["asc-tree", className].filter(Boolean).join(" ")}>
      {rows.map((r) => (
        <div key={r.id}
             className={["asc-tree-row", r.id === activeId ? "active" : ""].filter(Boolean).join(" ")}
             onClick={() => onSelect?.(r.id)}>
          {treePrefix(r.depth ?? 0, !!r.last)}{r.glyph ? r.glyph + " " : ""}{r.label}
          {r.meta ? "".padEnd(Math.max(1, 22 - String(r.label).length)) + r.meta : ""}
        </div>
      ))}
    </div>
  );
}

/* -- components/ascii/AsciiMeter.jsx */
/** [########..] — the system's only progress indicator. */
function AsciiMeter({ value = 0, width = 10, label, suffix, color = "var(--accent)" }) {
  const filled = Math.max(0, Math.min(width, Math.round(value * width)));
  return (
    <span className="asc-meter" style={{ color: "var(--text-muted)" }}>
      {label ? label + "  " : ""}
      [<span style={{ color }}>{"#".repeat(filled)}</span><span className="empty">{".".repeat(width - filled)}</span>]
      {suffix ? " " + suffix : ""}
    </span>
  );
}

/** A row of typed bars — the system's only chart. */
function AsciiChart({ series = [], width = 16 }) {
  const max = Math.max(...series.map((s) => s.value), 1);
  const pad = Math.max(...series.map((s) => s.label.length));
  return (
    <div style={{ fontSize: "var(--fs-micro)", lineHeight: "12px", color: "var(--text-muted)" }}>
      {series.map((s) => (
        <div key={s.label} style={{ whiteSpace: "pre" }}>
          {s.label.padEnd(pad + 1)}
          <span style={{ color: s.color ?? "var(--accent)" }}>{"#".repeat(Math.round((s.value / max) * width))}</span>
          {" ".repeat(width - Math.round((s.value / max) * width) + 1)}{s.value}
        </div>
      ))}
    </div>
  );
}

/* -- components/ascii/GraphField.jsx */
/** Bresenham line rasterized into characters: - | / \ with + at junctions. */
function rasterEdges(cols, rows, nodes, edges) {
  const grid = [];
  for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill(" "));
  const put = (x, y, ch) => { if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = ch; };
  edges.forEach(([ai, bi]) => {
    const a = nodes[ai], b = nodes[bi];
    if (!a || !b) return;
    let x = a.x, y = a.y;
    const dx = Math.abs(b.x - x), dy = Math.abs(b.y - y);
    const sx = b.x > x ? 1 : -1, sy = b.y > y ? 1 : -1;
    let err = dx - dy, guard = 0;
    while (guard++ < 2000 && !(x === b.x && y === b.y)) {
      const e2 = 2 * err;
      let mx = false, my = false;
      if (e2 > -dy) { err -= dy; x += sx; mx = true; }
      if (e2 < dx) { err += dx; y += sy; my = true; }
      put(x, y, mx && my ? (sx === sy ? "\\" : "/") : mx ? "-" : "|");
    }
  });
  nodes.forEach((n) => put(n.x, n.y, "+"));
  return grid.map((r) => r.join("")).join("\n");
}

/**
 * The knowledge graph. Three stacked character layers — noise, edges, nodes —
 * with the noise field OFF by default: it is texture, and the edges have to read first.
 * plus absolutely positioned labels. Zoom is RESOLUTION: the cell never changes
 * size, the grid subdivides.
 */
function GraphField({ cols = 110, rows = 60, nodes = [], edges = [], labels = [],
                             density = 0.34, showNoise = false, showEdges = true, style, children }) {
  return (
    <div className="asc-field" style={{ flex: 1, ...style }}>
      {showNoise ? (
        <Glyph className="noise" text={noiseField(cols, rows, density)}
               style={{ padding: "10px 0 0 8px", position: "absolute", left: 0, top: 0 }}
               color="var(--faint)" opacity={0.45} />
      ) : null}
      {showEdges ? (
        <Glyph className="edges" text={rasterEdges(cols, rows, nodes, edges)} glow
               style={{ padding: "10px 0 0 8px", position: "absolute", left: 0, top: 0 }}
               color="var(--accent)" />
      ) : null}
      {labels.map((l) => (
        <span key={l.text} className={["asc-node-label", l.active ? "active" : ""].filter(Boolean).join(" ")}
              style={{ left: l.left, top: l.top, color: l.color }}>{l.text}</span>
      ))}
      {children}
    </div>
  );
}

/* -- components/ascii/TabRail.jsx */
/** The right-hand vertical tab strip: glyphs collapsed, glyph + label open. */
function TabRail({ tabs = [], value, onChange, open = false, onToggle, className }) {
  return (
    <div className={className}
         style={{ width: open ? "var(--tabs-w-open)" : "var(--tabs-w-collapsed)",
                  flex: "none", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column",
                  padding: "12px 0", borderLeft: "1px solid var(--border)", background: "var(--rail)",
                  fontSize: "var(--fs-ui)" }}>
      <div onClick={onToggle}
           style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: open ? "space-between" : "center",
                    gap: "var(--sp-3)", padding: open ? "0 12px 8px" : "0 0 8px", color: "var(--faint)" }}>
        {open ? <span className="asc-eyebrow">OPEN {tabs.length}</span> : null}
        <span>{open ? ">>" : "<<"}</span>
      </div>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <div key={t.id} onClick={() => onChange?.(t.id)}
               style={{ position: "relative", cursor: "pointer", display: "flex", alignItems: "center",
                        justifyContent: open ? "flex-start" : "center", gap: "var(--sp-3)",
                        padding: open ? "3px 12px" : "7px 0", fontSize: open ? "var(--fs-ui)" : "14px",
                        background: active ? "var(--accent-soft)" : "transparent",
                        color: active ? "var(--fg)" : "var(--text-muted)" }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
                           background: active ? "var(--grad)" : "transparent" }} />
            <span style={{ color: open ? "var(--faint)" : "inherit" }}>{t.glyph}</span>
            {open ? <><span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}>{t.label}</span>
                      <span style={{ color: "var(--faint)" }}>x</span></> : null}
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", justifyContent: open ? "flex-start" : "center",
                    padding: open ? "6px 12px" : "6px 0", color: "var(--faint)" }}>+</div>
    </div>
  );
}

/* -- ui_kits/bismuth-app/GraphView.jsx */
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

/* -- ui_kits/bismuth-app/EditorView.jsx */
function EditorView() {
  return (
    <div style={{ flex: 1, overflow: "auto", background: "var(--editor)", padding: "26px 0" }}>
      <div style={{ maxWidth: 620, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: "var(--fs-display)", fontWeight: 600, letterSpacing: "var(--ls-display)" }}>
          The long way home
        </div>
        <MarkdownField frontmatter={{ "icon:": "(*)", "created:": "2029-09-15T07:12",
                                      "tags:": "[attention, walking, third-brain]", "brain:": "2" }}>
          I walked the long way home and let the day unspool behind me. The <span className="asc-wordmark">bismuth</span> daemon
          had already stitched the morning to <a className="asc-wikilink">[[attention as a resource]]</a> before
          I thought to. The graph remembers what I don't.
        </MarkdownField>
        <div style={{ fontSize: "var(--fs-lead)" }}><span style={{ color: "var(--accent)" }}>##</span> the quiet between entries</div>
        <div className="asc-prose">
          Three days without writing and the vault still moved. <span className="asc-tag">#walking</span> keeps
          returning to the same four nodes, which is either a habit or a thesis.
        </div>
        <div className="asc-callout">
          <span style={{ color: "var(--accent)" }}>&gt; NOTE</span>&nbsp; the quiet between entries is not emptiness —
          it is the part the agent fills in for me.
        </div>
        <div style={{ fontSize: 12, lineHeight: "var(--lh-prose)", color: "var(--text-muted)" }}>
          <div style={{ whiteSpace: "pre" }}>- [x]  re-read <span className="asc-wikilink">[[walking notes]]</span></div>
          <div style={{ whiteSpace: "pre" }}>- [x]  merge two orphan fragments</div>
          <div style={{ whiteSpace: "pre" }}>- [ ]  ask CLAUDE for a counter-argument</div>
        </div>
        <Card label="FIG. 1 — ENTRIES / WEEK">
          <div style={{ marginTop: 6 }}>
            <AsciiChart width={12} series={[
              { label: "w33", value: 3 }, { label: "w34", value: 6 },
              { label: "w35", value: 9 }, { label: "w36", value: 5 }]} />
          </div>
        </Card>
      </div>
    </div>
  );
}

/* -- ui_kits/bismuth-app/BasesView.jsx */
const ROWS = [
  { title: "The Overstory", status: "reading", rating: 4, tag: "#lichen", p: 0.7, active: true },
  { title: "Ways of Being", status: "reading", rating: 5, tag: "#attention", p: 0.4 },
  { title: "Underland", status: "to read", rating: 0, tag: "#walking", p: 0 },
  { title: "The Mushroom at the End of the World", status: "finished", rating: 4, tag: "#lichen", p: 1 },
  { title: "How to Do Nothing", status: "finished", rating: 5, tag: "#attention", p: 1 },
  { title: "Braiding Sweetgrass", status: "reading", rating: 3, tag: "#third-brain", p: 0.5 },
  { title: "Field Notes from a Catastrophe", status: "abandoned", rating: 0, tag: "#walking", p: 0.1 },
];
const COLS = "1fr 96px 78px 120px 110px";

function BasesView() {
  const [kind, setKind] = React.useState("table");
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="viewbar">
        <Crumb label="reading.base" meta="24 rows · 6 fields · sorted by status" />
        <ViewBarSpacer />
        <SegmentedToggle value={kind} onChange={setKind}
          options={[{ id: "table", label: "TABLE" }, { id: "cards", label: "CARDS" }, { id: "board", label: "BOARD" }]} />
      </div>
      <div className="asc-table" style={{ flex: 1, overflow: "auto" }}>
        <div className="thead" style={{ display: "grid", gridTemplateColumns: COLS }}>
          <div>TITLE</div><div>STATUS</div><div>RATING</div><div>TAGS</div><div>PROGRESS</div>
        </div>
        {ROWS.map((r) => (
          <div key={r.title} className={"trow" + (r.active ? " active" : "")}
               style={{ display: "grid", gridTemplateColumns: COLS }}>
            <div style={{ color: "var(--fg)" }}>{r.title}</div>
            <div><StatusText status={r.status} /></div>
            <div><Stars value={r.rating} /></div>
            <div>{r.tag}</div>
            <div><AsciiMeter value={r.p} /></div>
          </div>
        ))}
        <div style={{ padding: "12px 16px", color: "var(--faint)", fontSize: "var(--fs-micro)" }}>
          …17 more rows · filter: status != archived
        </div>
      </div>
    </div>
  );
}

/* -- ui_kits/bismuth-app/CalendarView.jsx */
const ENTRIES = {
  3: "· journal", 8: "· journal", 9: "· graphis scripta", 12: "· journal",
  14: "· walking notes", 15: "· journal", 16: "· recall 4", 19: "· journal",
  22: "· reading.base", 24: "· journal", 29: "· journal",
};

function CalendarView() {
  const [span, setSpan] = React.useState("month");
  const days = Array.from({ length: 35 }, (_, i) => {
    const n = i - 4;
    return { n: n >= 1 && n <= 30 ? n : null, e: ENTRIES[n], today: n === 15 };
  });
  const hours = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, "0") + ":00");
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="viewbar">
        <Crumb label="CALENDAR" meta={{ month: "September 2029 · 18 entries", week: "week 37 · Sep 09–15",
                                        day: "Saturday 2029-09-15 · 5 events" }[span]} />
        <ViewBarSpacer />
        <SegmentedToggle value={span} onChange={setSpan}
          options={[{ id: "month", label: "MONTH" }, { id: "week", label: "WEEK" }, { id: "day", label: "DAY" }]} />
      </div>
      {span === "month" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: "1px solid var(--border)",
                        fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-eyebrow)", color: "var(--faint)" }}>
            {["MON","TUE","WED","THU","FRI","SAT","SUN"].map((d) => <div key={d} style={{ padding: "6px 8px" }}>{d}</div>)}
          </div>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(7,1fr)", gridAutoRows: "1fr" }}>
            {days.map((d, i) => (
              <div key={i} style={{ borderRight: "1px solid var(--border-soft)", borderBottom: "1px solid var(--border-soft)",
                                    padding: "5px 7px", overflow: "hidden", fontSize: "var(--fs-micro)", color: "var(--text-muted)" }}>
                <span style={{ display: "inline-block", padding: "0 3px",
                               color: d.today ? "var(--on-accent)" : d.n ? "var(--fg)" : "var(--faint)",
                               background: d.today ? "var(--accent)" : "transparent" }}>{d.n ?? ""}</span>
                <div style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{d.e ?? ""}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {hours.map((h) => (
            <div key={h} style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, padding: "0 16px",
                                  borderBottom: "1px solid var(--border-soft)", fontSize: "var(--fs-ui)",
                                  color: "var(--text-muted)", background: h === "07:00" ? "var(--accent-soft)" : "transparent" }}>
              <span style={{ width: 44, flex: "none", color: "var(--faint)" }}>{h}</span>
              <span style={{ color: "var(--faint)" }}>{h === "07:00" || h === "16:00" ? "+--" : "|"}</span>
              <span style={{ color: h === "07:00" ? "var(--accent)" : "var(--text-muted)" }}>
                {h === "07:00" ? "journal · The long way home" : h === "16:00" ? "recall · 4 cards due" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -- ui_kits/bismuth-app/ChatView.jsx */
function ChatView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="viewbar">
        <Crumb label="CLAUDE" meta="agent · context: 12 notes · 8.4k tokens" />
        <ViewBarSpacer />
        <SegmentedToggle value="chat" onChange={() => {}}
          options={[{ id: "chat", label: "CHAT" }, { id: "trace", label: "TRACE" }]} />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "18px 20px", display: "flex",
                    flexDirection: "column", gap: 16, fontSize: 12.5, lineHeight: "var(--lh-prose)" }}>
        <div style={{ color: "var(--text-muted)" }}>
          <span style={{ color: "var(--accent)" }}>&gt; </span>what have I been circling for the last three weeks?
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: "none", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "var(--fs-ui)", color: "var(--on-accent)", background: "var(--grad)" }}>@</div>
          <div className="asc-prose" style={{ fontSize: 12.5 }}>
            Four nodes account for 61% of your new edges: <a className="asc-wikilink">[[attention as a resource]]</a>,{" "}
            <a className="asc-wikilink">[[walking notes]]</a>, <a className="asc-wikilink">[[third brain]]</a>,{" "}
            <a className="asc-wikilink">[[graphis scripta]]</a>. The last one is new — it entered the vault on 09-09.
          </div>
        </div>
        <Card label="EDGE GROWTH · 21d">
          <div style={{ marginTop: 6 }}>
            <AsciiChart series={[
              { label: "attention", value: 118, color: "var(--graph-0)" },
              { label: "walking", value: 82, color: "var(--graph-1)" },
              { label: "third-brain", value: 57, color: "var(--graph-3)" },
              { label: "lichen", value: 34, color: "var(--graph-4)" }]} />
          </div>
        </Card>
        <div style={{ color: "var(--text-muted)" }}>
          <span style={{ color: "var(--accent)" }}>&gt; </span>write the counter-argument.
        </div>
        <div style={{ color: "var(--text-muted)" }}>
          drafting into <span style={{ color: "var(--accent)" }}>journal/2029-09-15 counter.md</span>
          <span className="asc-caret">_</span>
        </div>
      </div>
      <div style={{ padding: "0 20px 16px" }}>
        <SearchBar placeholder="ask about this vault" trailing={<KbdHint combo="Mod+Enter">send</KbdHint>} />
      </div>
    </div>
  );
}

/* -- ui_kits/bismuth-app/DaemonView.jsx */
// The ::inbox tab — see app/src/InboxView.tsx. Daemon-authored pages under
// .daemon/pages/, grouped due / scheduled / resolved. A list, never cards.
const DOT = { pending: "var(--text-muted)", working: "var(--accent)", done: "var(--green)",
              failed: "var(--rose)", dismissed: "var(--text-muted)" };

const PAGES = [
  { status: "pending", title: "Reply drafts", source: "cron:answer-emails", time: "2h ago", group: "due",
    body: "Three replies drafted and waiting: the Fife field trip, the lichen sample request, and a scheduling note from Perth.",
    actions: [["SEND ALL", "selected"], ["DISMISS", "unselected"]] },
  { status: "pending", title: "Vault review — week 37", source: "cron:vault-review", time: "6h ago", group: "due",
    body: "Nine notes have no inbound link after 90 days. Proposed: archive to .attic/2029-09, reversible for 30 days.",
    actions: [["ARCHIVE", "selected"], ["REVIEW", "normal"], ["DISMISS", "unselected"]] },
  { status: "working", title: "Consolidate walking notes", source: "cron:dream", time: "11h ago", group: "due",
    body: "Four fragments from the last fortnight read as one thought. Merge them into a single note under journal/?",
    actions: [["…", "selected"], ["DISMISS", "unselected"]] },
  { status: "pending", title: "Morning digest", source: "cron:dream", time: "in 7h", group: "scheduled",
    body: "What changed in the vault overnight, and what the memory layer wrote about it." },
  { status: "done", title: "Link two orphan fragments", source: "cron:dream", time: "yesterday", group: "resolved",
    body: "fragments/09-09 and fragments/09-11 both describe the same lichen script.",
    note: "Merged into [[graphis scripta]]. 2 files removed, 1 created." },
  { status: "failed", title: "Sync reading.base with Storygraph", source: "cron:answer-emails", time: "2d ago", group: "resolved",
    body: "Pull finished dates for the six books marked reading.",
    note: "Marked failed — no response from the daemon." },
];

function PageRow({ page }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 2px",
                  borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", marginTop: 5, flexShrink: 0,
                     background: DOT[page.status] }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 12.5, color: "var(--fg)" }}>{page.title}</span>
          <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{page.source}</span>
          <span style={{ marginLeft: "auto", fontSize: "var(--fs-micro)", color: "var(--faint)", whiteSpace: "nowrap" }}>{page.time}</span>
        </div>
        <div style={{ fontSize: "var(--fs-ui)", color: "var(--text-muted)", marginTop: 2,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{page.body}</div>
        {page.note ? (
          <div style={{ fontSize: "var(--fs-micro)", color: "var(--faint)", marginTop: 3,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{page.note}</div>
        ) : null}
      </div>
      {page.actions ? (
        <div style={{ display: "flex", gap: 6, flexShrink: 0, paddingTop: 1 }}>
          {page.actions.map(([label, tone]) => (
            <Button key={label} size="sm" state={tone === "unselected" ? "unselected" : tone === "selected" ? "selected" : "normal"}>
              {label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SectionHead({ children, count, toggle }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-micro)",
                  fontWeight: 600, textTransform: "uppercase", letterSpacing: "var(--ls-eyebrow)",
                  color: "var(--text-muted)", padding: "14px 2px 5px" }}>
      {children} <span style={{ opacity: .6, fontWeight: 400 }}>{count}</span>
      {toggle ? <span style={{ marginLeft: "auto", fontSize: "var(--fs-micro)", textTransform: "none", opacity: .7 }}>{toggle}</span> : null}
    </div>
  );
}

function DaemonView() {
  const [showResolved, setShowResolved] = React.useState(true);
  const of = (g) => PAGES.filter((p) => p.group === g);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewBar>
        <Crumb label="INBOX" meta="3 need review · 1 scheduled" />
        <ViewBarSpacer />
        <span style={{ color: "var(--faint)", fontSize: "var(--fs-micro)" }}>daemon idle · last run 03:14</span>
      </ViewBar>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 16px 16px",
                    maxWidth: 760, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <SectionHead count={of("due").length}>Needs review</SectionHead>
        {of("due").map((p) => <PageRow key={p.title} page={p} />)}
        <SectionHead count={of("scheduled").length}>Scheduled</SectionHead>
        {of("scheduled").map((p) => <PageRow key={p.title} page={p} />)}
        <div onClick={() => setShowResolved((v) => !v)} style={{ cursor: "pointer" }}>
          <SectionHead count={of("resolved").length} toggle={showResolved ? "hide" : "show"}>Recently resolved</SectionHead>
        </div>
        {showResolved ? of("resolved").map((p) => <PageRow key={p.title} page={p} />) : null}
      </div>
    </div>
  );
}

/* -- ui_kits/bismuth-app/Shell.jsx */
const { useState } = React;

const TABS = [
  { id: "graph", glyph: "⁘", label: "graph" },
  { id: "editor", glyph: "✎", label: "2029-09-15 journal" },
  { id: "bases", glyph: "▤", label: "reading.base" },
  { id: "calendar", glyph: "▦", label: "calendar" },
  { id: "chat", glyph: "◈", label: "CLAUDE" },
  { id: "daemon", glyph: "✳", label: "inbox" },
];

const TREE = [
  { id: "f-journal", label: "journal/", glyph: "▸" },
  { id: "editor", label: "2029-09-15", glyph: "✎", depth: 1 },
  { id: "d14", label: "2029-09-14", glyph: "✎", depth: 1 },
  { id: "d12", label: "2029-09-12", glyph: "✎", depth: 1, last: true },
  { id: "f-bases", label: "bases/", glyph: "▸" },
  { id: "bases", label: "reading.base", glyph: "▤", depth: 1, last: true },
  { id: "f-agents", label: "agents/", glyph: "▸" },
  { id: "chat", label: "CLAUDE", glyph: "◈", depth: 1 },
  { id: "daemon", label: "inbox", glyph: "✳", depth: 1, last: true },
  { id: "f-inbox", label: "inbox/", glyph: "▸", last: true, meta: "(3)" },
];

const PATHS = {
  graph: "~/vault/.index/graph.db",
  editor: "~/vault/journal/2029-09-15.md",
  bases: "~/vault/bases/reading.base",
  calendar: "~/vault/.index/calendar",
  chat: "~/vault/agents/CLAUDE.md",
  daemon: "~/vault/.daemon/pages/",
};

function Shell() {
  const [view, setView] = useState("graph");
  const [tabsOpen, setTabsOpen] = useState(false);
  const View = { graph: GraphView, editor: EditorView, bases: BasesView,
                 calendar: CalendarView, chat: ChatView, daemon: DaemonView }[view];

  return (
    <div className="asc-app" style={{ minHeight: "100vh", display: "flex", alignItems: "flex-start",
                                                 justifyContent: "center", padding: 30, background: "var(--rail)" }}>
      <div className="asc-window">
        <div className="asc-strip">
          <span className="asc-wordmark">bismuth</span>
          <span style={{ color: "var(--faint)" }}>//</span>
          <span>~/vault</span>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 6, color: "var(--faint)" }}>
            <span>[-]</span><span>[+]</span><span>[x]</span>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "266px 1fr auto" }}>
          <div className="asc-rail">
            <div>
              <div style={{ padding: "0 12px 6px" }}><span className="asc-eyebrow">VAULT</span></div>
              <AsciiTree rows={TREE} activeId={view} onSelect={(id) => TABS.some((t) => t.id === id) && setView(id)} />
            </div>
            <div style={{ flex: 1 }} />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px 6px" }}>
                <span className="asc-eyebrow">GRAPH</span>
                <div style={{ flex: 1 }} />
                <span onClick={() => setView("graph")}
                      style={{ cursor: "pointer", color: "var(--faint)", fontSize: "var(--fs-micro)" }}>[ open ]</span>
              </div>
              <div onClick={() => setView("graph")}
                   style={{ position: "relative", margin: "0 12px", aspectRatio: "1 / 1", overflow: "hidden",
                            cursor: "pointer", border: "1px solid var(--border)", background: "var(--graph-bg)" }}>
                <MiniGraph />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <View />
          </div>

          <TabRail tabs={TABS} value={view} onChange={setView} open={tabsOpen} onToggle={() => setTabsOpen((v) => !v)} />
        </div>

        <div className="asc-statusbar">
          <span>{PATHS[view]}</span>
          <span>ln 24, col 12</span>
          <span>md · utf-8</span>
          <div style={{ flex: 1 }} />
          <span>daemon: idle</span>
          <KbdHints items={[{ combo: "Mod+O", label: "switcher" }, { combo: "Mod+K", label: "commands" }]} />
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Shell />);
