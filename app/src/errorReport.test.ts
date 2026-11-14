import { describe, expect, test } from 'bun:test'
import {
    createErrorReporter,
    errorKey,
    installErrorReporter,
    MAX_DISTINCT,
    reportFromErrorEvent,
    reportFromRejection,
    toastText,
    type AppErrorReport,
} from './errorReport'

describe('reports', () => {
    test('an error event carries the error, its stack and where it was thrown', () => {
        const err = new TypeError('x is undefined')
        const r = reportFromErrorEvent({
            message: 'Uncaught TypeError: x is undefined',
            filename: 'http://localhost:1420/src/App.tsx',
            lineno: 12,
            colno: 5,
            error: err,
        })!
        expect(r.kind).toBe('error')
        expect(r.message).toBe('TypeError: x is undefined')
        expect(r.stack).toBe(err.stack!)
        expect(r.source).toBe('http://localhost:1420/src/App.tsx:12:5')
    })

    test('an error event with no error object falls back to its message', () => {
        expect(reportFromErrorEvent({ message: 'Script error.' })).toEqual({
            kind: 'error',
            message: 'Script error.',
        })
    })

    test('a rejection describes errors, strings and plain values', () => {
        expect(reportFromRejection(new Error('nope'))!.message).toBe('Error: nope')
        expect(reportFromRejection('plain')).toEqual({ kind: 'rejection', message: 'plain' })
        expect(reportFromRejection({ code: 4 })!.message).toBe('{"code":4}')
        expect(reportFromRejection(undefined)!.message).toBe('undefined')
    })

    test('ResizeObserver loop warnings are noise, not errors', () => {
        expect(
            reportFromErrorEvent({
                message: 'ResizeObserver loop completed with undelivered notifications.',
            }),
        ).toBeNull()
        expect(reportFromRejection('ResizeObserver loop limit exceeded')).toBeNull()
    })
})

describe('toastText', () => {
    const r: AppErrorReport = { kind: 'error', message: 'TypeError: boom' }
    test('says where to read it once it reached the log', () => {
        expect(toastText(r, true)).toBe(
            'error // TypeError: boom // recorded, see bismuth errors',
        )
        expect(toastText(r, false)).toBe('error // TypeError: boom')
    })
    test('shortens a long message', () => {
        const t = toastText({ kind: 'error', message: 'z'.repeat(400) }, false)
        expect(t.length).toBeLessThan(140)
        expect(t.endsWith('…')).toBe(true)
    })
})

describe('createErrorReporter', () => {
    function harness(opts: { fail?: boolean; max?: number } = {}) {
        const sent: AppErrorReport[] = []
        const toasts: string[] = []
        const reporter = createErrorReporter({
            send: async r => {
                if (opts.fail) throw new Error('404')
                sent.push(r)
            },
            notify: t => void toasts.push(t),
            maxDistinct: opts.max,
        })
        return { reporter, sent, toasts }
    }

    test('reports each distinct error once per launch', async () => {
        const h = harness()
        const a = reportFromRejection(new Error('a'))
        await h.reporter.report(a)
        await h.reporter.report(a)
        await h.reporter.report(reportFromRejection(new Error('b')))
        await h.reporter.report(null)
        expect(h.sent.map(r => r.message)).toEqual(['Error: a', 'Error: b'])
        expect(h.toasts).toEqual([
            'error // Error: a // recorded, see bismuth errors',
            'error // Error: b // recorded, see bismuth errors',
        ])
    })

    test('a failed send still toasts, without claiming it was recorded', async () => {
        const h = harness({ fail: true })
        await h.reporter.report({ kind: 'error', message: 'boom' })
        expect(h.toasts).toEqual(['error // boom'])
    })

    test('the cap docs/overview/troubleshooting.md states', () => {
        expect(MAX_DISTINCT).toBe(20)
    })

    test('stops after the distinct cap', async () => {
        const h = harness({ max: 2 })
        for (const m of ['a', 'b', 'c'])
            await h.reporter.report({ kind: 'error', message: m })
        expect(h.sent.map(r => r.message)).toEqual(['a', 'b'])
    })

    test('the same message from two places is two errors', () => {
        expect(
            errorKey({ kind: 'error', message: 'm', source: 'a.js:1:1' }),
        ).not.toBe(errorKey({ kind: 'error', message: 'm', source: 'b.js:1:1' }))
    })
})

describe('installErrorReporter', () => {
    test('listens for errors and rejections until uninstalled', async () => {
        const target = new EventTarget()
        const got: (AppErrorReport | null)[] = []
        const uninstall = installErrorReporter(target, {
            report: async r => void got.push(r),
        })
        const err = Object.assign(new Event('error'), {
            message: 'Uncaught Error: thrown update',
            error: new Error('thrown update'),
        })
        target.dispatchEvent(err)
        target.dispatchEvent(
            Object.assign(new Event('unhandledrejection'), {
                reason: new Error('lost promise'),
            }),
        )
        uninstall()
        target.dispatchEvent(Object.assign(new Event('error'), { message: 'after' }))
        expect(got.map(r => r?.message)).toEqual([
            'Error: thrown update',
            'Error: lost promise',
        ])
        expect(got.map(r => r?.kind)).toEqual(['error', 'rejection'])
    })
})
