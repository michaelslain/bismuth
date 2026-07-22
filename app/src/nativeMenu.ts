// app/src/nativeMenu.ts
// Right-click context menus. We deliberately use our own HTML <ContextMenu> EVERYWHERE —
// including the Tauri desktop build — rather than the native OS menu, so menus match the
// app's design system and stay visually/behaviorally consistent across platforms.
import type { MenuItem, QuickAction } from "./ContextMenu";

/** True only inside the Tauri webview (where the native menu/app APIs exist). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

/**
 * Open a context menu for a right-click via the shared HTML <ContextMenu> (`showHtml`).
 * Call this from an onContextMenu handler (after preventDefault).
 *
 * `quickActions` (optional) are icon buttons drawn on a rail BESIDE the menu rather than as
 * rows in it — for actions that must stay visible instead of competing with a long option
 * list (the emoji library on the editor / table-cell menus, #67).
 */
export function openContextMenu(
  x: number,
  y: number,
  items: MenuItem[],
  showHtml: (m: { x: number; y: number; items: MenuItem[]; quickActions?: QuickAction[] }) => void,
  quickActions?: QuickAction[],
): void {
  showHtml({ x, y, items, quickActions });
}
