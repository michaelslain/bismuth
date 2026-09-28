// Which link URLs an event chip may open in a new tab. Anything else — `javascript:`, `data:`,
// `file:`, a bare word — is not opened at all. Pure, so the allow-list is unit-tested.
const OPENABLE = /^(https?:|mailto:)/i

export function isOpenableUrl(url: string | undefined): url is string {
    return !!url && OPENABLE.test(url.trim())
}
