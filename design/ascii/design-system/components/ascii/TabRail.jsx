import React from "react";

/** The right-hand vertical tab strip: glyphs collapsed, glyph + label open. */
export function TabRail({ tabs = [], value, onChange, open = false, onToggle, className }) {
  return (
    <div className={className}
         style={{ width: open ? "var(--tabs-w-open)" : "var(--tabs-w-collapsed)",
                  flex: "none", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column",
                  padding: "12px 0", borderLeft: "1px solid var(--border)", background: "var(--rail)",
                  fontSize: "var(--fs-ui)" }}>
      <div onClick={onToggle}
           style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: open ? "space-between" : "center",
                    gap: "var(--sp-3)", padding: open ? "0 12px 8px" : "0 0 8px", color: "var(--faint)" }}>
        {open ? <span className="asc-eyebrow">OPEN {tabs.length}</span> : null}
        <span>{open ? ">>" : "<<"}</span>
      </div>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <div key={t.id} onClick={() => onChange?.(t.id)}
               style={{ position: "relative", cursor: "pointer", display: "flex", alignItems: "center",
                        justifyContent: open ? "flex-start" : "center", gap: "var(--sp-3)",
                        padding: open ? "3px 12px" : "7px 0", fontSize: open ? "var(--fs-ui)" : "14px",
                        background: active ? "var(--accent-soft)" : "transparent",
                        color: active ? "var(--fg)" : "var(--text-muted)" }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
                           background: active ? "var(--grad)" : "transparent" }} />
            <span style={{ color: open ? "var(--faint)" : "inherit" }}>{t.glyph}</span>
            {open ? <><span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}>{t.label}</span>
                      <span style={{ color: "var(--faint)" }}>x</span></> : null}
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", justifyContent: open ? "flex-start" : "center",
                    padding: open ? "6px 12px" : "6px 0", color: "var(--faint)" }}>+</div>
    </div>
  );
}
