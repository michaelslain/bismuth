// Which prefetched text a BaseView may parse as its OWN document.
//
// BaseView caches the parse in a module-level docCache keyed by path, and every later mount of that
// path trusts the entry. So text handed to it for path P must be P's text, provably — a body that
// merely happens to be in FileView's resource at mount time can still be the PREVIOUS note's (the
// resource settles its re-fetch after the keyed mount reacts to the new path). The resource value is
// therefore tagged with the path it was read for, and anything else is refused: BaseView then reads
// /file itself, which costs one round-trip and can never be wrong.

export type LoadedBody = { path: string; text: string }

export function bodyForPath(
    path: string,
    cached: string | undefined,
    loaded: LoadedBody | undefined,
): string | undefined {
    if (cached !== undefined) return cached
    return loaded?.path === path ? loaded.text : undefined
}

export function isForeignBody(
    path: string,
    loaded: LoadedBody | undefined,
): boolean {
    return loaded !== undefined && loaded.path !== path
}
