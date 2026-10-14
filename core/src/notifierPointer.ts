// core/src/notifierPointer.ts
// Tells the daemon where bismuth-notify lives. The daemon runs from ~/.bismuth/bin with the app
// closed, so it cannot find the app bundle itself; core knows it (BISMUTH_APP_PATH, set by the
// Tauri shell) and writes the helper's absolute path to ~/.bismuth/notifier on every boot. The
// helper must run from inside the bundle (Contents/MacOS) to post under Bismuth's name and icon,
// which is why this is a pointer and not a copy. Best-effort; never throws.
import { bismuthHome } from './bismuthHome'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** `~/.bismuth/notifier` — the one-line file holding the helper's absolute path. */
export function notifierPointerPath(): string {
    return bismuthHome('notifier')
}

/** Write the pointer when this is the bundled app and the helper is in it. Returns the path
 *  written, or null when there is nothing to record (dev, no bundle, helper missing). */
export function recordNotifierPath(
    appPath: string | undefined = process.env.BISMUTH_APP_PATH,
    pointer: string = notifierPointerPath(),
): string | null {
    if (!appPath) return null
    const helper = join(appPath, 'Contents', 'MacOS', 'bismuth-notify')
    if (!existsSync(helper)) return null
    try {
        let current = ''
        try {
            current = readFileSync(pointer, 'utf8').trim()
        } catch {
            /* first write */
        }
        if (current !== helper) {
            mkdirSync(dirname(pointer), { recursive: true })
            writeFileSync(pointer, `${helper}\n`)
        }
        return helper
    } catch {
        return null
    }
}
