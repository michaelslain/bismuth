import React from "react";

/** One row in a popover list: optional glyph, label, right-aligned shortcut. */
export function MenuRow({ glyph, kbd, active, onClick, children }) {
  return (
    <div className={["asc-menurow", active ? "active" : ""].filter(Boolean).join(" ")} onClick={onClick}>
      {glyph ? <span style={{ color: "var(--faint)" }}>{glyph}</span> : null}
      <span>{children}</span>
      {kbd ? <span className="row-kbd">{kbd}</span> : null}
    </div>
  );
}
