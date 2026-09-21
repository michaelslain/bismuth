/**
 * Downloads a remote asset (an image dragged/pasted as a URL) into memory so the caller can
 * write it into the vault the same way an upload does. Kept separate from server.ts so the
 * network + streaming logic is unit-testable with an injected `fetchImpl`, without a live server.
 */
import { AppError } from './error'

/** Default request timeout for a remote asset fetch (AbortSignal.timeout). */
const DEFAULT_TIMEOUT_MS = 20_000

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

/** Downloads `url` into memory, enforcing `opts.maxBytes` against both the declared
 *  `Content-Length` and the actual streamed byte count (so a server lying about — or omitting —
 *  Content-Length can't blow past the cap). `fetchImpl` defaults to the global `fetch` and is
 *  overridden in tests. Returns the bytes and the response's content type, lowercased with any
 *  `; charset=...`/params stripped. */
export async function fetchRemoteAsset(
    url: string,
    opts: { maxBytes: number; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<{ bytes: Uint8Array; contentType: string }> {
    const doFetch = opts.fetchImpl ?? fetch
    const { maxBytes } = opts
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        throw new AppError('EINVAL', 'invalid url', 400)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        throw new AppError('EINVAL', 'invalid url', 400)

    let res: Response
    try {
        res = await doFetch(url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(timeoutMs),
        })
    } catch (e) {
        throw new AppError(
            'FETCH_FAILED',
            `fetch failed: ${(e as Error).message}`,
            502,
        )
    }

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
