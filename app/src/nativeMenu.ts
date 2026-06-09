// app/src/nativeMenu.ts
// Right-click context menus. We deliberately use our own HTML <ContextMenu> EVERYWHERE —
// including the Tauri desktop build — rather than the native OS menu, so menus match the
// app's design system and stay visually/behaviorally consistent across platforms.
import type { MenuItem } from "./ContextMenu";

/** True only inside the Tauri webview (where the native menu/app APIs exist). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

/**
 * Open a context menu for a right-click via the shared HTML <ContextMenu> (`showHtml`).
 * Call this from an onContextMenu handler (after preventDefault).
 */
export function openContextMenu(
  x: number,
  y: number,
  items: MenuItem[],
  showHtml: (m: { x: number; y: number; items: MenuItem[] }) => void,
): void {
  showHtml({ x, y, items });
}
