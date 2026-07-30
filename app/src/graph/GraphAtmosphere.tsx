// app/src/graph/GraphAtmosphere.tsx
// The graph's atmosphere: a phosphor bloom emitted by the node field, plus the depth vignette.
// Mounted as a sibling AFTER the renderer's canvas inside a positioned container; fills it (inset 0).
// Used by BOTH the STANDARD and ASCII renderer — each pushes its own per-frame node-density field
// via setBloomCallback (CanvasGraphRenderer.emitBloom / AsciiGraphRenderer.emitBloom).
//
// The bloom is drawn at FIELD_W×FIELD_H and scaled up by the browser's own smoothing, which is
// both cheap and exactly the soft falloff we want.
//
// Colour is theme-derived, never hardcoded in a renderer: an explicit --bloom-rgb custom property
// (a "r, g, b" triple, e.g. from a future per-theme override) wins if it parses; otherwise the
// active theme's --accent (a hex colour — see settingsCssVars.ts) is parsed and used; otherwise a
// literal CRT-phosphor teal is the last resort, for the rare case neither resolves (stylesheet not
// yet loaded). See bloomColor.ts for the pure, unit-tested parsers — malformed input from either
// property falls back rather than producing a NaN channel (which paints invisible black).
//
// Bismuth themes are switchable LIVE (App.tsx re-applies `settingsToCssVars` on every settings
// change, via `documentElement.style.setProperty`), so the colour can't just be read once at
// mount: a MutationObserver watches `document.documentElement`'s `style` attribute and re-resolves
// on change. That only fires on an actual theme switch, never per frame — getComputedStyle has no
// business being on the rAF path.
import { onCleanup, onMount, type JSX } from "solid-js";
import { FIELD_W, FIELD_H, type DensityField } from "./densityField";
import { parseHexColor, parseRgbTriple, type Rgb } from "./bloomColor";
import "./graphAtmosphere.css";

type BloomRenderer = { setBloomCallback?(cb: (field: DensityField) => void): void };

/** CRT-phosphor teal — used only if neither an explicit --bloom-rgb nor a themed --accent
 *  resolves. Not a hue choice; a last-resort default for a broken/absent stylesheet. */
const FALLBACK_RGB: Rgb = [150, 230, 216];

/** Explicit --bloom-rgb wins if it parses; else the active theme's --accent (hex); else
 *  FALLBACK_RGB. Reads computed style on `el` — caller controls when this runs (mount + theme
 *  switch only, never per frame). */
function resolveBloomRgb(el: Element): Rgb {
  const style = getComputedStyle(el);
  const override = parseRgbTriple(style.getPropertyValue("--bloom-rgb"));
  if (override) return override;
  const accent = parseHexColor(style.getPropertyValue("--accent"));
  if (accent) return accent;
  return FALLBACK_RGB;
}

export function GraphAtmosphere(props: { renderer: BloomRenderer; mode?: string }): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let raf = 0;
  let pending: DensityField | null = null;

  onMount(() => {
    const ctx = canvas?.getContext("2d") ?? null;
    if (!canvas || !ctx) return;
    canvas.width = FIELD_W;
    canvas.height = FIELD_H;

    let [r, g, b] = resolveBloomRgb(canvas);
    const img = ctx.createImageData(FIELD_W, FIELD_H);

    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };

    const paint = () => {
      raf = 0;
      const field = pending;
      if (!field) return;
      for (let i = 0; i < FIELD_W * FIELD_H; i++) {
        const v = field[i];
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = b;
        // v⁴: crushes the mid-range so only genuinely dense regions light up. Measured (Canvas
        // renderer, sandbox vault, --shot graph-3d, opacity fixed at 0.85, graph-bloom canvas):
        //   v²  (shipped originally): 68.6% ink, 149.7 mean lum — a fog over the whole graph,
        //       washing out the densest cluster (the most structurally interesting region ending
        //       up the LEAST readable — backwards).
        //   v³:  55.7% ink, 120.6 mean lum.
        //   v⁴:  50.0% ink, 110.2 mean lum — reads as phosphor (contained glow on the dense core,
        //       clusters legible again), not fog. Chosen.
        img.data[i * 4 + 3] = Math.round(255 * Math.min(1, v * v * v * v));
      }
      ctx.putImageData(img, 0, 0);
    };

    props.renderer.setBloomCallback?.((field) => {
      pending = field;
      schedule();
    });

    const mo = new MutationObserver(() => {
      const next = resolveBloomRgb(canvas!);
      if (next[0] !== r || next[1] !== g || next[2] !== b) {
        [r, g, b] = next;
        schedule(); // repaint the last field under the new colour even if none arrives this frame
      }
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    onCleanup(() => mo.disconnect());
  });

  onCleanup(() => { if (raf) cancelAnimationFrame(raf); });

  return (
    <>
      <canvas class="graph-bloom" data-mode={props.mode} ref={(el) => (canvas = el)} />
      <div class="graph-vignette" />
    </>
  );
}
