// app/src/nativeClipboard.ts
// Reads what the page-level ClipboardEvent cannot see: the real paths of files copied in Finder.
// WKWebView exposes such a paste as `Files` with no `text/uri-list`, so the `read_clipboard_paths`
// Tauri command (src-tauri/src/lib.rs) reads `public.file-url` off the general pasteboard. Outside
// Tauri (the browser build) there is no native pasteboard to ask, and the list is empty.
import { isTauri } from './platform'

/** Absolute paths of the files on the OS clipboard; empty outside Tauri or on any failure. */
export async function readClipboardPaths(): Promise<string[]> {
    if (!isTauri()) return []
    try {
        const { invoke } = await import('@tauri-apps/api/core')
        const paths = await invoke<string[]>('read_clipboard_paths')
        return Array.isArray(paths) ? paths : []
    } catch (e) {
        console.error('read_clipboard_paths failed', e)
        return []
    }
}
