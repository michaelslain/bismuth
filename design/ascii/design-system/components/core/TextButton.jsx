import React from "react";
import { Button } from "./Button";

/** A borderless label button — inline affordances like "[ open ]" in a panel header. */
export function TextButton({ children, ...rest }) {
  return <Button {...rest} className={["btn--bare", rest.className].filter(Boolean).join(" ")}>{children}</Button>;
}
