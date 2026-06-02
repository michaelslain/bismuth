// app/src/nativeMenu.ts
// Native (OS) context menus via the Tauri menu API, with a graceful HTML fallback.
// In the desktop (Tauri) build, right-click menus render as real native OS menus
// built from OUR curated items; in the browser dev preview (no Tauri), the caller's
// HTML ContextMenu is used instead. The item shape is the existing ContextMenu MenuItem.
import type { MenuItem } from "./ContextMenu";

/** True only inside the Tauri webview (where the native menu API exists). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

/**
 * Pop a native OS context menu built from `items`. Returns true if a native menu was
 * shown; false when not in Tauri (so the caller should show its HTML fallback).
 * `separatorBefore` items insert a native separator; `disabled` maps to enabled:false.
 */
export async function popupNativeMenu(items: MenuItem[]): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { Menu } = await import("@tauri-apps/api/menu");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const built: any[] = [];
    for (const it of items) {
      if (it.separatorBefore && built.length) built.push({ item: "Separator" });
      built.push({ text: it.label, enabled: it.disabled !== true, action: () => it.onSelect() });
    }
    const menu = await Menu.new({ items: built });
    await menu.popup();
    return true;
  } catch (e) {
    console.error("[nativeMenu] failed, falling back to HTML menu", e);
    return false;
  }
}

/**
 * Open a context menu for a right-click: native in Tauri, else the HTML fallback via
 * `showHtml`. Call this from an onContextMenu handler (after preventDefault).
 */
export function openContextMenu(
  x: number,
  y: number,
  items: MenuItem[],
  showHtml: (m: { x: number; y: number; items: MenuItem[] }) => void,
): void {
  void popupNativeMenu(items).then((shown) => {
    if (!shown) showHtml({ x, y, items });
  });
}
