// app/src/editor/emojiQuickAction.ts
// The emoji-library QUICK ACTION shared by the two right-click menus you can insert text
// into: the note editor (editor/contextMenu.ts) and a table cell (editor/tableWidget.ts).
//
// #67 history — why this is a quick action, not a menu row or a toolbar button:
//   • As a `toolbar:` button it was invisible to anyone with a custom `.settings` (the
//     toolbar is user-configured), and force-injecting it read as a mystery icon.
//   • As a ROW in the context menu it was reachable but, in the user's words, "hidden
//     under all those options" — buried among the fix actions / Copy / Cut / Paste, and in
//     a table among insert-row / delete-column / merge / Edit source.
// So it renders on the RAIL hanging off the context menu's LEFT edge: outside the option
// list, always visible on every right-click, one click, no setting to opt in to.
//
// Deliberately dependency-free (no @codemirror/*, no Solid) — `tableWidget.ts` keeps
// headless unit tests, so anything it imports must stay import-light. The view is typed
// structurally as just the calls we make.

/** A rail action on the shared <ContextMenu>. Mirrors ContextMenu's `QuickAction`. */
export type QuickActionSpec = { icon: string; label: string; onSelect: () => void };

/** Place a picked glyph. Return false when there's nowhere to put it (App then toasts). */
export type EmojiInsert = (char: string) => boolean;

/**
 * The emoji-library rail action.
 *
 * A CodeMirror extension / widget can't reach App's emoji gallery directly, so this fires
 * the window event App listens for; App pops the picker and inserts the glyph.
 *
 * @param opts.focus  Re-focus the surface the menu was opened on. The menu is a separate DOM
 *   overlay, so clicking it leaves focus off the editor.
 * @param opts.insert WHERE the glyph lands. Omit for the note editor — App's default targets
 *   the last-focused note editor's caret, which is exactly right there. A TABLE CELL must
 *   pass its own: CM's outer selection never tracks a cell edit (the cell is a contenteditable
 *   island), so the default would drop the emoji at a stale position elsewhere in the note.
 */
export function emojiQuickAction(opts: { focus: () => void; insert?: EmojiInsert }): QuickActionSpec {
  return {
    icon: "Smile",
    label: "Emoji library",
    onSelect: () => {
      opts.focus();
      window.dispatchEvent(new CustomEvent("bismuth-open-emoji-library", { detail: { insert: opts.insert } }));
    },
  };
}
