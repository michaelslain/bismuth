import React from "react";

/** "Nothing here" block. The title is an uppercase eyebrow, not a heading. */
export function EmptyState({ title, art, className, children }) {
  return (
    <div className={["ui-empty-block", className].filter(Boolean).join(" ")}>
      {art ? <pre className="asc-glyph" style={{ color: "var(--faint)", fontSize: "var(--fs-micro)", lineHeight: "11px" }}>{art}</pre> : null}
      {title ? <h2>{title}</h2> : null}
      {children ? <p className="ui-empty">{children}</p> : null}
    </div>
  );
}

export function Loading({ children = "loading…" }) {
  return <div className="ui-loading">{children}<span className="asc-caret">_</span></div>;
}
