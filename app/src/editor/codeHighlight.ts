import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Syntax colors for fenced CODE blocks only (One Dark palette).
// Markdown structural tokens (heading, emphasis, strong, link, list, quote)
// are intentionally NOT styled here — livePreview.ts handles markdown prose.
// Plain variableName is also left unstyled so it inherits the editor foreground.
export const codeHighlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#7f848e", fontStyle: "italic" },
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword], color: "#c678dd" },
  { tag: [t.string, t.special(t.string), t.character], color: "#98c379" },
  { tag: [t.number, t.integer, t.float, t.bool, t.atom], color: "#d19a66" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: "#61afef" },
  { tag: [t.typeName, t.className, t.namespace], color: "#e5c07b" },
  // Frontmatter / YAML keys (and attribute names) read in the app accent so the
  // properties block matches the Bismuth redesign (keys --accent, values --fg).
  { tag: [t.propertyName, t.attributeName], color: "var(--accent)" },
  { tag: [t.tagName], color: "#e06c75" },
  { tag: [t.self, t.null, t.constant(t.variableName)], color: "#d19a66" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.brace, t.angleBracket, t.squareBracket, t.paren, t.derefOperator], color: "#abb2bf" },
  { tag: [t.regexp, t.escape, t.special(t.character)], color: "#56b6c2" },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: "#7f848e" },
  { tag: [t.invalid], color: "#e06c75" },
]);
