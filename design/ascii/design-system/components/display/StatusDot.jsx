import React from "react";

/** The category palette for statuses — mirrors app/src/ui/StatusDot.tsx. */
export const STATUS_COLOR = {
  reading: "var(--teal)",
  "to read": "var(--blue)",
  toread: "var(--blue)",
  finished: "var(--green)",
  done: "var(--green)",
  complete: "var(--green)",
  abandoned: "var(--rose)",
  dropped: "var(--rose)",
};

export function statusColor(s) {
  return STATUS_COLOR[String(s).trim().toLowerCase()] ?? "var(--faint)";
}

/** Just the dot. */
export function StatusDot({ color, status }) {
  return <span className="status-dot" style={{ background: color ?? (status ? statusColor(status) : "var(--faint)") }} />;
}

/** Dot + word, both tinted to the status color. */
export function StatusText({ status }) {
  return (
    <span className="status-text" style={{ color: statusColor(status) }}>
      <span className="status-dot" />{status}
    </span>
  );
}
