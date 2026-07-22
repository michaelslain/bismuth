/**
 * Right-clicking a kanban card must show NOTHING. There is no longer a custom card menu (delete
 * moved into the card's edit modal), and the card must ALSO not fall through to the pane's menu:
 * the `.pane-leaf` ancestor (PaneTree.tsx) opens the split-pane context menu on `contextmenu`, so a
 * card that doesn't swallow the event lets that menu appear underneath it (the reported regression).
 *
 * So the card swallows its own contextmenu: `preventDefault()` suppresses the native/default menu,
 * `stopPropagation()` stops the event bubbling to the pane leaf. Same idiom ListView uses on its
 * status handler ("don't also open the pane's context menu underneath"). No menu UI is opened.
 */
export function suppressCardContextMenu(e: {
  preventDefault: () => void;
  stopPropagation: () => void;
}): void {
  e.preventDefault();
  e.stopPropagation();
}
