// app/src/ui/ascii/noiseField.ts
// Deterministic seeded PRNG noise field — the texture layer the ASCII knowledge
// graph sits in (GraphField.tsx). No Math.random() at render: the same
// cols/rows/density/seed always produce byte-identical output.
//
// Ported from design/ascii/design-system/components/ascii/Glyph.jsx — supporting
// dependency of GraphField (component 4); the canonical `Glyph`/`noiseField`
// port is component 1's deliverable and this should be reconciled/deduped
// against it at merge time.

const NOISE_CHARS = "əɈKV9PC6WөJʌϘᴋϑЍɟϤ·:".split("");
const DEFAULT_SEED = 0x2f6e21;

/**
 * Build a `cols`×`rows` grid of noise characters, newline-joined per row.
 * `density` (default 0.34) is the per-cell probability of a glyph instead of
 * a space; `seed` (default 0x2f6e21) drives a linear-congruential PRNG, so
 * the same inputs always render the same field.
 */
export function noiseField(cols: number, rows: number, density = 0.34, seed = DEFAULT_SEED): string {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      line += rnd() < density ? NOISE_CHARS[Math.floor(rnd() * NOISE_CHARS.length)] : " ";
    }
    out.push(line);
  }
  return out.join("\n");
}
