import React from "react";

/** A label that wraps its control. Labels are lowercase chrome, never uppercase. */
export function Field({ label, hint, className, children }) {
  return (
    <label className={["ui-field", className].filter(Boolean).join(" ")}>
      <span>{label}</span>
      {children}
      {hint ? <span style={{ color: "var(--faint)", fontSize: "var(--fs-micro)" }}>{hint}</span> : null}
    </label>
  );
}
