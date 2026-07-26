import React from "react";

/** Single-line or multiline text entry. Focus is an accent border + soft ring. */
export function TextInput({ multiline, value, placeholder, onChange, className, ...rest }) {
  const cls = ["ui-input", className].filter(Boolean).join(" ");
  return multiline
    ? <textarea className={cls} value={value} placeholder={placeholder}
                onChange={(e) => onChange?.(e.target.value)} {...rest} />
    : <input className={cls} value={value} placeholder={placeholder}
             onChange={(e) => onChange?.(e.target.value)} {...rest} />;
}
