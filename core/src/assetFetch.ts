/**
 * Downloads a remote asset (an image dragged/pasted as a URL) into memory so the caller can
 * write it into the vault the same way an upload does. Kept separate from server.ts so the
 * network + streaming logic is unit-testable with an injected `fetchImpl`, without a live server.
 */
import { isIP } from 'node:net'
import dns from 'node:dns/promises'
import { AppError } from './error'

/** Default request timeout for a remote asset fetch (AbortSignal.timeout). */
const DEFAULT_TIMEOUT_MS = 20_000

/** Max redirect hops followed before giving up (each hop is re-validated against
 *  `isBlockedAddress` before the request is made). */
const MAX_REDIRECTS = 5

/** Content-Type -> file extension (no dot), for the common image types a drag/paste can name.
 *  Unknown/unsupported types return null so the caller can fall back to keeping the original
 *  extension (or reject) instead of guessing. */
const EXT_FOR_CONTENT_TYPE: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
}

/** Maps a (possibly parameterized) content type to a file extension, or null when unknown.
 *  Strips a trailing `; charset=...`/params and lowercases before lookup. */
export function extForContentType(ct: string): string | null {
    const bare = ct.split(';')[0].trim().toLowerCase()
    return EXT_FOR_CONTENT_TYPE[bare] ?? null
}

function ipv4Octets(ip: string): number[] | null {
    const parts = ip.split('.')
    if (parts.length !== 4) return null
    const nums = parts.map(p => Number(p))
    if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null
    return nums
}

function isBlockedIPv4(ip: string): boolean {
    const o = ipv4Octets(ip)
    if (!o) return false
    const [a, b] = o
    if (a === 127) return true // loopback
    if (a === 10) return true // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
    if (a === 192 && b === 168) return true // RFC1918
    if (a === 169 && b === 254) return true // link-local
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT (100.64.0.0/10)
    if (a === 0) return true // 0.0.0.0/8
    return false
}

/** Expands a (possibly compressed) IPv6 address into its 8 hextet strings, resolving an
 *  IPv4-mapped tail (`::ffff:1.2.3.4`) into hex groups first. Returns null on malformed input. */
function expandIPv6(ip: string): string[] | null {
    let addr = ip.split('%')[0] // strip a zone id (fe80::1%eth0)
    const lastColon = addr.lastIndexOf(':')
    const tail = addr.slice(lastColon + 1)
    if (tail.includes('.')) {
        const v4 = ipv4Octets(tail)
        if (!v4) return null
        const hex1 = ((v4[0] << 8) | v4[1]).toString(16)
        const hex2 = ((v4[2] << 8) | v4[3]).toString(16)
        addr = `${addr.slice(0, lastColon + 1)}${hex1}:${hex2}`
    }
    if (addr.includes('::')) {
        const [h, t] = addr.split('::')
        const head = h ? h.split(':') : []
        const tailParts = t ? t.split(':') : []
        const missing = 8 - head.length - tailParts.length
        if (missing < 0) return null
        return [...head, ...new Array(missing).fill('0'), ...tailParts]
    }
    const groups = addr.split(':')
    return groups.length === 8 ? groups : null
}

function isBlockedIPv6(ip: string): boolean {
    const groups = expandIPv6(ip)
    if (!groups) return false
    const bytes: number[] = []
    for (const g of groups) {
        const n = parseInt(g || '0', 16)
        if (Number.isNaN(n)) return false
        bytes.push((n >> 8) & 0xff, n & 0xff)
    }
    // ::1 loopback
    if (bytes.slice(0, 15).every(b => b === 0) && bytes[15] === 1) return true
    // IPv4-mapped ::ffff:a.b.c.d
    if (
        bytes.slice(0, 10).every(b => b === 0) &&
        bytes[10] === 0xff &&
        bytes[11] === 0xff
    )
        return isBlockedIPv4(bytes.slice(12, 16).join('.'))
    // fe80::/10 link-local
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true
    // fc00::/7 unique local (covers fc00:: through fdff::)
    if ((bytes[0] & 0xfe) === 0xfc) return true
    return false
}

/** True when `ip` (a literal IPv4 or IPv6 address, as returned by a DNS lookup or given
 *  directly in a URL) falls in a private/loopback/link-local/CGNAT range that must never be
 *  reachable from a server-side fetch — loopback, RFC1918, link-local, CGNAT, 0.0.0.0/8,
 *  fc00::/7, and their IPv4-mapped-IPv6 equivalents. Pure + exported so it is unit-testable
 *  independent of DNS. */
export function isBlockedAddress(ip: string): boolean {
    return ip.includes(':') ? isBlockedIPv6(ip) : isBlockedIPv4(ip)
}

