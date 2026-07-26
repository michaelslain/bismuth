import React from "react";
import { buttonClass } from "./Button";

/** A glyph-only button: window controls, tab-rail entries, row affordances. */
export function IconButton({ glyph, state = "normal", danger, title, onClick, className, children }) {
  return (
    <button type="button" title={title} onClick={onClick}
            className={buttonClass({ kind: "icon", state, danger, className })}>
      {glyph ?? children}
    </button>
  );
}
