// app/src/editor/autocomplete.ts
import { autocompletion, pickedCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { matchWikilinkPrefix, buildInsert, type NoteCandidate } from "./wikilink";
import { matchTagPrefix } from "./tag";
import { keySuggestions, valueSuggestions } from "../../../core/src/schema/suggest";
import { normalizeTag } from "../../../core/src/schema/coerce";
import type { Schema, PropertyType } from "../../../core/src/schema/types";

// `[[wikilink]]` completion. Inserts `[[Name]]`, cursor after the `]]` (avoids
// double `]]` when one is already ahead). `getNotes` is read lazily per popup open.
function wikilinkSource(getNotes: () => NoteCandidate[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const match = matchWikilinkPrefix(textBefore);
    if (!match) return null;

    const from = line.from + match.from;
    const options = getNotes().map((n) => ({
      label: n.label,
      detail: n.folder,
      apply(view: EditorView, completion: Completion, applyFrom: number, applyTo: number) {
        const after = view.state.doc.sliceString(applyTo, applyTo + 2);
        const { insert, cursorOffset } = buildInsert(n.label, after === "]]");
        view.dispatch({
          changes: { from: applyFrom, to: applyTo, insert },
          selection: { anchor: applyFrom + cursorOffset },
          annotations: pickedCompletion.of(completion),
        });
      },
    }));
    return { from, options, validFor: /^[^\]\n]*$/ };
  };
}

// `#tag` completion. Inserts the bare tag name after the `#`. `getTags` returns
// bare names (no leading `#`), read lazily per popup open.
function tagSource(getTags: () => string[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const match = matchTagPrefix(textBefore);
    if (!match) return null;

    const from = line.from + match.from;
    const options = getTags().map((name) => ({
      label: name,
      apply(view: EditorView, completion: Completion, applyFrom: number, applyTo: number) {
        view.dispatch({
          changes: { from: applyFrom, to: applyTo, insert: name },
          selection: { anchor: applyFrom + name.length },
          annotations: pickedCompletion.of(completion),
        });
      },
    }));
    return { from, options, validFor: /^[\w/-]*$/ };
  };
}

// A property KEY is typed at column 0 of a frontmatter line, before any ":". We only
// offer key completions while no value separator exists yet on the line.
export function matchPropertyKeyPrefix(textBefore: string): { from: number; query: string } | null {
  // Indented lines are list items / nested objects, not top-level keys.
  if (/^\s/.test(textBefore)) return null;
  if (textBefore.includes(":")) return null;
  if (!/^[\w-]*$/.test(textBefore)) return null;
  return { from: 0, query: textBefore };
}

// A `tags:` VALUE is a comma-separated list. Complete the segment after the last comma.
export function matchTagListItem(textBefore: string): { from: number; query: string } | null {
  const m = textBefore.match(/^tags:\s*(.*)$/);
  if (!m) return null;
  const valueStart = textBefore.length - m[1].length; // offset where the value text begins
  const lastComma = m[1].lastIndexOf(",");
  const segRaw = lastComma === -1 ? m[1] : m[1].slice(lastComma + 1);
  const leadWs = segRaw.length - segRaw.replace(/^\s+/, "").length;
  const from = valueStart + (lastComma === -1 ? 0 : lastComma + 1) + leadWs;
  return { from, query: segRaw.trim() };
}

// Property-key completion: offers registered keys at the start of a frontmatter line.
function propertyKeySource(getSchema: () => Schema, inFrontmatter: (ctx: CompletionContext) => boolean): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    if (!inFrontmatter(context)) return null;
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const match = matchPropertyKeyPrefix(textBefore);
    if (!match) return null;
    const from = line.from + match.from;
    const options: Completion[] = keySuggestions(getSchema(), match.query).map((name) => ({
      label: name,
      apply: name + ": ",
    }));
    if (options.length === 0) return null;
    return { from, options, validFor: /^[\w-]*$/ };
  };
}

// Enum-value completion: when the line's key is a registered enum, offer its values.
function enumValueSource(getSchema: () => Schema, inFrontmatter: (ctx: CompletionContext) => boolean): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    if (!inFrontmatter(context)) return null;
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const m = textBefore.match(/^([\w-]+):\s*(.*)$/);
    if (!m) return null;
    const entry = getSchema()[m[1]];
    if (!entry) return null;
    const type: PropertyType = entry.type;
    const valueStart = textBefore.length - m[2].length;
    const from = line.from + valueStart;
    const options: Completion[] = valueSuggestions(type, m[2].trim()).map((v) => ({ label: v }));
    if (options.length === 0) return null;
    return { from, options, validFor: /^[^,\n]*$/ };
  };
}

// Comma-aware tag-list completion inside the `tags:` value.
function tagListSource(getTags: () => string[], inFrontmatter: (ctx: CompletionContext) => boolean): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    if (!inFrontmatter(context)) return null;
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const match = matchTagListItem(textBefore);
    if (!match) return null;
    const from = line.from + match.from;
    const q = match.query.toLowerCase();
    const options: Completion[] = getTags()
      .map(normalizeTag)
      .filter((name) => name.toLowerCase().startsWith(q))
      .map((name) => ({ label: name }));
    if (options.length === 0) return null;
    return { from, options, validFor: /^[^,\n]*$/ };
  };
}

// Combined editor completion: property keys/enums/tag-lists (frontmatter) plus
// `[[wikilinks]]` and `#tags` (body) — all in ONE config. Multiple autocompletion()
// extensions would conflict, so every source lives in this single override array.
export function vaultCompletion(opts: {
  getNotes: () => NoteCandidate[];
  getTags: () => string[];
  getSchema: () => Schema;
  inFrontmatter: (ctx: CompletionContext) => boolean;
}): Extension {
  return autocompletion({
    override: [
      // frontmatter-position sources (gated by inFrontmatter)
      propertyKeySource(opts.getSchema, opts.inFrontmatter),
      enumValueSource(opts.getSchema, opts.inFrontmatter),
      tagListSource(opts.getTags, opts.inFrontmatter),
      // body-position sources (unchanged)
      wikilinkSource(opts.getNotes),
      tagSource(opts.getTags),
    ],
  });
}
