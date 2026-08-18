// app/src/api.test.ts
import { test, expect, describe } from 'bun:test'
import {
    api,
    resolveBase,
    resolveCacheScope,
    resolveOwnerToken,
    httpTransport,
    setTransport,
    apiBase,
    eventsUrl,
    type Transport,
} from './api'
import type { Schema } from '../../core/src/schema/types'

test('api exposes a schema() method returning a Schema promise', () => {
    expect(typeof api.schema).toBe('function')
    // Type-level: the return is Promise<Schema>. Compile-time check, no network call.
    const _typed: () => Promise<Schema> = api.schema
    expect(_typed).toBe(api.schema)
})

describe('Transport seam (decouples api from HTTP for the mobile in-process backend)', () => {
    test('httpTransport builds URLs against its base, no network needed', () => {
        const t = httpTransport('http://x:1')
        expect(t.base()).toBe('http://x:1')
        expect(t.eventsUrl()).toBe('http://x:1/events')
        expect(t.assetUrl('a b.png')).toBe('http://x:1/asset?path=a%20b.png')
    })

    test('setTransport swaps where api calls are routed (proves the seam)', async () => {
        const originalBase = apiBase() // capture before swapping (the default HTTP base)
        const calls: string[] = []
        const fake: Transport = {
            getJson: async <T>(p: string) => {
                calls.push(`getJson ${p}`)
                return {} as T
            },
            getText: async (p: string) => {
                calls.push(`getText ${p}`)
                return ''
            },
            post: async (p: string) => {
                calls.push(`post ${p}`)
                return new Response('{}')
            },
            put: async (p: string) => {
                calls.push(`put ${p}`)
                return new Response('{}')
            },
            postJson: async <T>(p: string) => {
                calls.push(`postJson ${p}`)
                return {} as T
            },
            writeFileChecked: async () => {
                calls.push('writeFileChecked')
                return { conflict: false }
            },
            uploadAsset: async () => 'x',
            convertHeic: async () => new ArrayBuffer(0),
            stageTmpFile: async () => '/tmp/x',
            assetUrl: (t: string) => `mem://${t}`,
            eventsUrl: () => 'mem://events',
            base: () => 'mem://',
        }
        try {
            setTransport(fake)
            // api methods + the exported helpers now route through the fake transport.
            await api.graph()
            await api.tree()
            expect(apiBase()).toBe('mem://')
            expect(eventsUrl()).toBe('mem://events')
            expect(api.assetUrl('p.png')).toBe('mem://p.png')
            expect(calls).toEqual(['getJson /graph', 'getJson /tree'])
        } finally {
            // Restore the default so other tests/modules see HTTP again.
            setTransport(httpTransport(originalBase))
        }
    })
})

describe('resolveBase (runtime backend selection for ?api= windows)', () => {
    test('?api= wins over the build env', () => {
        expect(resolveBase('?api=http://localhost:5000', 'http://env:9')).toBe(
            'http://localhost:5000',
        )
    })
    test('trims one or many trailing slashes from ?api=', () => {
        expect(resolveBase('?api=http://localhost:5000/', undefined)).toBe(
            'http://localhost:5000',
        )
        expect(resolveBase('?api=http://localhost:5000///', undefined)).toBe(
            'http://localhost:5000',
        )
    })
    test('falls back to the build env when no ?api=', () => {
        expect(resolveBase('?foo=bar', 'http://env:9')).toBe('http://env:9')
        expect(resolveBase('', 'http://env:9')).toBe('http://env:9')
    })
    test('falls back to the default port when neither is set', () => {
        expect(resolveBase(undefined, undefined)).toBe('http://localhost:4321')
        expect(resolveBase('', undefined)).toBe('http://localhost:4321')
    })
    test('an empty ?api= value is ignored (treated as unset)', () => {
        expect(resolveBase('?api=', 'http://env:9')).toBe('http://env:9')
    })
    test('injected __BISMUTH_API__ (bundled app spawned port) wins over env + default, trims slashes', () => {
        expect(resolveBase('', undefined, 'http://localhost:7777')).toBe(
            'http://localhost:7777',
        )
        expect(resolveBase('', 'http://env:9', 'http://localhost:7777/')).toBe(
            'http://localhost:7777',
        )
    })
    test('?api= still wins over an injected __BISMUTH_API__', () => {
        expect(
            resolveBase(
                '?api=http://localhost:5000',
                'http://env:9',
                'http://localhost:7777',
            ),
        ).toBe('http://localhost:5000')
    })
    test('two windows with different ?api= resolve to different backends', () => {
        expect(resolveBase('?api=http://localhost:4323', undefined)).not.toBe(
            resolveBase('?api=http://localhost:4324', undefined),
        )
    })
})

describe("resolveOwnerToken (core/src/ownerToken.ts's X-Bismuth-Token, injected per window)", () => {
    test('the injected (Tauri-shell) value wins over the build env', () => {
        expect(resolveOwnerToken('env-token', 'injected-token')).toBe(
            'injected-token',
        )
    })
    test("falls back to the build env (dev's VITE_OWNER_TOKEN) when nothing is injected", () => {
        expect(resolveOwnerToken('env-token', undefined)).toBe('env-token')
    })
    test('resolves to undefined when neither is set — the transport then sends no token header', () => {
        expect(resolveOwnerToken(undefined, undefined)).toBeUndefined()
    })
    test('an empty injected string is treated as unset, not as an empty token', () => {
        expect(resolveOwnerToken('env-token', '')).toBe('env-token')
    })
})

// The boot seeds for the sidebar tree + graph are namespaced by this scope. Keying them by
// the backend URL made them miss on EVERY launch of the bundled app, which picks a fresh
// free port each time — so both surfaces painted empty until their first fetch returned.
describe('resolveCacheScope (stable per-vault cache namespacing)', () => {
    test('prefers the injected vault over the ephemeral backend URL', () => {
        expect(
            resolveCacheScope('', 'http://localhost:51823', '/Users/me/vault'),
        ).toBe('/Users/me/vault')
    })
    test('is stable across launches even as the backend port changes', () => {
        const a = resolveCacheScope(
            '',
            'http://localhost:51823',
            '/Users/me/vault',
        )
        const b = resolveCacheScope(
            '',
            'http://localhost:62991',
            '/Users/me/vault',
        )
        expect(a).toBe(b)
    })
    test('still separates two different vaults', () => {
        expect(
            resolveCacheScope('', 'http://localhost:1', '/vault/a'),
        ).not.toBe(resolveCacheScope('', 'http://localhost:1', '/vault/b'))
    })
    test('an ?api= window (Open folder) ignores the injected vault — it is a different backend', () => {
        expect(
            resolveCacheScope(
                '?api=http://localhost:9999',
                'http://localhost:9999',
                '/Users/me/vault',
            ),
        ).toBe('http://localhost:9999')
    })
    test('falls back to the backend URL when no vault is injected (dev)', () => {
        expect(resolveCacheScope('', 'http://localhost:4321', undefined)).toBe(
            'http://localhost:4321',
        )
    })
    test('a malformed search string is treated as no override', () => {
        expect(resolveCacheScope('%', 'http://localhost:1', '/vault/a')).toBe(
            '/vault/a',
        )
    })
})
