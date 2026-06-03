// app/src/nativeAppMenu.ts
// Builds the native macOS menu bar (Tauri only) and wires each item to a command
// handler. This is the "optional native menu later" promised when we made the file
// options commands: the menu is just another surface onto the same actions, so the
// command palette and the menu bar stay in sync.
//
// setAsAppMenu REPLACES the whole menu, so we re-add the standard app/Edit/Window
// items (Quit, Copy/Paste/Undo, Minimize…) as PredefinedMenuItems — otherwise the
// native Cmd+C/V/Z and Quit would disappear.
import { isTauri } from "./nativeMenu";

export interface AppMenuActions {
  openFolder: () => void;
  newWindow: () => void;
  newNote: () => void;
  newFolder: () => void;
  exportActive: () => void;
  openSettings: () => void;
  openSearch: () => void;
}

export async function installAppMenu(a: AppMenuActions): Promise<void> {
  if (!isTauri()) return;
  try {
    const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import("@tauri-apps/api/menu");
    const item = (text: string, action: () => void) => MenuItem.new({ text, action });
    const sep = () => PredefinedMenuItem.new({ item: "Separator" });

    // macOS: the FIRST submenu is the app menu (named after the app).
    const appMenu = await Submenu.new({
      text: "Three Brains",
      items: [
        await PredefinedMenuItem.new({ item: { About: null } }),
        await sep(),
        await item("Settings…", a.openSettings),
        await sep(),
        await PredefinedMenuItem.new({ item: "Hide" }),
        await PredefinedMenuItem.new({ item: "HideOthers" }),
        await PredefinedMenuItem.new({ item: "ShowAll" }),
        await sep(),
        await PredefinedMenuItem.new({ item: "Quit" }),
      ],
    });

    const fileMenu = await Submenu.new({
      text: "File",
      items: [
        await item("Open folder…", a.openFolder),
        await item("New window", a.newWindow),
        await sep(),
        await item("New note", a.newNote),
        await item("New folder", a.newFolder),
        await sep(),
        await item("Export…", a.exportActive),
      ],
    });

    const editMenu = await Submenu.new({
      text: "Edit",
      items: [
        await PredefinedMenuItem.new({ item: "Undo" }),
        await PredefinedMenuItem.new({ item: "Redo" }),
        await sep(),
        await PredefinedMenuItem.new({ item: "Cut" }),
        await PredefinedMenuItem.new({ item: "Copy" }),
        await PredefinedMenuItem.new({ item: "Paste" }),
        await PredefinedMenuItem.new({ item: "SelectAll" }),
        await sep(),
        await item("Find in vault…", a.openSearch),
      ],
    });

    const windowMenu = await Submenu.new({
      text: "Window",
      items: [
        await PredefinedMenuItem.new({ item: "Minimize" }),
        await PredefinedMenuItem.new({ item: "Maximize" }),
        await sep(),
        await PredefinedMenuItem.new({ item: "CloseWindow" }),
      ],
    });

    const menu = await Menu.new({ items: [appMenu, fileMenu, editMenu, windowMenu] });
    await menu.setAsAppMenu();
  } catch (e) {
    console.error("app menu install failed", e);
  }
}
