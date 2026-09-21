import { describe, expect, test } from 'bun:test'
import { fetchRemoteAsset, extForContentType, isBlockedAddress } from './assetFetch'
import { AppError } from './error'

/** A `lookupImpl` stand-in that resolves every hostname to a single public IP, so tests that
 *  exercise the fetch path don't hit real DNS. */
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

/** Builds a `lookupImpl` that resolves to a fixed set of addresses regardless of hostname. */
const lookupFor = (addresses: string[]) => async () =>
    addresses.map(address => ({
        address,
        family: address.includes(':') ? 6 : 4,
    }))

/** Builds a Response with a body that streams `bytes` in fixed-size chunks, so the streaming
 *  cap path (rather than a single `arrayBuffer()` call) is exercised. `contentLength` lets a
 *  test omit/lie about Content-Length independently of the real byte count. */
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
                lookupImpl: publicLookup,
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
                lookupImpl: publicLookup,
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
                lookupImpl: publicLookup,
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
            lookupImpl: publicLookup,
        })
        expect(result.contentType).toBe('image/png')
        expect([...result.bytes]).toEqual([1, 2, 3, 4, 5])
    })

    test('rejects a non-image content type', async () => {
        const bytes = new Uint8Array([1, 2, 3])
        const fetchImpl = (async () =>
            streamingResponse(bytes, {
                contentType: 'application/octet-stream',
            })) as unknown as typeof fetch
        await expect(
            fetchRemoteAsset('https://example.com/x.bin', {
                maxBytes: 1000,
                fetchImpl,
                lookupImpl: publicLookup,
            }),
        ).rejects.toThrow(AppError)
    })

    test('rejects a literal loopback IP host', async () => {
        await expect(
            fetchRemoteAsset('http://127.0.0.1:4321/secret', {
                maxBytes: 1000,
                lookupImpl: publicLookup,
            }),
        ).rejects.toThrow(AppError)
    })

    test('rejects a literal link-local metadata IP host', async () => {
        await expect(
            fetchRemoteAsset('http://169.254.169.254/latest/meta-data', {
                maxBytes: 1000,
                lookupImpl: publicLookup,
            }),
        ).rejects.toThrow(AppError)
    })

    test('rejects a literal RFC1918 IP host', async () => {
        await expect(
            fetchRemoteAsset('http://10.0.0.5/', {
                maxBytes: 1000,
                lookupImpl: publicLookup,
            }),
        ).rejects.toThrow(AppError)
    })

    test('rejects a public hostname whose lookup resolves to a private address', async () => {
        await expect(
            fetchRemoteAsset('https://looks-public.example/x.png', {
                maxBytes: 1000,
                lookupImpl: lookupFor(['192.168.1.1']),
            }),
        ).rejects.toThrow(AppError)
    })

    test('rejects a redirect to a loopback address', async () => {
        const fetchImpl = (async (input: RequestInfo) => {
            const url = String(input)
            if (url.includes('public.example'))
                return new Response(null, {
                    status: 302,
                    headers: { location: 'http://127.0.0.1:4321/internal' },
                })
            return streamingResponse(new Uint8Array([1]), {
                contentType: 'image/png',
            })
        }) as unknown as typeof fetch
        await expect(
            fetchRemoteAsset('https://public.example/redirect', {
                maxBytes: 1000,
                fetchImpl,
                lookupImpl: publicLookup,
            }),
        ).rejects.toThrow(AppError)
    })

    test('follows a redirect to another allowed public host', async () => {
        const fetchImpl = (async (input: RequestInfo) => {
            const url = String(input)
            if (url.includes('public.example/redirect'))
                return new Response(null, {
                    status: 302,
                    headers: { location: 'https://cdn.example/x.png' },
                })
            return streamingResponse(new Uint8Array([9, 8, 7]), {
                contentType: 'image/png',
            })
        }) as unknown as typeof fetch
        const result = await fetchRemoteAsset(
            'https://public.example/redirect',
            { maxBytes: 1000, fetchImpl, lookupImpl: publicLookup },
        )
        expect([...result.bytes]).toEqual([9, 8, 7])
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

describe('isBlockedAddress', () => {
    test.each([
        ['127.0.0.1', true],
        ['127.255.255.255', true],
        ['10.0.0.1', true],
        ['172.16.0.1', true],
        ['172.31.255.255', true],
        ['172.15.255.255', false],
        ['172.32.0.1', false],
        ['192.168.1.1', true],
        ['169.254.169.254', true],
        ['100.64.0.1', true],
        ['100.127.255.255', true],
        ['100.63.255.255', false],
        ['0.0.0.0', true],
        ['8.8.8.8', false],
        ['93.184.216.34', false],
        ['::1', true],
        ['fe80::1', true],
        ['fc00::1', true],
        ['fd12:3456:789a::1', true],
        ['::ffff:127.0.0.1', true],
        ['::ffff:8.8.8.8', false],
        ['2001:4860:4860::8888', false],
    ])('isBlockedAddress(%s) === %s', (ip, expected) => {
        expect(isBlockedAddress(ip)).toBe(expected)
    })
})
