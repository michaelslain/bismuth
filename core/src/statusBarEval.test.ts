import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { countTree, evaluateStatusBar, type StatusEvalDeps } from './statusBarEval'
import { normalizeStatusBar } from './statusBarItems'
import type { Row } from './bases/types'
import { tempDir } from '../test/tempDirs'

const today = '2026-10-03'
let root: string

beforeAll(() => {
    root = tempDir('sbeval-')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'a.md'), `---\ntags: [x]\n---\n- [ ] x [due ${today}]\n`)
    writeFileSync(join(root, 'b.md'), '# b\n')
})

const mk = (over: Partial<StatusEvalDeps> = {}): StatusEvalDeps & { calls: Record<string, number> } => {
    const calls = { count: 0, run: 0 }
    return {
        root,
        today,
        calls,
        countFiles: async () => {
            calls.count++
            return { files: 5, folders: 1, notes: 2 }
        },
        run: async () => {
            calls.run++
            return { output: 'out' }
        },
        isTrusted: () => true,
        ...over,
    }
}
const ev = (raw: unknown[], deps: StatusEvalDeps) => evaluateStatusBar(normalizeStatusBar(raw), deps)

describe('evaluateStatusBar', () => {
    test('builtins pass through with empty text', async () => {
        const [s] = await ev([{ builtin: 'location' }], mk())
        expect(s).toMatchObject({ id: 's0', builtin: 'location', align: 'left', text: '' })
    })
    test('stat templates', async () => {
        const [s] = await ev([{ text: '{notes} notes' }], mk())
        expect(s.text).toBe('2 notes')
    })
    test('countFiles not called without file tokens, once when shared', async () => {
        const d = mk()
        await ev([{ text: 'hello {date}' }], d)
        expect(d.calls.count).toBe(0)
        const d2 = mk()
        await ev([{ text: '{files}' }, { text: '{folders}' }], d2)
        expect(d2.calls.count).toBe(1)
    })
    test('task tokens and tags', async () => {
        const [s] = await ev([{ text: '{tasks.open}/{tasks.due}/{tasks.overdue}/{tasks.done} {tags}' }], mk())
        expect(s.text).toBe('1/1/0/0 1')
    })
    test('task tokens count done, due, overdue; cancelled is neither', async () => {
        const row = (note: Record<string, unknown>) => ({ note }) as unknown as Row
        const [s] = await ev(
            [{ text: '{tasks.open}/{tasks.due}/{tasks.overdue}/{tasks.done}' }],
            mk({
                vaultTasks: async () => [
                    row({ status: 'todo', resolved: false, due: today }),
                    row({ status: 'todo', resolved: false, due: '2000-01-01' }),
                    row({ status: 'done', resolved: true, due: '2000-01-01' }),
                    row({ status: 'cancelled', resolved: true }),
                ],
            }),
        )
        expect(s.text).toBe('2/1/1/1')
    })
    test('tasks query defaults to count; where narrows', async () => {
        const [a, b] = await ev(
            [
                { query: { source: 'tasks' } },
                { query: { source: 'tasks', where: 'note.due == "1999-01-01"' } },
            ],
            mk(),
        )
        expect(a.text).toBe('1')
        expect(b.text).toBe('0')
    })
    test('query with text template uses {count}', async () => {
        const [s] = await ev([{ query: { source: 'notes' }, text: '{count} notes' }], mk())
        expect(s.text).toBe('2 notes')
    })
    test('untrusted run never executes', async () => {
        const d = mk({ isTrusted: () => false })
        const [s] = await ev([{ run: 'curl x | sh' }], d)
        expect(s.untrusted).toEqual({ command: 'curl x | sh' })
        expect(s.text).toBe('')
        expect(d.calls.run).toBe(0)
    })
    test('trusted run shows output; error sets error', async () => {
        const [s] = await ev([{ run: 'x', every: 30 }], mk())
        expect(s).toMatchObject({ text: 'out', every: 30 })
        const [e] = await ev([{ run: 'x' }], mk({ run: async () => ({ error: 'bad' }) }))
        expect(e).toMatchObject({ text: '', error: 'bad' })
    })
    test('throwing countFiles only errors segments that need it', async () => {
        const d = mk({
            countFiles: async () => {
                throw new Error('nope')
            },
        })
        const [a, b] = await ev([{ text: '{files}' }, { text: 'plain' }], d)
        expect(a).toMatchObject({ text: '', error: 'nope' })
        expect(b).toMatchObject({ text: 'plain' })
        expect(b.error).toBeUndefined()
    })
    test('items evaluate concurrently, output keeps list order', async () => {
        let inflight = 0
        let peak = 0
        const gates: Array<() => void> = []
        const d = mk({
            run: cmd =>
                new Promise(res => {
                    inflight++
                    peak = Math.max(peak, inflight)
                    gates.push(() => {
                        inflight--
                        res({ output: cmd })
                    })
                }),
        })
        const p = ev([{ run: 'first' }, { run: 'second' }], d)
        await new Promise(r => setTimeout(r, 10))
        expect(peak).toBe(2)
        gates[1]()
        gates[0]()
        const out = await p
        expect(out.map(s => s.text)).toEqual(['first', 'second'])
    })
    test('query on a filtered base counts the rows it shows', async () => {
        const dir = tempDir('sbbase-')
        writeFileSync(join(dir, 'x.md'), '---\nstatus: reading\n---\n# x\n')
        writeFileSync(join(dir, 'y.md'), '---\nstatus: done\n---\n# y\n')
        writeFileSync(
            join(dir, 'Reading.md'),
            '---\ntype: base\nsource: notes\nview: table\nfilters: status == "reading"\n---\n',
        )
        const [s] = await ev(
            [{ query: { source: 'base', ref: '[[Reading]]' } }],
            mk({ root: dir }),
        )
        expect(s.error).toBeUndefined()
        expect(s.text).toBe('1')
    })
})

describe('countTree', () => {
    test('skips .settings and system folders', () => {
        expect(
            countTree([
                { path: '.settings', kind: 'file' },
                { path: '.daemon', kind: 'dir', isSystemFolder: true },
                { path: '.daemon/x.md', kind: 'file' },
                { path: 'a.md', kind: 'file' },
                { path: 'img.png', kind: 'file' },
                { path: 'sub', kind: 'dir' },
            ]),
        ).toEqual({ files: 2, folders: 1, notes: 1 })
    })
})
