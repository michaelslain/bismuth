import React from "react";

/** A typed rating: filled stars in gold, empty in faint. */
export function Stars({ value = 0, max = 5 }) {
  return (
    <span className="stars">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? "star-on" : undefined}>{i < value ? "*" : "."}</span>
      ))}
    </span>
  );
}
