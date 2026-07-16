// app/src/editor/autocomplete.ts
import { autocompletion, startCompletion, closeCompletion, completionStatus, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { completionDisplayConfig, completionTheme } from "./completionDisplay";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { matchWikilinkPrefix, matchWikilinkHeadingPrefix, parseHeadings, resolveNotePath, buildInsert, type NoteCandidate } from "./wikilink";
import { matchMemoryRefPrefix, buildMemoryRefInsert, isSrsSeparatorLine, type MemoryCandidate } from "../../../core/src/memoryRef";
import { matchAtMentionPrefix, rankFileCandidates, type FileCandidate } from "./atMention";
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
import { applyCompletion as applyInsert } from "./applyCompletion";

// Is the caret inside a code span / fenced block per the markdown syntax tree? `[[`,
// `#tag` and `:emoji:` are prose features — they must NOT fire inside code, where those
// characters are literal source (e.g. `arr[[0]]`, `c#`, Python slices `x[1:2]`). We walk
// from the innermost node at the caret up to the root, matching the Lezer-markdown code
// node names. `-1` biases resolution to the node ending at the caret so a span we just
// finished typing still counts as code.
function inCode(context: CompletionContext): boolean {
  // Derive the parse-node type from resolveInner so we don't depend on @lezer/common
  // (same idiom as livePreview.ts).
  type ParseNode = NonNullable<ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>["parent"]>;
  for (let n: ParseNode | null = syntaxTree(context.state).resolveInner(context.pos, -1); n; n = n.parent) {
    if (["InlineCode", "FencedCode", "CodeBlock", "CodeText"].includes(n.name)) return true;
  }
  return false;
}

// Hoisted: used via .match() (which resets lastIndex before scanning) from the
// per-keystroke checks below.
const BACKTICK_RE = /`/g;
const UNESCAPED_DOLLAR_RE = /(?<!\\)\$/g;

// Cheap textual fallback for an *open* inline-code span on the current line: an odd
// number of backticks before the caret means we're inside a still-unclosed `` `…``. The
// syntax tree only marks a *closed* `InlineCode`, so this catches the half-typed case
// the tree misses. (`[[` / `#` alone have zero backticks → false, so the trigger is safe.)
function inInlineCode(textBefore: string): boolean {
  return ((textBefore.match(BACKTICK_RE) || []).length % 2) === 1;
}

// Cheap textual check for an *open* inline `$…$` math span on the current line: an odd
// number of unescaped `$` before the caret means we're inside it. `:` is a real LaTeX
// character (e.g. `\colon`, `a:b`) so the `:emoji:` trigger must not fire inside math.
function inInlineMath(textBefore: string): boolean {
  return ((textBefore.match(UNESCAPED_DOLLAR_RE) || []).length % 2) === 1;
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
    // `[[wikilink]]` / `#tag` are prose triggers — suppress them inside code (B22).
    if (inCode(context) || inInlineCode(textBefore)) return null;
    const match = opts.match(textBefore);
    if (!match) return null;

    const from = line.from + match.from;
    const options = opts.items().map(opts.toOption);
    return { from, options, validFor: opts.validFor };
  };
}

