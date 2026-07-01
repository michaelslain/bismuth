// app/src/editor/slashComplete.ts
// CodeMirror wiring for the `/` slash-insertion menu. All the logic (trigger match, item
// catalog, ranking, snippet parsing) is pure in slashMenu.ts; this file is just the thin
// CompletionSource that reads the editor state, builds the option rows, and applies the
// chosen snippet — mirroring queryComplete.ts. Added to the ONE shared override array in
// autocomplete.ts (a second autocompletion() would conflict).
import { pickedCompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type { IconedCompletion } from "./completionDisplay";
import { SLASH_ITEMS, matchSlashPrefix, filterSlashItems, parseSnippet, inCodeFence, type SlashItem } from "./slashMenu";
import { extractFrontmatterBoundary } from "./frontmatterUtils";

// Today's date as an extra, dynamic item (can't live in the static catalog). YYYY-MM-DD to
// match the vault's daily-note / frontmatter date convention.
function dateItem(): SlashItem {
  const today = new Date().toISOString().slice(0, 10);
  return { id: "date", label: "Today's date", icon: "Calendar", info: "Insert today's date (YYYY-MM-DD).", keywords: ["today", "date", "now"], snippet: today };
}

/** `/` slash menu: on a line whose first content char is `/`, offer insertions (headings,
 *  lists, table, query/code/math blocks, quote, callout, divider, page break, links,
 *  properties, date). Gated out of frontmatter (the property sources own it there) and
 *  fenced code/query blocks. */
export function slashSource(inFrontmatter: (ctx: CompletionContext) => boolean): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    if (inFrontmatter(context)) return null;
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const match = matchSlashPrefix(textBefore);
    if (!match) return null;

    // Inside a ``` fence the text is literal (or the query source owns the popup) — stay quiet.
    const upto: string[] = [];
    for (let n = 1; n <= line.number; n++) upto.push(context.state.doc.line(n).text);
    if (inCodeFence(upto, line.number - 1)) return null;

    const from = line.from + match.from;
    // Frontmatter must be the FIRST thing in a file, so the Properties item is offered only
    // when the `/` sits at the true document start (line 1, column 0 — NOT after indentation
    // or a list marker) AND no frontmatter block already exists below the line being typed.
    // Without the second check, typing `/` on a fresh line 1 above existing frontmatter would
    // offer Properties and insert a SECOND `---` block, orphaning the real frontmatter.
    const atDocStart = line.number === 1 && match.from === 0;
    const allowProps = atDocStart && extractFrontmatterBoundary(context.state.doc.sliceString(line.to + 1)) === null;
    const pool = allowProps ? SLASH_ITEMS : SLASH_ITEMS.filter((i) => i.when !== "docStart");
    const items = filterSlashItems([...pool, dateItem()], match.query);

    const options: IconedCompletion[] = items.map((item) => ({
      label: item.label,
      info: item.info,
      lucideIcon: item.icon,
      apply(view: EditorView, completion: Completion, applyFrom: number, applyTo: number) {
        const { text, caret } = parseSnippet(item.snippet);
        view.dispatch({
          changes: { from: applyFrom, to: applyTo, insert: text },
          selection: { anchor: applyFrom + caret },
          annotations: pickedCompletion.of(completion),
        });
        if (item.reTrigger) startCompletion(view);
      },
    }));
    // filter:false → keep OUR keyword-aware ranking; no validFor → re-query each keystroke
    // (matchSlashPrefix re-runs, so the list narrows and a space/non-word char closes it).
    return { from, options, filter: false };
  };
}
