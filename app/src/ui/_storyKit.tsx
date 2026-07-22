// Shared layout helpers for the `app/src/ui/*.stories.tsx` visual specs (dev-only,
// Storybook). NOT a story file itself — the `*.stories.*` glob (see `.storybook/main.ts`)
// skips it, so it has no default export. Centralizes the uppercase section-label style
// and the labeled Row wrapper that several stories otherwise copied inline.
import type { JSX } from "solid-js";

/** The uppercase caption style shared by every story's section labels. */
export const labelStyle = {
  "font-family": "var(--ui-font-stack)",
  "font-size": "11px",
  color: "var(--text-muted)",
  "text-transform": "uppercase",
  "letter-spacing": "0.05em",
} as const;

/** A small uppercase caption above a story group. */
export function Label(props: { children: JSX.Element }) {
  return <span style={labelStyle}>{props.children}</span>;
}

/**
 * A labeled column: an optional uppercase caption above a flex container of children.
 * `gap` (default 14px) sizes the inner container; `wrap` (default true) toggles
 * `flex-wrap: wrap`; `column` stacks the children vertically (and drops the wrap/align).
 */
export function Row(props: {
  label?: string;
  children: JSX.Element;
  gap?: string;
  wrap?: boolean;
  column?: boolean;
}) {
  const gap = () => props.gap ?? "14px";
  const wrap = () => props.wrap ?? true;
  const inner = (): JSX.CSSProperties =>
    props.column
      ? { display: "flex", "flex-direction": "column", gap: gap() }
      : wrap()
        ? { display: "flex", "align-items": "center", gap: gap(), "flex-wrap": "wrap" }
        : { display: "flex", "align-items": "center", gap: gap() };
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
      {props.label && <Label>{props.label}</Label>}
      <div style={inner()}>{props.children}</div>
    </div>
  );
}
