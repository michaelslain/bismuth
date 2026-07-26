import React from "react";
import { Button } from "./Button";

/**
 * A row of mutually exclusive buttons sharing one rule — the canonical
 * selected/unselected consumer (graph 2D/3D, calendar span, base view kind).
 */
export function SegmentedToggle({ options, value, onChange, size, className }) {
  return (
    <div className={["segmented", className].filter(Boolean).join(" ")}>
      {options.map((opt) => (
        <Button key={String(opt.id)} size={size} title={opt.title}
                state={opt.id === value ? "selected" : "unselected"}
                onClick={() => onChange(opt.id)}>
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
