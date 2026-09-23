/**
 * App-wide guard: a click on any `<a>` whose href leaves the app (http/https/mailto/tel)
 * opens it in the user's browser instead of navigating the app window. Without it, a link
 * in rendered HTML (Bases markdown, chat, previews) replaced the whole webview with no way back.
 */

const EXTERNAL = /^(https?:|mailto:|tel:)/i

/** True when `href` points outside the app — pure, unit-tested. */
export function isExternalHref(href: string, appOrigin: string): boolean {
    if (!EXTERNAL.test(href)) return false
    try {
        return new URL(href).origin !== appOrigin || /^(mailto|tel):/i.test(href)
    } catch {
        return false
    }
}

export function installExternalLinkGuard(open: (url: string) => void, doc: Document = document): void {
    const onClick = (e: MouseEvent) => {
        if (e.defaultPrevented) return
        if (e.type === 'auxclick' && e.button !== 1) return
        const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
        if (!a) return
        const href = a.getAttribute('href') ?? ''
        if (!isExternalHref(href, doc.defaultView?.location.origin ?? '')) return
        e.preventDefault()
        e.stopPropagation()
        open(a.href)
    }
    doc.addEventListener('click', onClick, true)
    doc.addEventListener('auxclick', onClick, true)
}
