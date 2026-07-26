import React from "react";

/** [########..] — the system's only progress indicator. */
export function AsciiMeter({ value = 0, width = 10, label, suffix, color = "var(--accent)" }) {
  const filled = Math.max(0, Math.min(width, Math.round(value * width)));
  return (
    <span className="asc-meter" style={{ color: "var(--text-muted)" }}>
      {label ? label + "  " : ""}
      [<span style={{ color }}>{"#".repeat(filled)}</span><span className="empty">{".".repeat(width - filled)}</span>]
      {suffix ? " " + suffix : ""}
    </span>
  );
}

/** A row of typed bars — the system's only chart. */
export function AsciiChart({ series = [], width = 16 }) {
  const max = Math.max(...series.map((s) => s.value), 1);
  const pad = Math.max(...series.map((s) => s.label.length));
  return (
    <div style={{ fontSize: "var(--fs-micro)", lineHeight: "12px", color: "var(--text-muted)" }}>
      {series.map((s) => (
        <div key={s.label} style={{ whiteSpace: "pre" }}>
          {s.label.padEnd(pad + 1)}
          <span style={{ color: s.color ?? "var(--accent)" }}>{"#".repeat(Math.round((s.value / max) * width))}</span>
          {" ".repeat(width - Math.round((s.value / max) * width) + 1)}{s.value}
        </div>
      ))}
    </div>
  );
}