/** Resolves `hostname` (already known not to be a literal IP) and throws if ANY resolved
 *  address is blocked — a hostname that resolves to multiple addresses, only one of which is
 *  private, is still rejected (DNS rebinding / multi-A-record attacks). */
async function assertHostAllowed(
    hostname: string,
    lookupImpl: (
        hostname: string,
    ) => Promise<{ address: string; family: number }[]>,
): Promise<void> {
    if (isIP(hostname)) {
        if (isBlockedAddress(hostname))
            throw new AppError('EINVAL', 'blocked address', 400)
        return
    }
    const records = await lookupImpl(hostname)
    if (records.length === 0)
        throw new AppError('EINVAL', 'blocked address', 400)
    for (const { address } of records) {
        if (isBlockedAddress(address))
            throw new AppError('EINVAL', 'blocked address', 400)
    }
}

const defaultLookupImpl = (hostname: string) =>
    dns.lookup(hostname, { all: true })

/** Downloads `url` into memory, enforcing `opts.maxBytes` against both the declared
 *  `Content-Length` and the actual streamed byte count (so a server lying about — or omitting —
 *  Content-Length can't blow past the cap). `fetchImpl` defaults to the global `fetch` and is
 *  overridden in tests. Redirects are followed manually (up to `MAX_REDIRECTS` hops), with every
 *  hop's host re-resolved and re-checked against `isBlockedAddress` before the request is made,
 *  so a public host that redirects to a private/loopback address is rejected rather than
 *  followed. `lookupImpl` overrides the DNS resolution used for that check (tests only). Returns
 *  the bytes and the response's content type, lowercased with any `; charset=...`/params
 *  stripped. */
export async function fetchRemoteAsset(
    url: string,
    opts: {
        maxBytes: number
        fetchImpl?: typeof fetch
        timeoutMs?: number
        lookupImpl?: (
            hostname: string,
        ) => Promise<{ address: string; family: number }[]>
    },
): Promise<{ bytes: Uint8Array; contentType: string }> {
    const doFetch = opts.fetchImpl ?? fetch
    const lookupImpl = opts.lookupImpl ?? defaultLookupImpl
    const { maxBytes } = opts
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    let current: URL
    try {
        current = new URL(url)
    } catch {
        throw new AppError('EINVAL', 'invalid url', 400)
    }

    let res: Response | undefined
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (current.protocol !== 'http:' && current.protocol !== 'https:')
            throw new AppError('EINVAL', 'invalid url', 400)
        await assertHostAllowed(current.hostname, lookupImpl)

        let hopRes: Response
        try {
            hopRes = await doFetch(current.toString(), {
                redirect: 'manual',
                signal: AbortSignal.timeout(timeoutMs),
            })
        } catch (e) {
            throw new AppError(
                'FETCH_FAILED',
                `fetch failed: ${(e as Error).message}`,
                502,
            )
        }

        if (
            hopRes.status >= 300 &&
            hopRes.status < 400 &&
            hopRes.headers.get('location')
        ) {
            if (hop === MAX_REDIRECTS)
                throw new AppError(
                    'FETCH_FAILED',
                    'too many redirects',
                    502,
                )
            const location = hopRes.headers.get('location')!
            try {
                current = new URL(location, current)
            } catch {
                throw new AppError('EINVAL', 'invalid redirect', 400)
            }
            continue
        }

        res = hopRes
        break
    }
    if (!res)
        throw new AppError('FETCH_FAILED', 'too many redirects', 502)

    if (!res.ok)
        throw new AppError(
            'FETCH_FAILED',
            `fetch failed: ${res.status} ${res.statusText}`,
            502,
        )

    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > maxBytes)
        throw new AppError('EINVAL', 'remote asset too large', 413)

    const contentType = (res.headers.get('content-type') ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase()

    if (!contentType.startsWith('image/'))
        throw new AppError('EINVAL', 'not an image', 415)

    // Stream the body ourselves rather than a single `arrayBuffer()` call, so an oversized body
    // is caught (and the connection aborted) mid-transfer instead of after it's fully buffered —
    // the whole point of the cap when Content-Length is absent or understates the truth.
    if (!res.body) {
        const buf = new Uint8Array(await res.arrayBuffer())
        if (buf.byteLength > maxBytes)
            throw new AppError('EINVAL', 'remote asset too large', 413)
        return { bytes: buf, contentType }
    }

    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        total += value.byteLength
        if (total > maxBytes) {
            await reader.cancel().catch(() => {})
            throw new AppError('EINVAL', 'remote asset too large', 413)
        }
        chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
    }
    return { bytes, contentType }
}
