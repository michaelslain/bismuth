// app/src/editor/autocomplete.ts
import { autocompletion, pickedCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { matchWikilinkPrefix, buildInsert, type NoteCandidate } from "./wikilink";
import { matchTagPrefix } from "./tag";

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

// Combined editor completion: `[[wikilinks]]` and `#tags` in one config.
// Two separate `autocompletion()` extensions would conflict, so we combine them.
export function vaultCompletion(opts: {
  getNotes: () => NoteCandidate[];
  getTags: () => string[];
}): Extension {
  return autocompletion({
    override: [wikilinkSource(opts.getNotes), tagSource(opts.getTags)],
  });
}
