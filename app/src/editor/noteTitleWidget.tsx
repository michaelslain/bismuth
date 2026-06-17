// app/src/editor/noteTitleWidget.tsx
// Renders the inline note title (`# <title>`) as a BLOCK WIDGET pinned to the very
// top of the document, so it lives INSIDE the CodeMirror scroller and scrolls away
// with the rest of the note instead of staying fixed at the top of the pane.
//
// It was previously a Solid sibling mounted ABOVE the scroller (in Editor.tsx's
// render), which is why it stayed put while the note scrolled. Moving it into the
// content as a block decoration at position 0 makes it part of the scrolled flow.
//
// The path is baked into the widget at construction. The editor view is fully
// rebuilt whenever the note path changes (the createEffect in Editor.tsx keyed on
// currentPath), so a stale path can never persist in the widget.
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { StateField, type Extension } from "@codemirror/state";
import { SolidWidget, mountSolid } from "./solidWidget";
import { NoteTitle } from "../NoteTitle";

class NoteTitleWidget extends SolidWidget {
  constructor(private readonly path: string) {
    super("oa-note-title");
  }

  eq(other: NoteTitleWidget): boolean {
    return other.path === this.path;
  }

  protected renderSolid(container: HTMLElement): void {
    mountSolid(container, () => NoteTitle({ path: this.path }));
  }
}

/**
 * Extension that renders the editable note title as a block widget at doc start.
 * `side: -1` keeps it before the first line; the single decoration at position 0
 * is mapped through edits (position 0 is always valid) so it survives typing and
 * external-reload reconciles.
 */
export function noteTitleWidget(path: string): Extension {
  const build = (): DecorationSet =>
    Decoration.set(
      Decoration.widget({ widget: new NoteTitleWidget(path), block: true, side: -1 }).range(0),
    );
  return StateField.define<DecorationSet>({
    create: build,
    update: (deco, tr) => (tr.docChanged ? deco.map(tr.changes) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
}
