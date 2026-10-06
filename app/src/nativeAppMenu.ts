// app/src/nativeAppMenu.ts
// Builds the native macOS menu bar (Tauri only) and wires each item to a command
// handler. This is the "optional native menu later" promised when we made the file
// options commands: the menu is just another surface onto the same actions, so the
// command palette and the menu bar stay in sync.
//
// setAsAppMenu REPLACES the whole menu, so we re-add the standard app/Edit/Window
// items (Quit, Copy/Paste/Undo, Minimize…) as PredefinedMenuItems — otherwise the
// native Cmd+C/V/Z and Quit would disappear.
import { isTauri } from './platform'

export interface AppMenuActions {
    openFolder: () => void
    newWindow: () => void
    newNote: () => void
    newFolder: () => void
    newBase: () => void
    exportActive: () => void
    openSettings: () => void
    openSearch: () => void
}

/** Tauri accelerator strings shown beside File-menu items (see toMenuAccelerator). */
export interface AppMenuAccelerators {
    openFolder?: string | null
    newWindow?: string | null
    exportActive?: string | null
}

// Rebuilt whenever a File-menu keybinding changes in .settings, so the shown
// shortcut always matches the one the keydown handler actually fires on.
export async function installAppMenu(
    a: AppMenuActions,
    keys: AppMenuAccelerators = {},
): Promise<void> {
    if (!isTauri()) return
    try {
        const { Menu, Submenu, MenuItem, PredefinedMenuItem } =
            await import('@tauri-apps/api/menu')
        // An accelerator the platform rejects would throw and take the whole menu bar
        // down with it, so a bad one falls back to the item without a shortcut.
        const item = async (
            text: string,
            action: () => void,
            accelerator?: string | null,
        ) => {
            if (!accelerator) return MenuItem.new({ text, action })
            try {
                return await MenuItem.new({ text, action, accelerator })
            } catch {
                return MenuItem.new({ text, action })
            }
        }
        const sep = () => PredefinedMenuItem.new({ item: 'Separator' })

        // macOS: the FIRST submenu is the app menu (named after the app).
        const appMenu = await Submenu.new({
            text: 'Bismuth',
            items: [
                await PredefinedMenuItem.new({ item: { About: null } }),
                await sep(),
                await item('Settings…', a.openSettings),
                await sep(),
                await PredefinedMenuItem.new({ item: 'Hide' }),
                await PredefinedMenuItem.new({ item: 'HideOthers' }),
                await PredefinedMenuItem.new({ item: 'ShowAll' }),
                await sep(),
                await PredefinedMenuItem.new({ item: 'Quit' }),
            ],
        })

        const fileMenu = await Submenu.new({
            text: 'File',
            items: [
                await item('Open folder…', a.openFolder, keys.openFolder),
                await item('New window', a.newWindow, keys.newWindow),
                await sep(),
                await item('New note', a.newNote),
                await item('New folder', a.newFolder),
                await item('New base', a.newBase),
                await sep(),
                await item('Export…', a.exportActive, keys.exportActive),
            ],
        })

        const editMenu = await Submenu.new({
            text: 'Edit',
            items: [
                await PredefinedMenuItem.new({ item: 'Undo' }),
                await PredefinedMenuItem.new({ item: 'Redo' }),
                await sep(),
                await PredefinedMenuItem.new({ item: 'Cut' }),
                await PredefinedMenuItem.new({ item: 'Copy' }),
                await PredefinedMenuItem.new({ item: 'Paste' }),
                await PredefinedMenuItem.new({ item: 'SelectAll' }),
                await sep(),
                await item('Find in vault…', a.openSearch),
            ],
        })

        const windowMenu = await Submenu.new({
            text: 'Window',
            items: [
                await PredefinedMenuItem.new({ item: 'Minimize' }),
                await PredefinedMenuItem.new({ item: 'Maximize' }),
                await sep(),
                await PredefinedMenuItem.new({ item: 'CloseWindow' }),
            ],
        })

        const menu = await Menu.new({
            items: [appMenu, fileMenu, editMenu, windowMenu],
        })
        await menu.setAsAppMenu()
    } catch (e) {
        console.error('app menu install failed', e)
    }
}
