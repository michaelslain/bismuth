import { expect, test } from 'bun:test'
import { intakeFiles, REJECT_TOAST, type IntakeDeps } from './bookIntake'

function deps() {
    const calls: string[] = []
    const toasts: string[] = []
    const d: IntakeDeps = {
        uploadAsset: async (target, bytes) => {
            calls.push(`upload ${target} ${bytes.byteLength}`)
            return target
        },
        rowCreate: async (file, note) => {
            calls.push(`row ${file} ${JSON.stringify(note)}`)
        },
        toast: m => void toasts.push(m),
        readNative: async p => new TextEncoder().encode(p).buffer as ArrayBuffer,
        attachmentFolder: () => 'attachments',
    }
    return { d, calls, toasts }
}

test('a png, a pdf and a txt: two uploads, two rows in order, one toast', async () => {
    const { d, calls, toasts } = deps()
    const files = [
        new File(['a'], 'one.png', { type: 'image/png' }),
        new File(['bb'], 'notes.txt', { type: 'text/plain' }),
        new File(['ccc'], 'two.pdf', { type: 'application/pdf' }),
    ]
    const out = await intakeFiles({ files }, 'books/Atlas.base.jsonl', d)
    expect(out).toEqual(['attachments/one.png', 'attachments/two.pdf'])
    expect(calls).toEqual([
        'upload attachments/one.png 1',
        'row books/Atlas.base.jsonl {"page":"[[attachments/one.png]]"}',
        'upload attachments/two.pdf 3',
        'row books/Atlas.base.jsonl {"page":"[[attachments/two.pdf]]"}',
    ])
    expect(toasts).toEqual([REJECT_TOAST])
})

test('native paths are read, filtered and appended the same way', async () => {
    const { d, calls, toasts } = deps()
    const out = await intakeFiles({ paths: ['/Users/m/Desktop/scan.JPG', '/x/y.zip', '/x/scan.HEIC'] }, 'b.base.jsonl', d)
    expect(out).toEqual(['attachments/scan.JPG', 'attachments/scan.HEIC'])
    expect(calls.length).toBe(4)
    expect(toasts).toEqual([REJECT_TOAST])
})

test('nothing droppable: no calls, one toast', async () => {
    const { d, calls, toasts } = deps()
    expect(await intakeFiles({ files: [new File(['x'], 'a.txt')] }, 'b.base.jsonl', d)).toEqual([])
    expect(calls).toEqual([])
    expect(toasts).toEqual([REJECT_TOAST])
})
