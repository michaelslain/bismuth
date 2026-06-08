// DEV-only console-warning helpers for the ui/ button primitives. These wrap the
// pure lint logic in uiLint.ts behind a single, consistent message format so
// every component emits the same wording. Call sites guard these with
// `import.meta.env?.DEV` — they have zero effect in production.

import { uppercaseWarning } from "./uiLint";

/**
 * Warn that `icon` is not a Lucide icon name. Single canonical message shared by
 * IconButton / IconTextButton / TextButton (matches IconButton/SearchBar).
 */
export function warnBadIcon(component: string, icon: string): void {
  console.warn(
    `${component}: "${icon}" is not a Lucide icon name. Use a Lucide icon, not a literal glyph/emoji.`,
  );
}

/**
 * Warn that a button's children text is not all-caps (no-op if it is / non-textual).
 * `_component` is accepted for call-site symmetry with `warnBadIcon`; the message
 * text itself comes from `uppercaseWarning`.
 */
export function warnNonUppercase(_component: string, children: unknown): void {
  const w = uppercaseWarning(children);
  if (w) console.warn(w);
}
