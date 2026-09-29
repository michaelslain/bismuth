import { afterEach, expect, test } from 'bun:test'
import { apiBase, httpTransport, setTransport, type Transport } from '../api'
import { restoreRowAt } from './restoreRow'

const originalBase = apiBase()
afterEach(() => setTransport(httpTransport(originalBase)))

type Call = { path: string; body: unknown }

let baseText = ''

function install(calls: Call[]): void {
    const ok = () => Promise.resolve(new Response('{}'))
    const stub: Transport = {
        getJson: () => Promise.reject(new Error('not stubbed')),
        getText: () => Promise.resolve(baseText),
        post: (path, body) => {
            calls.push({ path, body })
            return ok()
        },
        put: () => Promise.reject(new Error('not stubbed')),
        postJson: () => Promise.reject(new Error('not stubbed')),
        writeFileChecked: () => Promise.reject(new Error('not stubbed')),
        uploadAsset: () => Promise.reject(new Error('not stubbed')),
        fetchAsset: () => Promise.reject(new Error('not stubbed')),
        convertHeic: () => Promise.reject(new Error('not stubbed')),
        stageTmpFile: () => Promise.reject(new Error('not stubbed')),
        assetUrl: (t: string) => t,
        eventsUrl: () => '',
        base: () => originalBase,
    }
    setTransport(stub)
}

test('restoreRowAt re-creates the row then moves it from the end back to its old index', async () => {
    const calls: Call[] = []
    install(calls)
    baseText = '---\ntype: base\n---\n\n| title |\n| --- |\n| a |\n| b |\n| c |\n'
    await restoreRowAt('tasks.md', { title: 'x' }, 1)
    expect(calls).toEqual([
        { path: '/row/update', body: { file: 'tasks.md', index: null, note: { title: 'x' } } },
        { path: '/row/reorder', body: { file: 'tasks.md', from: 3, to: 1 } },
    ])
})

test('restoreRowAt leaves a row that was last in place when its index is past the end', async () => {
    const calls: Call[] = []
    install(calls)
    baseText = '---\ntype: base\n---\n\n| title |\n| --- |\n| a |\n| b |\n'
    await restoreRowAt('tasks.md', { title: 'x' }, 2)
    expect(calls.map(c => c.path)).toEqual(['/row/update'])
})
