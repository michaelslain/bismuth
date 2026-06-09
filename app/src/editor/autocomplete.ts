// app/src/editor/autocomplete.ts
import { autocompletion, pickedCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { completionDisplayConfig, type IconedCompletion } from "./completionDisplay";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { matchWikilinkPrefix, buildInsert, type NoteCandidate } from "./wikilink";
import { matchTagPrefix } from "./tag";
import { matchEmojiPrefix, searchEmoji } from "./emoji";
import { keySuggestions, valueSuggestions } from "../../../core/src/schema/suggest";
import { normalizeTag } from "../../../core/src/schema/coerce";
import type { Schema, PropertyType } from "../../../core/src/schema/types";
import { matchTemplateTokenPrefix } from "./templateToken";
import { TEMPLATE_TOKENS } from "../../../core/src/templates";
import { querySource } from "./queryComplete";
import { taskSource } from "./taskComplete";
import { slashSource } from "./slashComplete";

// Shared insert for every completion source: replace [from,to) with `insert`, put the
// cursor `cursorOffset` chars past `from`, and tag the change as a picked completion so
// CM's bookkeeping (closing the popup, etc.) stays correct. One place, not copy-pasted.
function applyInsert(
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
  insert: string,
  cursorOffset: number,
) {
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + cursorOffset },
    annotations: pickedCompletion.of(completion),
  });
}

// Shared shape for the prefix-triggered body sources (wikilink, tag): extract the
// text before the caret, match a trigger prefix, map items to options, and return a
// result anchored at `from` with a `validFor` re-query pattern. Only the trigger
// match, the per-popup item list, and how each item maps to an option differ.
function prefixSource<T>(opts: {
  match: (textBefore: string) => { from: number } | null;
  items: () => T[];
  toOption: (item: T) => Completion;
  validFor: RegExp;
}): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const match = opts.match(textBefore);
    if (!match) return null;

    const from = line.from + match.from;
    const options = opts.items().map(opts.toOption);
    return { from, options, validFor: opts.validFor };
  };
}

// `[[wikilink]]` completion. Inserts `[[Name]]`, cursor after the `]]` (avoids
// double `]]` when one is already ahead). `getNotes` is read lazily per popup open.
function wikilinkSource(getNotes: () => NoteCandidate[]): CompletionSource {
  return prefixSource<NoteCandidate>({
    match: matchWikilinkPrefix,
    items: getNotes,
    toOption: (n) => ({
      label: n.label,
      detail: n.folder,
      apply(view: EditorView, completion: Completion, applyFrom: number, applyTo: number) {
        const after = view.state.doc.sliceString(applyTo, applyTo + 2);
        const { insert, cursorOffset } = buildInsert(n.label, after === "]]");
        applyInsert(view, completion, applyFrom, applyTo, insert, cursorOffset);
      },
    }),
    validFor: /^[^\]\n]*$/,
  });
}

// `#tag` completion. Inserts the bare tag name after the `#`. `getTags` returns
// bare names (no leading `#`), read lazily per popup open.
function tagSource(getTags: () => string[]): CompletionSource {
  return prefixSource<string>({
    match: matchTagPrefix,
    items: getTags,
    toOption: (name) => ({
      label: name,
      apply(view: EditorView, completion: Completion, applyFrom: number, applyTo: number) {
        applyInsert(view, completion, applyFrom, applyTo, name, name.length);
      },
    }),
    validFor: /^[\w/-]*$/,
  });
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

// An `icon:` VALUE. Complete the (single) icon name after the colon. Returns the
// prefix typed so far so the source can filter Lucide names by it.
export function matchIconValue(textBefore: string): { from: number; query: string } | null {
  const m = textBefore.match(/^icon:\s*(.*)$/);
  if (!m) return null;
  const valueStart = textBefore.length - m[1].length;
  return { from: valueStart, query: m[1].trim() };
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

// Icon-name completion for the `icon:` property value. Lucide names are supplied
// by the caller (getIconNames) so this module stays free of the lucide import
// (which can't be loaded outside a DOM). Emoji are still allowed — this only
// *suggests* Lucide names; it never blocks other input.
function iconValueSource(getIconNames: () => string[], inFrontmatter: (ctx: CompletionContext) => boolean): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    if (!inFrontmatter(context)) return null;
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const match = matchIconValue(textBefore);
    if (!match) return null;
    const from = line.from + match.from;
    const q = match.query.toLowerCase();
    // Prefix match first, then substring — keeps the most likely names on top.
    const names = getIconNames();
    const ranked = q
      ? names.filter((n) => n.toLowerCase().startsWith(q)).concat(names.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q)))
      : names;
    const options: Completion[] = ranked.slice(0, 50).map((name) => ({ label: name, type: "keyword" }));
    if (options.length === 0) return null;
    return { from, options, validFor: /^[^\n]*$/ };
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

