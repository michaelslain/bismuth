// app/src/activeMenu.ts
// A single process-wide "active context menu" registry, so that opening ANY context
// menu dismisses whatever menu was already open — regardless of which surface opened
// it. Every context menu funnels through here on mount (see ContextMenu.tsx).
//
// Why this exists: the app renders context menus through several INDEPENDENT signals
// and portals (App's pane/editor/create menus, FileTree, DaemonList, ChatView bubbles,
// the imperative task-status menu, calendar EventChips). Menus were dismissed only by a
// document "click" (left-click) listener, but a menu is usually OPENED by a right-click
// ("contextmenu" event) which never fires "click" — so opening a menu on one surface
// left a menu open on another (notably the toolbar "+" create menu coexisting with a
// note/editor menu). Funneling every menu through one registry makes opening exclusive:
// registering a new menu first closes the previously-registered one.

let activeClose: (() => void) | null = null;

/**
 * Register `close` as the now-open context menu, first dismissing any menu that was
 * already open. Returns a disposer to call on unmount; it clears the registry slot only
 * if this menu is still the active one (so a newer menu's registration isn't clobbered
 * when this one's cleanup runs as a result of being replaced).
 */
export function registerActiveMenu(close: () => void): () => void {
  const prev = activeClose;
  // Claim the slot BEFORE closing the previous menu: closing it may synchronously run
  // that menu's cleanup (its disposer), which must see the slot already reassigned and
  // therefore leave our registration intact.
  activeClose = close;
  if (prev && prev !== close) prev();
  return () => {
    if (activeClose === close) activeClose = null;
  };
}

/** Close whatever context menu is currently open (if any). Clears the slot before running
 *  the callback so it is self-sufficient (a menu's own cleanup disposer sees the slot
 *  already vacated and no-ops rather than double-clearing). */
export function closeActiveMenu(): void {
  const c = activeClose;
  activeClose = null;
  if (c) c();
}

/** Whether any context menu is currently registered as open. */
export function hasActiveMenu(): boolean {
  return activeClose !== null;
}
