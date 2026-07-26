// app/src/ui/ascii/noiseField.ts
// Deterministic seeded texture for the ASCII field backdrop (Glyph draws it,
// GraphField layers edges over it). Pure — no Math.random at render time, so
// a given (cols, rows, density, seed) always rasterizes to the same string.
//
// Plain-ASCII glyph vocabulary only (no box-drawing / non-ASCII look-alikes):
// the same set the tree/meter/graph primitives draw with (design-system
// tokens/ascii.css).
const NOISE_CHARS = ["|", "-", "+", "/", "\\", "`", "_", "#", ".", "o", "@"];

/** Default seed — keep renders stable across the app unless a caller varies it. */
export const DEFAULT_NOISE_SEED = 0x2f6e21;

/**
 * Rasterize a `cols` × `rows` block of sparse noise glyphs, `\n`-joined.
 * `density` (0–1) is the fraction of cells that get a glyph instead of a space.
 * Same seed + args → byte-identical output, every time.
 */
export function noiseField(cols: number, rows: number, density = 0.34, seed = DEFAULT_NOISE_SEED): string {
  let s = seed;
  // Tiny LCG — deterministic, no external dependency.
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };

  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      line += rnd() < density ? NOISE_CHARS[Math.floor(rnd() * NOISE_CHARS.length)] : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
