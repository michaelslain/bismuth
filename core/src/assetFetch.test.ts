import { describe, expect, test } from 'bun:test'
import { fetchRemoteAsset, extForContentType } from './assetFetch'
import { AppError } from './error'

/** Builds a Response with a body that streams `bytes` in fixed-size chunks, so the streaming
 *  cap path (rather than a single `arrayBuffer()`) is exercised. `contentLength` lets a test
 *  omit/lie about Content-Length independently of the real byte count. */
function streamingResponse(
    bytes: Uint8Array,
    opts: { status?: number; contentType?: string; contentLength?: number | null; chunkSize?: number } = {},
): Response {
    const chunkSize = opts.chunkSize ?? 16
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (let i = 0; i < bytes.length; i += chunkSize)
                controller.enqueue(bytes.slice(i, i + chunkSize))
            controller.close()
        },
    })
    const headers: Record<string, string> = {}
    if (opts.contentType) headers['content-type'] = opts.contentType
    if (opts.contentLength !== null)
        headers['content-length'] = String(
            opts.contentLength ?? bytes.length,
        )
    return new Response(stream, { status: opts.status ?? 200, headers })
}

describe('fetchRemoteAsset', () => {
    test('rejects a file: url', async () => {
        await expect(
            fetchRemoteAsset('file:///etc/passwd', { maxBytes: 1000 }),
        ).rejects.toThrow(AppError)
    })

    test('rejects a javascript: url', async () => {
        await expect(
            fetchRemoteAsset('javascript:alert(1)', { maxBytes: 1000 }),
        ).rejects.toThrow(AppError)
    })

    test('rejects a malformed url', async () => {
        await expect(
            fetchRemoteAsset('not a url', { maxBytes: 1000 }),
        ).rejects.toThrow(AppError)
    })

    test('rejects a non-2xx response', async () => {
        const fetchImpl = (async () =>
            new Response('nope', { status: 404 })) as unknown as typeof fetch
        await expect(
            fetchRemoteAsset('https://example.com/x.png', {
                maxBytes: 1000,
                fetchImpl,
            }),
        ).rejects.toThrow(AppError)
    })

    test('rejects an oversized body even when content-length is absent', async () => {
        const bytes = new Uint8Array(500).fill(1)
        const fetchImpl = (async () =>
            streamingResponse(bytes, {
                contentType: 'image/png',
                contentLength: null,
            })) as unknown as typeof fetch
        await expect(
            fetchRemoteAsset('https://example.com/x.png', {
                maxBytes: 100,
                fetchImpl,
            }),
        ).rejects.toThrow(AppError)
    })

    test('rejects when the declared content-length exceeds the cap', async () => {
        const bytes = new Uint8Array(50).fill(1)
        const fetchImpl = (async () =>
            streamingResponse(bytes, {
                contentType: 'image/png',
                contentLength: 100_000,
            })) as unknown as typeof fetch
        await expect(
            fetchRemoteAsset('https://example.com/x.png', {
                maxBytes: 1000,
                fetchImpl,
            }),
        ).rejects.toThrow(AppError)
    })

    test('returns bytes + normalized content type on success', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5])
        const fetchImpl = (async () =>
            streamingResponse(bytes, {
                contentType: 'IMAGE/PNG; charset=binary',
            })) as unknown as typeof fetch
        const result = await fetchRemoteAsset('https://example.com/x.png', {
            maxBytes: 1000,
            fetchImpl,
        })
        expect(result.contentType).toBe('image/png')
        expect([...result.bytes]).toEqual([1, 2, 3, 4, 5])
    })
})

describe('extForContentType', () => {
    test('maps a known image content type', () => {
        expect(extForContentType('image/jpeg')).toBe('jpg')
    })

    test('strips params before matching', () => {
        expect(extForContentType('image/png; charset=binary')).toBe('png')
    })

    test('is case-insensitive', () => {
        expect(extForContentType('IMAGE/GIF')).toBe('gif')
    })

    test('returns null for an unknown content type', () => {
        expect(extForContentType('application/octet-stream')).toBeNull()
    })
})
