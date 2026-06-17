// app/src/graph/GraphAtmosphere.tsx
// Shared graph "atmosphere": the iridescent cluster-glow + depth vignette layered over a
// WebGL graph canvas. Extracted so GraphView and the first-run intro graph share ONE source
// instead of duplicating the divs + glow-callback wiring. Render it as a sibling AFTER the
// renderer's canvas inside a positioned container; it fills that container (inset 0).
import { onMount, type JSX } from "solid-js";
import "./graphAtmosphere.css";

// Structural type: any renderer (WebGL or CSS-3D) that can push glow-lobe screen positions.
type GlowRenderer = { setGlowCallback(cb: (g: { lobes: { x: number; y: number }[] }) => void): void };

export function GraphAtmosphere(props: { renderer: GlowRenderer; mode?: string }): JSX.Element {
  let glowEl: HTMLDivElement | undefined;
  onMount(() => {
    // The renderer pushes the 3 biggest clusters' projected screen positions each frame; ride
    // the glow lobes on them so the atmosphere follows the nodes.
    props.renderer.setGlowCallback((g) => {
      if (!glowEl) return;
      g.lobes.forEach((p, i) => {
        glowEl!.style.setProperty(`--glow-x${i + 1}`, `${p.x}%`);
        glowEl!.style.setProperty(`--glow-y${i + 1}`, `${p.y}%`);
      });
    });
  });
  return (
    <>
      <div class="graph-glow" data-mode={props.mode} ref={(el) => (glowEl = el)} />
      <div class="graph-vignette" />
    </>
  );
}
