/** Ask the app to open a note (optionally scrolled to a heading) via the app-wide `bismuth-open`
 *  event. The ONE dispatcher: nothing else hand-builds this CustomEvent. */
export function openNote(path: string, heading?: string): void {
    window.dispatchEvent(
        new CustomEvent('bismuth-open', { detail: heading ? { path, heading } : path }),
    )
}

/** Ask the sidebar's file tree to expand, select and scroll to a folder (a clicked `[[Folder/]]`
 *  link). A trailing slash on `path` is dropped. */
export function revealFolder(path: string): void {
    window.dispatchEvent(
        new CustomEvent('bismuth-reveal-folder', { detail: path.replace(/\/+$/, '') }),
    )
}

/** Follow a rendered wikilink's `data-href`: a folder (`Projects/Work/`) is revealed in the file
 *  tree, anything else opens as a file. */
export function openWikilinkHref(href: string): void {
    if (href.endsWith('/')) revealFolder(href)
    else openNote(href)
}
