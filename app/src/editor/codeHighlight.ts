import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Syntax colors for fenced CODE blocks only. Colors come from the theme CSS vars
// (settingsCssVars.ts) so code blocks re-tint per theme instead of a fixed One Dark
// palette. CodeMirror's HighlightStyle accepts `color: "var(--x)"` (proven by the
// propertyName entry that already shipped --accent).
// Markdown structural tokens (heading, emphasis, strong, link, list, quote)
// are intentionally NOT styled here — livePreview.ts handles markdown prose.
// Plain variableName is also left unstyled so it inherits the editor foreground.
export const codeHighlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--text-muted)", fontStyle: "italic" },
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword], color: "var(--accent-purple)" },
  { tag: [t.string, t.special(t.string), t.character], color: "var(--green)" },
  { tag: [t.number, t.integer, t.float, t.bool, t.atom], color: "var(--gold)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: "var(--blue)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--gold)" },
  // Frontmatter / YAML keys (and attribute names) read in the app accent so the
  // properties block matches the Bismuth redesign (keys --accent, values --fg).
  { tag: [t.propertyName, t.attributeName], color: "var(--accent)" },
  { tag: [t.tagName], color: "var(--rose)" },
  { tag: [t.self, t.null, t.constant(t.variableName)], color: "var(--gold)" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.brace, t.angleBracket, t.squareBracket, t.paren, t.derefOperator], color: "var(--text-muted)" },
  { tag: [t.regexp, t.escape, t.special(t.character)], color: "var(--teal)" },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: "var(--text-muted)" },
  { tag: [t.invalid], color: "var(--danger)" },
]);
