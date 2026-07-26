import React from "react";

/**
 * A raw character block on the grid. Every ASCII primitive renders through this,
 * so cell metrics live in exactly one place.
 */
export function Glyph({ text, dense, color = "currentColor", opacity, glow, style, className }) {
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
export function noiseField(cols, rows, density = 0.34, seed = 0x2f6e21) {
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
