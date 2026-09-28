import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mountModal } from './mountModal'

// Bun has no DOM — a minimal stand-in for the two calls mountModal makes on `document`.
const g = globalThis as { document?: unknown }
let hadDocument = false
let realDocument: unknown
let removed = 0
beforeAll(() => {
    hadDocument = 'document' in g
    realDocument = g.document
    g.document = {
        createElement: () => ({ remove: () => void removed++ }),
        body: { appendChild: () => {} },
    }
})
afterAll(() => {
    if (hadDocument) g.document = realDocument
    else delete g.document
})

test('close disposes and removes exactly once, however often it is called', () => {
    removed = 0
    let disposed = 0
    const close = mountModal(
        () => null,
        () => () => void disposed++,
    )
    close()
    close()
    close()
    expect(disposed).toBe(1)
    expect(removed).toBe(1)
})

test('the view receives the same close that is returned', () => {
    let given: (() => void) | undefined
    const close = mountModal(
        c => {
            given = c
            return null
        },
        (code, _host) => {
            code()
            return () => {}
        },
    )
    expect(given).toBe(close)
})

test('a view that closes itself while rendering is still disposed', () => {
    removed = 0
    let disposed = 0
    mountModal(
        close => {
            close()
            return null
        },
        code => {
            code()
            return () => void disposed++
        },
    )
    expect(disposed).toBe(1)
    expect(removed).toBe(1)
})
