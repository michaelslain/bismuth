// Pure dev-time lint helpers for the ui/ primitives. These encode the
// standardization rules the components enforce:
//   • TextButton labels must be UPPERCASE (the caller passes caps; no hidden
//     CSS transform — what you pass is what shows).
//   • IconButton/SearchBar icons must be Lucide names, never literal glyphs.
// The checks are pure so they can be unit-tested; the components call them
// behind an `import.meta.env.DEV` guard and emit console warnings.

/** Recursively collect the plain-string text out of a JSX children value. */
export function extractText(children: unknown): string {
  if (children == null || children === true || children === false) return "";
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractText).join("");
  // Functions / DOM nodes / components contribute no statically-knowable text.
  return "";
}

/** True when `text` contains no lowercase a–z letter (i.e. it is all-caps). */
export function isUppercaseLabel(text: string): boolean {
  return !/[a-z]/.test(text);
}

/**
 * Returns a warning string if the children's text is not all-caps, else null.
 * Empty / non-textual children (icon-only, dynamic) pass silently.
 */
export function uppercaseWarning(children: unknown): string | null {
  const text = extractText(children).trim();
  if (!text) return null;
  if (isUppercaseLabel(text)) return null;
  return `TextButton label must be UPPERCASE — got "${text}". Pass "${text.toUpperCase()}".`;
}
