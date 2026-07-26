import React from "react";

/** A selectable pill. `tone` tints the SELECTED state to a category hue. */
export function Chip({ tone = "accent", selected, glyph, title, onClick, className, children }) {
  return (
    <button type="button" title={title} onClick={onClick}
            className={["chip-toggle", `tone-${tone}`, selected ? "selected" : "", className].filter(Boolean).join(" ")}>
      {glyph ? <span>{glyph}</span> : null}
      {children}
    </button>
  );
}
