import React from "react";

/** The 46px view header. Compose Crumb, ViewBarSpacer, then controls. */
export function ViewBar({ className, children }) {
  return <div className={["viewbar", className].filter(Boolean).join(" ")}>{children}</div>;
}

/** Breadcrumb: an inverse-video eyebrow plus optional meta. */
export function Crumb({ label, meta }) {
  return (
    <span className="crumb">
      <span className="asc-eyebrow">{label}</span>
      {meta ? <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{meta}</span> : null}
    </span>
  );
}

export function ViewBarSpacer() { return <div className="vbar-sp" />; }

export function VBtn({ active, title, onClick, children }) {
  return <button className={["vbtn", active ? "active" : ""].filter(Boolean).join(" ")} title={title} onClick={onClick}>{children}</button>;
}
