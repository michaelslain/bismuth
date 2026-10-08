import { beforeEach, describe, expect, test } from 'bun:test'
import {
    getAppSelection,
    resetAppSelection,
    startAppSelectionTracking,
} from './appSelection'

// Plain fakes — happy-dom is not available. A FakeEl carries attrs/tag and a parent; `closest`
// understands exactly the selector shapes appSelection.ts uses.
class FakeEl {
    nodeType = 1
    constructor(
        public tag: string,
        public attrs: Record<string, string> = {},
        public parent: FakeEl | null = null,
    ) {}
    get parentElement() {
        return this.parent
    }
    private matches(sel: string): boolean {
        return sel.split(',').some(raw => {
            const s = raw.trim()
            const pre = s.match(/^\[([\w-]+)\^="(.*)"\]$/)
            if (pre) return (this.attrs[pre[1]!] ?? '').startsWith(pre[2]!)
            const attr = s.match(/^\[([\w-]+)\]$/)
            if (attr) return attr[1]! in this.attrs
            return this.tag === s
        })
    }
    closest(sel: string): FakeEl | null {
        for (let n: FakeEl | null = this; n; n = n.parent)
            if (n.matches(sel)) return n
        return null
    }
    getAttribute(name: string) {
        return this.attrs[name] ?? null
    }
}

function setup() {
    let listener: (() => void) | null = null
    let selection: {
        anchorNode: unknown
        isCollapsed: boolean
        toString(): string
    } | null = null
    const doc = {
        addEventListener: (_: string, fn: () => void) => (listener = fn),
        removeEventListener: () => (listener = null),
        getSelection: () => selection,
    } as unknown as Document
    const select = (anchor: unknown, text: string) => {
        selection = {
            anchorNode: anchor,
            isCollapsed: text === '',
            toString: () => text,
        }
        listener?.()
    }
    return { doc, select, has: () => listener !== null }
}

const pane = (content: string) =>
    new FakeEl('div', { 'data-pane-content': content })
const noCm = () => null

beforeEach(() => resetAppSelection())

describe('appSelection', () => {
    test('DOM selection carries the nearest pane content path', () => {
        const { doc, select } = setup()
        startAppSelectionTracking(doc, noCm)
        select(new FakeEl('span', {}, pane('papers/x.pdf')), 'hello')
        expect(getAppSelection()).toEqual({ text: 'hello', path: 'papers/x.pdf' })
    })

    test('sentinel pane gives a null path', () => {
        const { doc, select } = setup()
        startAppSelectionTracking(doc, noCm)
        select(new FakeEl('span', {}, pane('::graph')), 'node label')
        expect(getAppSelection()).toEqual({ text: 'node label', path: null })
    })

    test('export preview selection is never tracked', () => {
        const { doc, select } = setup()
        startAppSelectionTracking(doc, noCm)
        select(new FakeEl('span', {}, pane('::export:secret.md')), 'secret text')
        expect(getAppSelection()).toBeNull()
    })

    test('selection outside any pane is dropped', () => {
        const { doc, select } = setup()
        startAppSelectionTracking(doc, noCm)
        select(new FakeEl('span', {}, pane('a.pdf')), 'keep')
        select(new FakeEl('span', {}, new FakeEl('div')), 'tree label')
        expect(getAppSelection()).toBeNull()
    })

    test('CodeMirror slice wins via selectionInView', () => {
        const { doc, select } = setup()
        startAppSelectionTracking(doc, () => ({ path: 'a.md', selection: 'cm text' }))
        select(new FakeEl('div', {}, pane('a.md')), 'ignored dom text')
        expect(getAppSelection()).toEqual({ text: 'cm text', path: 'a.md' })
    })

    test('collapsed selection outside a chat clears it', () => {
        const { doc, select } = setup()
        startAppSelectionTracking(doc, noCm)
        select(new FakeEl('span', {}, pane('a.pdf')), 'x')
        select(new FakeEl('span', {}, pane('a.pdf')), '')
        expect(getAppSelection()).toBeNull()
    })

    test('changes inside chat surfaces leave it untouched', () => {
        const { doc, select } = setup()
        startAppSelectionTracking(doc, noCm)
        select(new FakeEl('span', {}, pane('a.pdf')), 'keep me')
        select(new FakeEl('p', {}, pane('::chat:abc')), 'transcript line')
        select(new FakeEl('div', {}, pane('::chat:abc')), '')
        select(new FakeEl('p', {}, new FakeEl('div', { 'data-chat-surface': '' })), '')
        expect(getAppSelection()).toEqual({ text: 'keep me', path: 'a.pdf' })
    })

    test('a plain form field selection is ignored', () => {
        const { doc, select } = setup()
        startAppSelectionTracking(doc, noCm)
        select(new FakeEl('span', {}, pane('a.pdf')), 'keep me')
        select(new FakeEl('input', {}, pane('a.pdf')), '')
        expect(getAppSelection()?.text).toBe('keep me')
    })

    test('long text is cut to 8000 with a marker', () => {
        const { doc, select } = setup()
        startAppSelectionTracking(doc, noCm)
        select(new FakeEl('span', {}, pane('a.pdf')), 'a'.repeat(9000))
        const t = getAppSelection()!.text
        expect(t).toBe('a'.repeat(8000) + '… (truncated)')
    })

    test('idempotent per document; dispose stops listening', () => {
        const { doc, has } = setup()
        const a = startAppSelectionTracking(doc, noCm)
        const b = startAppSelectionTracking(doc, noCm)
        expect(a).toBe(b)
        a()
        expect(has()).toBe(false)
    })
})
