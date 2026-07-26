import React from "react";

/** Centred dialog on a dim scrim. Translucent ground + blur; 5px corners. */
export function Modal({ open = true, title, width = 520, onClose, footer, children }) {
  if (!open) return null;
  return (
    <div className="ui-overlay" onClick={onClose}>
      <div className="asc-modal" style={{ width }} onClick={(e) => e.stopPropagation()}>
        {title ? (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <span className="asc-eyebrow">{title}</span>
            <div style={{ flex: 1 }} />
            <button className="btn btn--icon btn--normal" onClick={onClose}>x</button>
          </div>
        ) : null}
        <div style={{ padding: "14px" }}>{children}</div>
        {footer ? (
          <div style={{ display: "flex", gap: "var(--sp-3)", justifyContent: "flex-end", padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
