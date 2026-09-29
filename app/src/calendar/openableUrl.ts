// Which link URLs an event chip may open in a new tab. Anything else — `javascript:`, `data:`,
// `file:`, a bare word — is not opened at all. Pure, so the allow-list is unit-tested.
const OPENABLE = /^(https?:|mailto:)/i

export function isOpenableUrl(url: string | undefined): url is string {
    return !!url && OPENABLE.test(url.trim())
}

// A bare host — `host.tld` with an optional port, path, query or fragment; no whitespace, no scheme.
const BARE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i

/** The url a link button should open: an already-safe url as typed (trimmed), a bare host with
 *  `https://` in front, anything else `undefined`. */
export function openableHref(url: string | undefined): string | undefined {
    const t = url?.trim()
    if (!t) return undefined
    if (OPENABLE.test(t)) return t
    return BARE_HOST.test(t) ? `https://${t}` : undefined
}