// `{{template token}}` completion. Fires anywhere the caret sits inside an open `{{`
// (body OR frontmatter — intentionally UNgated), offering the known tokens. Selecting
// one replaces the `{{…` prefix with the full token. Because it only matches an open
// `{{`, it never collides with the property/enum/tag/wikilink sources.
function templateTokenSource(): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const match = matchTemplateTokenPrefix(textBefore);
    if (!match) return null;
    const from = line.from + match.from;
    const options: Completion[] = TEMPLATE_TOKENS.map((t) => ({
      label: t.token,
      info: t.doc,
      apply(view: EditorView, completion: Completion, applyFrom: number, applyTo: number) {
        applyInsert(view, completion, applyFrom, applyTo, t.token, t.token.length);
      },
    }));
    return { from, options, validFor: /^\{\{[\w+:-]*$/ };
  };
}

// `:emoji:` and special-character completion, sharing the same popup as wikilinks and
// tags. CM's built-in filter only matches the option label, which would drop keyword
// hits (`:happy` → 😄), so we set `filter: false`, rank ourselves, and re-query each
// keystroke (no `validFor`). `apply` inserts the raw glyph, replacing the `:query[:]`.
// The dataset is a generated, committed JSON artifact (see scripts/gen-emoji.ts).
function emojiSource(): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    // Inside an open `[[wikilink`, let the wikilink source own the popup — wikilink names
    // can contain spaces, so the emoji rule (`:` after whitespace) would otherwise
    // double-fire and mix note + emoji suggestions in one list.
    if (matchWikilinkPrefix(textBefore)) return null;
    const match = matchEmojiPrefix(textBefore);
    if (!match) return null;

    const from = line.from + match.from;
    const to = line.from + match.to;
    // "Open emoji gallery" — always first, even when no emoji matches the query, so the
    // grid is one click away. Picking from it replaces the same `:query[:]` range. The
    // gallery + sources are dynamically imported (keeps lucide-solid out of this module's
    // static graph). The body `:` gallery shows emoji ONLY (icons stay for icon fields).
    const gallery: IconedCompletion = {
      label: "Open emoji gallery",
      type: "gallery",
      lucideIcon: "Grip",
      apply(view: EditorView, completion: Completion, applyFrom: number, applyTo: number) {
        void Promise.all([import("../ui/gallery/galleryStore"), import("../ui/gallery/sources")])
          .then(([{ openGallery }, sources]) => openGallery({ source: sources.emojiSource }))
          .then((char) => {
            if (char) applyInsert(view, completion, applyFrom, applyTo, char, char.length);
            view.focus();
          })
          .catch((err) => console.error("Failed to open emoji gallery", err));
      },
    };
    const emoji: Completion[] = searchEmoji(match.query).map((e) => ({
      label: `${e.char}  :${e.name}:`,
      apply(view: EditorView, completion: Completion, applyFrom: number, applyTo: number) {
        applyInsert(view, completion, applyFrom, applyTo, e.char, e.char.length);
      },
    }));
    // filter:false → keep our ranking + keyword matches; no validFor → re-query per keystroke.
    return { from, to, options: [gallery, ...emoji], filter: false };
  };
}

// Combined editor completion: property keys/enums/tag-lists (frontmatter) plus
// `[[wikilinks]]`, `#tags`, and `:emoji:`/special chars (body) — all in ONE config.
// Multiple autocompletion() extensions would conflict, so every source lives in this
// single override array.
export function vaultCompletion(opts: {
  getNotes: () => NoteCandidate[];
  getTags: () => string[];
  getSchema: () => Schema;
  getIconNames: () => string[];
  inFrontmatter: (ctx: CompletionContext) => boolean;
}): Extension {
  return autocompletion({
    ...completionDisplayConfig,
    override: [
      // frontmatter-position sources (gated by inFrontmatter)
      propertyKeySource(opts.getSchema, opts.inFrontmatter),
      iconValueSource(opts.getIconNames, opts.inFrontmatter),
      enumValueSource(opts.getSchema, opts.inFrontmatter),
      tagListSource(opts.getTags, opts.inFrontmatter),
      // body-position sources
      slashSource(opts.inFrontmatter),   // `/` at line start: insert headings/tables/blocks/links
      querySource(),          // inside a ```query block: keys / view / tasks-DSL / group
      taskSource(),           // on a `- [ ] …` line: due/scheduled/priority/recurrence signifiers
      templateTokenSource(),
      wikilinkSource(opts.getNotes),
      tagSource(opts.getTags),
      emojiSource(),
    ],
  });
}