// `[[wikilink]]` completion. Inserts `[[Name]]`, cursor after the `]]` (avoids
// double `]]` when one is already ahead). `getNotes` is read lazily per popup open.
// Yields to `wikilinkHeadingSource` once the open link contains a `#` AND the text before that
// `#` resolves to a real note — i.e. genuine `[[Note#heading]]` territory. If the part before
// `#` does NOT resolve (e.g. a note literally named `C# Notes`), we stay in note mode so the
// full name (`C# Notes`) still completes, rather than leaving an empty popup.
function wikilinkSource(getNotes: () => NoteCandidate[]): CompletionSource {
  return prefixSource<NoteCandidate>({
    match: (textBefore) => {
      const h = matchWikilinkHeadingPrefix(textBefore);
      if (h && resolveNotePath(h.target, getNotes())) return null; // heading source owns it
      return matchWikilinkPrefix(textBefore);
    },
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

// `[[Note#heading]]` completion: once the caret is inside an open `[[…` that already has a
// `#`, offer the target note's headings. ASYNC — there is no client-side heading index, so
// it resolves the target to a real note path and fetches the body via `readNote` (cached per
// path for the editor's lifetime so per-keystroke re-queries don't re-hit the backend), then
// parses ATX headings. The completion engine awaits the returned Promise (same as the settings
// editor's fs-path source). Bails when the target doesn't resolve to an existing note. We rank
// ourselves (substring on the typed heading) so `filter: false`; no `validFor` re-queries each
// keystroke. Apply inserts the heading text after the `#`, appending `]]` when not already ahead.
function wikilinkHeadingSource(
  getNotes: () => NoteCandidate[],
  readNote: (path: string) => Promise<string>,
): CompletionSource {
  const headingsCache = new Map<string, Promise<ReturnType<typeof parseHeadings>>>();
  const headingsFor = (path: string) => {
    let p = headingsCache.get(path);
    if (!p) {
      // Evict on failure so a transient read error (offline blip, save/rename race) isn't cached
      // as "no headings" for the whole session — the next keystroke retries instead.
      p = readNote(path).then(parseHeadings).catch(() => { headingsCache.delete(path); return []; });
      headingsCache.set(path, p);
    }
    return p;
  };
  return (context: CompletionContext): Promise<CompletionResult | null> | null => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    if (inCode(context) || inInlineCode(textBefore)) return null;
    const m = matchWikilinkHeadingPrefix(textBefore);
    if (!m) return null;
    const notePath = resolveNotePath(m.target, getNotes());
    if (!notePath) return null; // unknown target — nothing to complete against
    const from = line.from + m.from;
    const q = m.heading.trim().toLowerCase();
    return headingsFor(notePath).then((headings) => {
      const options: Completion[] = headings
        .filter((h) => h.text.toLowerCase().includes(q))
        .map((h) => ({
          label: h.text,
          detail: "#".repeat(h.level),
          type: "keyword",
          apply(view: EditorView, completion: Completion, applyFrom: number, applyTo: number) {
            const after = view.state.doc.sliceString(applyTo, applyTo + 2);
            const insert = after === "]]" ? h.text : h.text + "]]";
            applyInsert(view, completion, applyFrom, applyTo, insert, h.text.length + 2);
          },
        }));
      if (options.length === 0) return null;
      return { from, options, filter: false };
    });
  };
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

// `??slug` MEMORY REFERENCE completion — the 3rd-brain twin of the `[[wikilink]]` note picker,
// available in BOTH the note editor and the chat composer (both mount `markdownEditingExtensions`,
// so wiring it here lights up both at once). Picking a memory note inserts its bare slug after the
// already-typed `??`, so the saved markdown keeps the `??slug` reference verbatim.
//
// DAEMON-GATED FOR FREE: memory only exists when `settings.daemon.enabled` is on — the server then
// builds `<vault>/.daemon/memory` into the graph as `mem:` nodes, which is where `getMemories`
// reads from (App.tsx). Daemon off → zero candidates → `prefixSource` yields an empty option list
// and the popup never opens. No crash, no broken picker, no separate gate to keep in sync.
//
// Exported so `memoryRefSource.test.ts` can pin the contract against the assembled options (same
// idiom as `emojiSource`). The note editor and the chat composer consume this EXACT source through
// `vaultCompletion()`, so one test covers both surfaces.
export function memoryRefSource(getMemories: () => MemoryCandidate[]): CompletionSource {
  return prefixSource<MemoryCandidate>({
    match: matchMemoryRefPrefix,
    items: getMemories,
    toOption: (m) => ({
      label: m.label,
      // Show the full rel path as detail only when it differs from the label (a subfoldered
      // memory note) — for the flat, common case the label already says everything.
      ...(m.slug === m.label ? {} : { detail: m.slug }),
      type: "keyword",
      apply(view: EditorView, completion: Completion, applyFrom: number, applyTo: number) {
        const { insert, cursorOffset } = buildMemoryRefInsert(m.slug);
        applyInsert(view, completion, applyFrom, applyTo, insert, cursorOffset);
      },
    }),
    validFor: /^[\w/-]*$/,
  });
}

// A line that is exactly `??` is the SRS multi-reversed flashcard separator (core/src/srs/parser.ts
// matches `l.trim() === "??"`). Typing `??`↵ is how you AUTHOR one — but our picker opens on the
// bare `??`, and CodeMirror's completionKeymap binds Enter to `acceptCompletion` at Prec.highest,
// so Enter would silently insert a memory slug instead of the newline the user wanted, breaking an
// existing feature. This guard runs first (Prec.highest, registered BEFORE `autocompletion()` so it
// wins the tie), closes the popup, and returns FALSE so Enter falls through to its normal handler
// and still inserts the newline. Any other line (`??alp`↵) is a real pick and is left alone.
const srsSeparatorEnterGuard = Prec.highest(keymap.of([{
  key: "Enter",
  run: (view: EditorView) => {
    if (completionStatus(view.state) !== "active") return false;
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    if (!isSrsSeparatorLine(line.text)) return false;
    closeCompletion(view);
    return false; // not handled — let the newline through
  },
}]));

// `@file` mention completion (Row 79a) — composer-only, wired in ONLY when `getFiles` is supplied
// (the note editor never passes it, so this source is simply absent there). Fuzzy-matches EVERY
// vault file (not just markdown notes) and inserts a `[[wikilink]]` reference — the same mention
// shape a drag-into-chat drops (Row 74) — replacing the whole `@query` span. `onPick` fires with the
// chosen file's real PATH so ChatView can wire it into the chat context (chatContext.ts) and its
// content reaches the model. We rank ourselves (rankFileCandidates) so `filter: false` + no
// `validFor` (re-query each keystroke), like the emoji source.
function atMentionSource(getFiles: () => FileCandidate[], onPick?: (path: string) => void): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    // A mention is prose — never fire inside code, where `@` is literal (decorators, npm scopes).
    if (inCode(context) || inInlineCode(textBefore)) return null;
    const match = matchAtMentionPrefix(textBefore);
    if (!match) return null;
    const from = line.from + match.from; // the `@` itself — the whole `@query` span is replaced
    const options: Completion[] = rankFileCandidates(getFiles(), match.query)
      .slice(0, 50)
      .map((f) => ({
        label: f.label,
        detail: f.folder,
        apply(view: EditorView, completion: Completion, applyFrom: number, applyTo: number) {
          onPick?.(f.path);
          // Insert `[[Name]] ` (trailing space to keep typing), caret parked just past it. Mirrors
          // wikilinkFor(path) for the reference, but built from the display label so the popup pick
          // and the inserted text are the same string.
          const insert = `[[${f.label}]] `;
          applyInsert(view, completion, applyFrom, applyTo, insert, insert.length);
        },
      }));
    if (options.length === 0) return null;
    return { from, options, filter: false };
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
//
// Exported so `emojiSource.test.ts` can pin the #67 contract directly against the assembled
// options: `:rocket` → 🚀 is the FIRST, default-selected item and there is NO "Open emoji
// gallery" row to outrank it. The note editor AND the in-cell table editor both consume this
// exact source through `vaultCompletion()` (cellEditorExtensions.ts), so one test covers both.
export function emojiSource(): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    // `:emoji:` is a prose trigger — suppress it inside code (B22). Note `:` is common in
    // code (slices, ternaries, dict literals) so this matters even more than for `[[`/`#`.
    if (inCode(context) || inInlineCode(textBefore)) return null;
    // `:` is a LaTeX character — suppress the emoji popup inside an open `$…$` math span.
    if (inInlineMath(textBefore)) return null;
    // Inside an open `[[wikilink`, let the wikilink source own the popup — wikilink names
    // can contain spaces, so the emoji rule (`:` after whitespace) would otherwise
    // double-fire and mix note + emoji suggestions in one list.
    if (matchWikilinkPrefix(textBefore)) return null;
    const match = matchEmojiPrefix(textBefore);
    if (!match) return null;

    const from = line.from + match.from;
    const to = line.from + match.to;
    // EMOJI ONLY (#67): the popup is a pure, best-first list of emoji, so typing `:rocket`↵
    // inserts 🚀 — the top, default-selected option — with nothing else able to outrank it. The
    // "Open emoji gallery" row that USED to live at the end of this list (and, in the user's build,
    // floated ABOVE the match) is gone: the full emoji library is now reached through the always-
    // visible `emoji-library` toolbar command instead of being buried under the completion options.
    // When nothing matches (e.g. `:zzzz`) we return null so no empty/stray popup appears.
    // filter:false → keep our ranking + keyword matches; no validFor → re-query per keystroke.
    const options: Completion[] = searchEmoji(match.query).map((e) => ({
      label: `${e.char}  :${e.name}:`,
      apply(view: EditorView, completion: Completion, applyFrom: number, applyTo: number) {
        applyInsert(view, completion, applyFrom, applyTo, e.char, e.char.length);
      },
    }));
    if (options.length === 0) return null;
    return { from, to, options, filter: false };
  };
}

// Task-metadata completion as a standalone extension: the SAME `taskSource()` + display
// config the full `vaultCompletion()` uses, bundled with the shared `completionTheme` so the
// popup looks identical. For editors that only need task signifiers/dates (the card editor),
// rather than re-spelling the autocompletion wiring there.
export function taskCompletion(): Extension {
  return [
    autocompletion({ ...completionDisplayConfig, override: [taskSource()] }),
    completionTheme,
  ];
}

// Combined editor completion: property keys/enums/tag-lists (frontmatter) plus
// `[[wikilinks]]`, `#tags`, and `:emoji:`/special chars (body) — all in ONE config.
// CodeMirror's `activateOnTyping` only auto-opens the popup on word-character input, but the
// wikilink trigger opens with punctuation (`[[`), so typing it never auto-activated — the popup
// only appeared via Ctrl-Space (B21). This listener force-opens it the instant a `[[` prefix
// appears from user typing. `startCompletion` is deferred (you may not dispatch inside an
// updateListener) and is a no-op when no source returns options (e.g. inside code, where the
// wikilink source bails per B22), so it's safe to fire optimistically.
const wikilinkAutoTrigger = EditorView.updateListener.of((update) => {
  if (!update.docChanged) return;
  // Fire on typing AND deletion: deleting the `#` of `[[File#` back to `[[File` must re-open the
  // NOTE popup (the heading source stops matching), which a type-only gate would miss.
  if (!update.transactions.some((tr) => tr.isUserEvent("input.type") || tr.isUserEvent("delete"))) return;
  const pos = update.state.selection.main.head;
  const line = update.state.doc.lineAt(pos);
  const textBefore = line.text.slice(0, pos - line.from);
  // `[[`, `@` and `??` all open with punctuation, which CM's activateOnTyping (word chars only)
  // misses — force the popup open. startCompletion no-ops when no source returns options (e.g. `@`
  // in a note editor, where the composer-only at-mention source isn't wired, or `??` when the
  // daemon is off and there are no memory notes), so firing on any of them is safe.
  if (matchWikilinkPrefix(textBefore) || matchAtMentionPrefix(textBefore) || matchMemoryRefPrefix(textBefore)) {
    const view = update.view;
    queueMicrotask(() => startCompletion(view));
  }
});

// Multiple autocompletion() extensions would conflict, so every source lives in this
// single override array.
export function vaultCompletion(opts: {
  getNotes: () => NoteCandidate[];
  /** The 3rd brain's memory notes, powering the `??slug` reference picker. Empty (or absent) when
   *  the vault's daemon is disabled — then the `??` popup simply never opens. */
  getMemories?: () => MemoryCandidate[];
  getTags: () => string[];
  getSchema: () => Schema;
  getIconNames: () => string[];
  inFrontmatter: (ctx: CompletionContext) => boolean;
  // Async note-body reader (api.read). Powers `[[Note#heading]]` heading completion, which
  // has no client-side index and must fetch the target note's body to list its headings.
  readNote: (path: string) => Promise<string>;
  // Composer-only (Row 79a): the FULL vault file list powering the `@file` mention switcher, and a
  // callback fired with the picked file's PATH so the chat wires it into its context. Absent in the
  // note editor → the at-mention source is simply not added.
  getFiles?: () => FileCandidate[];
  onFileMention?: (path: string) => void;
}): Extension {
  const getMemories = opts.getMemories;
  return [
    // BEFORE autocompletion(): both keymaps sit at Prec.highest, so extension order breaks the
    // tie and this guard must be consulted before CM's Enter→acceptCompletion binding.
    ...(getMemories ? [srsSeparatorEnterGuard] : []),
    autocompletion({
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
      // `@file` mention — composer-only, so gated on getFiles being supplied.
      ...(opts.getFiles ? [atMentionSource(opts.getFiles, opts.onFileMention)] : []),
      // Heading source BEFORE the note source: inside `[[Note#…` the note source bails and this
      // one owns the popup (it's also async, so ordering keeps the sync note source from racing it).
      wikilinkHeadingSource(opts.getNotes, opts.readNote),
      wikilinkSource(opts.getNotes),
      // `??slug` memory reference — wired only when the host supplies the memory list.
      ...(getMemories ? [memoryRefSource(getMemories)] : []),
      tagSource(opts.getTags),
      emojiSource(),
    ],
    }),
    wikilinkAutoTrigger,
  ];
}
