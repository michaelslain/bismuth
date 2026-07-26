// app/src/ui/ascii/Glyph.tsx
// A raw character block on the grid — the base every ASCII primitive renders
// through, so cell metrics (font size, line height) live in exactly one
// place. Ported from design/ascii/design-system/components/ascii/Glyph.jsx.
//
// Supporting dependency of GraphField (component 4); the canonical `Glyph`
// port is component 1's deliverable and this should be reconciled/deduped
// against it at merge time.
import type { JSX } from "solid-js";

export interface GlyphProps {
  text: string;
  /** Switch to the 7px cell used by dense fields (e.g. a 1000-node graph). */
  dense?: boolean;
  color?: string;
  opacity?: number;
  /** Apply --glow-accent (only visible in the Cathode scope). */
  glow?: boolean;
  style?: JSX.CSSProperties;
  class?: string;
}

export function Glyph(props: GlyphProps): JSX.Element {
  return (
    <pre
      class={props.class ? `asc-glyph ${props.class}` : "asc-glyph"}
      style={{
        margin: 0,
        "font-size": props.dense ? "7px" : "var(--fs-ui)",
        "line-height": props.dense ? "var(--cell-h-dense)" : "var(--cell-h)",
        "letter-spacing": "0",
        color: props.color ?? "currentColor",
        opacity: props.opacity,
        "text-shadow": props.glow ? "var(--glow-accent)" : undefined,
        ...props.style,
      }}
    >
      {props.text}
    </pre>
  );
}
