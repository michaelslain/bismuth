import React from "react";

/** Floating list surface: translucent, blurred, hairline-bordered. */
export function PopoverList({ label, style, className, children }) {
  return (
    <div className={["asc-popover", className].filter(Boolean).join(" ")} style={{ padding: "6px 0", ...style }}>
      {label ? <div style={{ padding: "2px 12px 6px", color: "var(--faint)", fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-eyebrow)" }}>{label}</div> : null}
      {children}
    </div>
  );
}
