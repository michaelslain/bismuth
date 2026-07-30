// app/src/graph/GraphAtmosphere.tsx
// The graph's atmosphere: a phosphor bloom emitted by the node field, plus the depth vignette.
// Mounted as a sibling AFTER the renderer's canvas inside a positioned container; fills it (inset 0).
//
// The bloom is drawn at FIELD_W×FIELD_H and scaled up by the browser's own smoothing, which is
// both cheap and exactly the soft falloff we want. Colour comes from --bloom-hue (theme token), so
// nothing here hardcodes a palette.
import { onCleanup, onMount, type JSX } from "solid-js";
import { FIELD_W, FIELD_H, type DensityField } from "./densityField";
import "./graphAtmosphere.css";

type BloomRenderer = { setBloomCallback?(cb: (field: DensityField) => void): void };

export function GraphAtmosphere(props: { renderer: BloomRenderer; mode?: string }): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let raf = 0;
  let pending: DensityField | null = null;

  onMount(() => {
    const ctx = canvas?.getContext("2d") ?? null;
    if (!canvas || !ctx) return;
    canvas.width = FIELD_W;
    canvas.height = FIELD_H;

    const hue = getComputedStyle(canvas).getPropertyValue("--bloom-rgb").trim() || "150, 230, 216";
    const img = ctx.createImageData(FIELD_W, FIELD_H);
    const [r, g, b] = hue.split(",").map((n) => Number(n.trim()));

    const paint = () => {
      raf = 0;
      const field = pending;
      if (!field) return;
      for (let i = 0; i < FIELD_W * FIELD_H; i++) {
        const v = field[i];
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = b;
        // Gamma-ish curve: keeps the faint tail faint so only genuinely dense regions glow.
        img.data[i * 4 + 3] = Math.round(255 * Math.min(1, v * v));
      }
      ctx.putImageData(img, 0, 0);
    };

    props.renderer.setBloomCallback?.((field) => {
      pending = field;
      if (!raf) raf = requestAnimationFrame(paint);
    });
  });

  onCleanup(() => { if (raf) cancelAnimationFrame(raf); });

  return (
    <>
      <canvas class="graph-bloom" data-mode={props.mode} ref={(el) => (canvas = el)} />
      <div class="graph-vignette" />
    </>
  );
}
