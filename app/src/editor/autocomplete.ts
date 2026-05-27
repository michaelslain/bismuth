// app/src/editor/autocomplete.ts
import { autocompletion, pickedCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { matchWikilinkPrefix, buildInsert, type NoteCandidate } from "./wikilink";

// Autocomplete for `[[wikilinks]]`. `getNotes` is called when the popup opens, so the
// candidate list always reflects the current vault even though the editor view (and
// therefore this extension) is constructed only once per open file.
export function wikilinkComplete(getNotes: () => NoteCandidate[]): Extension {
  const source = (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const match = matchWikilinkPrefix(textBefore);
    if (!match) return null;

    const from = line.from + match.from; // document offset just after the `[[`
    const options = getNotes().map((n) => ({
      label: n.label,
      detail: n.folder,
      apply: (view: EditorView, completion: Completion, applyFrom: number, applyTo: number) => {
        const after = view.state.doc.sliceString(applyTo, applyTo + 2);
        const { insert, cursorOffset } = buildInsert(n.label, after === "]]");
        // A custom apply that dispatches its own transaction must annotate it so
        // CodeMirror registers the pick (closes the popup, runs commit logic).
        view.dispatch({
          changes: { from: applyFrom, to: applyTo, insert },
          selection: { anchor: applyFrom + cursorOffset },
          annotations: pickedCompletion.of(completion),
        });
      },
    }));
    // validFor lets CodeMirror re-filter as the user keeps typing without re-running
    // the source, until a `]` or newline ends the link.
    return { from, options, validFor: /^[^\]\n]*$/ };
  };
  return autocompletion({ override: [source] });
}
