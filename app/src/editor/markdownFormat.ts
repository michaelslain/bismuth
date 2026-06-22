// app/src/editor/markdownFormat.ts
// Cmd/Ctrl-B and Cmd/Ctrl-I: wrap the selection in markdown emphasis markers, or strip
// them when the selection is already wrapped (toggle). With an empty selection it drops
// the markers and parks the caret between them so you can just start typing.

import { EditorSelection, type ChangeSpec, type StateCommand } from "@codemirror/state";

function toggleWrap(marker: string): StateCommand {
  const m = marker.length;
  return ({ state, dispatch }) => {
    const tr = state.changeByRange((range) => {
      // Markers sitting just outside the selection (e.g. caret/selection inside `**x**`).
      if (state.sliceDoc(range.from - m, range.from) === marker && state.sliceDoc(range.to, range.to + m) === marker) {
        const changes: ChangeSpec[] = [
          { from: range.from - m, to: range.from },
          { from: range.to, to: range.to + m },
        ];
        return { changes, range: EditorSelection.range(range.from - m, range.to - m) };
      }
      const selected = state.sliceDoc(range.from, range.to);
      // The selection itself already carries the markers → strip them.
      if (selected.length >= 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
        return {
          changes: { from: range.from, to: range.to, insert: selected.slice(m, selected.length - m) },
          range: EditorSelection.range(range.from, range.to - 2 * m),
        };
      }
      // Otherwise wrap. Empty selection → caret lands between the two markers.
      return {
        changes: { from: range.from, to: range.to, insert: marker + selected + marker },
        range: range.empty
          ? EditorSelection.cursor(range.from + m)
          : EditorSelection.range(range.from + m, range.to + m),
      };
    });
    dispatch(state.update(tr, { userEvent: "input", scrollIntoView: true }));
    return true;
  };
}

export const toggleBold: StateCommand = toggleWrap("**");
export const toggleItalic: StateCommand = toggleWrap("*");
