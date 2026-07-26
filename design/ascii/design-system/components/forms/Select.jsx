import React, { useState } from "react";
import { PopoverList } from "../display/PopoverList";
import { MenuRow } from "../display/MenuRow";

/** A trigger styled as an input, with an ASCII caret and a popover list. */
export function Select({ options = [], value, placeholder = "select…", onChange, className }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  return (
    <div style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
              className={["ui-input", "ui-select-trigger", className].filter(Boolean).join(" ")}>
        <span className={current ? "" : "ui-select-placeholder"} style={current ? null : { color: "var(--faint)" }}>
          {current ? current.label : placeholder}
        </span>
        <span className="ui-select-caret">{open ? "^" : "v"}</span>
      </button>
      {open ? (
        <PopoverList style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", zIndex: 1100 }}>
          {options.map((o) => (
            <MenuRow key={String(o.id)} active={o.id === value}
                     onClick={() => { onChange?.(o.id); setOpen(false); }}>
              {o.label}
            </MenuRow>
          ))}
        </PopoverList>
      ) : null}
    </div>
  );
}
