// app/src/editor/tableState.ts
// Shared editor state for the editable-table feature, factored out so the widget
// (tableWidget.ts) and the live-preview wiring (livePreview.ts) can both reach it
// without a circular import. A table block normally renders as the editable
// <table> widget; a block becomes "active" (shows raw pipe source for structural /
// power edits) when the user opens it via the widget's source toggle. It stays
// active only while the cursor remains inside its line range.
import { Facet, StateEffect, StateField } from "@codemirror/state";
import { groupTableBlocks } from "./tableModel";

/** The current note's vault path, supplied by the editor host. The table widget reads it
 *  to scope its persisted (visual-only) column widths / row heights per note. */
export const notePathFacet = Facet.define<string | null, string | null>({
  combine: (values) => values[0] ?? null,
});

/** Request raw-source mode for the table block whose header is at this 1-based line
 *  (or null to clear). */
export const setActiveTableEffect = StateEffect.define<number | null>();

/** The header line of the table block currently shown as raw source, or null. */
export const activeTableField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setActiveTableEffect)) return e.value;
    if (value == null) return value;
    if (!tr.docChanged && !tr.selection) return value;
    // Stay raw only while the cursor is still within the (possibly shifted) block.
    const doc = tr.state.doc;
    const head = doc.lineAt(tr.state.selection.main.head).number;
    const { blocks } = groupTableBlocks(doc);
    const block = blocks.find((b) => head >= b.startLine && head <= b.endLine);
    return block ? block.startLine : null;
  },
});
