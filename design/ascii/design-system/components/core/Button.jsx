import React from "react";

/** Class-string composition mirroring app/src/ui/buttonClass.ts. */
export function buttonClass({ kind = "text", state = "normal", size = "md", danger, primary, className }) {
  return [
    "btn",
    `btn--${kind}`,
    `btn--${state}`,
    size && size !== "md" ? `btn--${size}` : "",
    primary ? "btn--primary" : "",
    danger ? "btn--danger" : "",
    className,
  ].filter(Boolean).join(" ");
}

/**
 * The bracketed action button. Labels are lowercase inside brackets for in-content
 * actions ("[ accept ]") and UPPERCASE bare for chrome segments ("MONTH").
 */
export function Button({ kind = "text", state = "normal", size = "md", danger, primary,
                         bracket = false, disabled, title, onClick, className, children }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
            className={buttonClass({ kind, state, size, danger, primary, className })}>
      {bracket ? <>[&nbsp;{children}&nbsp;]</> : children}
    </button>
  );
}
