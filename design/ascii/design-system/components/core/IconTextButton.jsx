import React from "react";
import { buttonClass } from "./Button";

/** Glyph + label, in that order, on one cell of gap. */
export function IconTextButton({ glyph, state = "normal", size, danger, title, onClick, className, children }) {
  return (
    <button type="button" title={title} onClick={onClick}
            className={buttonClass({ kind: "text", state, size, danger, className })}>
      <span className="btn-glyph">{glyph}</span>
      <span className="btn-label">{children}</span>
    </button>
  );
}
