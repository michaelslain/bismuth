// app/src/graph/GraphAtmosphere.tsx
// The graph's atmosphere: a phosphor bloom emitted by the node field, plus the depth vignette.
// Mounted as a sibling AFTER the renderer's canvas inside a positioned container; fills it (inset 0).
// Used by BOTH the STANDARD and ASCII renderer — each pushes its own per-frame node-density field.
//
// DELIBERATELY DECOUPLED FROM THE RENDERER INSTANCE. This component does NOT take a `renderer` prop
// and does not call setBloomCallback itself — it takes a stable `BloomSink` object instead. That is
// not a style preference; a `renderer` prop was tried and is a real bug magnet:
//
//   Solid compiles a bare-identifier JSX prop (`renderer={renderer}`) to a STATIC value, not a
//   getter — babel-plugin-jsx-dom-expressions only generates getters for call/member/JSX
//   expressions. GraphView.tsx's `renderer` is a `let` reassigned by a swap effect
//   (`renderer = makeRenderer(kind)`) whenever the ASCII/STANDARD setting changes — which, because
//   the client always boots on the schema default before the fetched settings can override it,
//   happens on nearly every load. A keyed <Show> that remounts this component on kind-change does
//   NOT fix it: Show evaluates its condition and re-mounts children in Solid's pure/Updates phase,
//   which runs BEFORE the swap effect (a user effect, Effects phase) reassigns `renderer` — so the
//   remount faithfully re-captures the about-to-be-destroyed instance, not the new one. Confirmed
//   against solid-js 1.9.13: static prop + keyed Show reproducibly re-captures the stale renderer;
//   only a reactive getter (or this indirection) sees the swapped-in one. It is also a RACE (depends
//   on whether the settings fetch resolves before first paint), so it can look fine in one run and
//   silently regress in the next — not something to paper over with a getter prop that still leaves
//   correctness resting on Solid's effect-ordering internals.
//
// So the caller (GraphView.tsx's mountRenderer(), VaultIntro.tsx's IntroGraph) owns wiring
// `renderer.setBloomCallback(field => sink.current?.(field))` itself, wherever it (re)assigns
// `renderer` — see those call sites. `sink` is a plain mutable object, not a signal: the point is to
// be invisible to Solid's reactivity and prop-capture timing entirely. GraphAtmosphere registers its
// paint function into `sink.current` exactly once, on mount, and every renderer instance that ever
// exists — past, present, or future — forwards through that same stable object. No remount, no
// getter, no dependency on which phase anything runs in.
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

/** A stable indirection cell the caller creates once and passes down. `sink.current` is where
 *  GraphAtmosphere's own paint function lives once mounted; every renderer.setBloomCallback the
 *  caller ever wires (across any number of ASCII<->STANDARD swaps) forwards into it. See the
 *  file-level comment for why this exists instead of a `renderer` prop. */
export interface BloomSink { current?: (field: DensityField) => void }

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

export function GraphAtmosphere(props: { sink?: BloomSink; mode?: string }): JSX.Element {
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
        // v⁴: crushes the mid-range so only genuinely dense regions light up (chosen over v²/v³
        // in an earlier sweep — v² read as fog over the whole graph; that sweep's absolute
        // numbers predate the alpha-weighted probe fix in bench/visual.ts and aren't comparable
        // to anything below, but the ORDERING isn't affected: v⁴ <= v² pointwise for every v in
        // [0,1], so it reads as less-inked under any reasonable weighting).
        //
        // Re-verified with the alpha-weighted probe after fixing the ASCII/STANDARD wiring race
        // (see this file's top comment) — three cold Vite restarts per renderer, all three
        // identical within a renderer (the race is gone), graph-bloom canvas alone:
        //   standard: 32.9% ink, 9.72 mean lum, 22.4 lum sd
        //   ascii:    27.1% ink, 10.89 mean lum, 25.3 lum sd
        // Looked at both renderings: same contained-halo character over the densest cluster, dark
        // corners in both, comparable contrast. One shared v⁴ curve judged correct for both — the
        // gap here is real but modest, not the qualitative "fog vs. phosphor" difference that
        // would justify a second curve.
        img.data[i * 4 + 3] = Math.round(255 * Math.min(1, v * v * v * v));
      }
      ctx.putImageData(img, 0, 0);
    };

    const push = (field: DensityField) => { pending = field; schedule(); };
    const sink = props.sink;
    if (sink) {
      sink.current = push;
      onCleanup(() => { if (sink.current === push) sink.current = undefined; });
    }

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
