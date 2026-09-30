/** Split a hover label into its folder prefix (trailing slash kept) and its last segment, so the
 *  status line can ellipsize the folder and keep the file name. A label with no `/` (a memory,
 *  a tag) is all name. */
export function splitStatusPath(label: string): { dir: string; name: string } {
    const cut = label.lastIndexOf('/')
    if (cut < 0) return { dir: '', name: label }
    return { dir: label.slice(0, cut + 1), name: label.slice(cut + 1) }
}
