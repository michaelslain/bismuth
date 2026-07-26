import React from "react";

/** Search entry. The lead is a typed prompt character, not a magnifier icon. */
export function SearchBar({ value, placeholder = "search vault", lead = ">", onChange, trailing, className }) {
  return (
    <div className={["search-bar", className].filter(Boolean).join(" ")}>
      <span className="search-bar-lead">{lead}</span>
      <input className="search-bar-input" value={value} placeholder={placeholder}
             onChange={(e) => onChange?.(e.target.value)} />
      {trailing}
    </div>
  );
}
