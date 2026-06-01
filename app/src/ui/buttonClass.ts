// pure class-string composition for the ui/ button family.
export type ButtonVariant = "primary" | "ghost" | "danger" | "icon" | "plain";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonClass(opts: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
  class?: string;
}): string {
  return [
    "btn",
    `btn--${opts.variant ?? "primary"}`,
    opts.size && opts.size !== "md" ? `btn--${opts.size}` : "",
    opts.active ? "is-active" : "",
    opts.class ?? "",
  ].filter(Boolean).join(" ");
}

export function searchBarClass(extra?: string): string {
  return ["search-bar", extra ?? ""].filter(Boolean).join(" ");
}
