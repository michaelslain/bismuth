import React from "react";

/** Hairline surface card. `proposal` adds the 2px accent left edge. */
export function Card({ label, meta, proposal, className, children }) {
  return (
    <div className={["asc-card", proposal ? "asc-card--proposal" : "", className].filter(Boolean).join(" ")}>
      {label || meta ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          {label ? <span className="asc-eyebrow">{label}</span> : null}
          <div style={{ flex: 1 }} />
          {meta ? <span style={{ color: "var(--faint)", fontSize: "var(--fs-micro)" }}>{meta}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
