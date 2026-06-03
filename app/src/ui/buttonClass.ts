// pure class-string composition for the ui/ button family.
//
// Buttons have two axes:
//   • kind  — "text" (a labelled button) or "icon" (a borderless icon button)
//   • state — the selection role of the button:
//       "normal"     standalone button, not part of any group (default)
//       "unselected" a member of a toggle/series that is currently OFF (de-emphasized)
//       "selected"   a member that is currently ON (accent-highlighted)
//     For icon buttons, "normal" looks like "unselected" but at full opacity.
// `danger` is an orthogonal tone (destructive actions) layered on any state.
export type ButtonKind = "text" | "icon";
export type ButtonState = "normal" | "selected" | "unselected";
export type ButtonSize = "sm" | "md" | "lg";

/** Join class-name parts, dropping falsy entries. Shared by every assembler below. */
function joinClasses(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function buttonClass(opts: {
  kind?: ButtonKind;
  state?: ButtonState;
  size?: ButtonSize;
  danger?: boolean;
  class?: string;
}): string {
  return joinClasses(
    "btn",
    `btn--${opts.kind ?? "text"}`,
    `btn--${opts.state ?? "normal"}`,
    opts.size && opts.size !== "md" ? `btn--${opts.size}` : "",
    opts.danger ? "btn--danger" : "",
    opts.class,
  );
}

export function searchBarClass(extra?: string): string {
  return joinClasses("search-bar", extra);
}

/** Inner `<input>` class for SearchBar — base class plus an optional call-site extra. */
export function searchBarInputClass(extra?: string): string {
  return joinClasses("search-bar-input", extra);
}
