// app/src/graph/GraphAtmosphere.tsx
// Shared graph "atmosphere": the iridescent cluster-glow + depth vignette layered over a graph
// canvas. Its sole consumer today is the first-run Vault Intro (app/src/intro/VaultIntro.tsx) —
// the shipped ASCII GraphView draws a flat field and renders no atmosphere. Kept as its own
// component so the intro's glow-callback wiring stays in one place rather than inlined there.
// Render it as a sibling AFTER the renderer's canvas inside a positioned container; it fills
// that container (inset 0).
import { onMount, type JSX } from "solid-js";
import "./graphAtmosphere.css";

// Structural type: any renderer (Canvas-2D or CSS-3D) that can push glow-lobe screen positions.
type GlowRenderer = { setGlowCallback(cb: (g: { lobes: { x: number; y: number }[] }) => void): void };

export function GraphAtmosphere(props: { renderer: GlowRenderer }): JSX.Element {
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
      <div class="graph-glow" ref={(el) => (glowEl = el)} />
      <div class="graph-vignette" />
    </>
  );
}
