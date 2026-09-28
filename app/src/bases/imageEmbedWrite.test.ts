import {
    describe,
    expect,
    test,
    beforeEach,
    afterEach,
    mock,
} from 'bun:test'

// Toast.tsx is Solid JSX, which the bun runner can't load; the toast is not under test.
mock.module('../Toast', () => ({ pushToast: () => {} }))
const { api } = await import('../api')
const { embedUploadsIntoValue } = await import('./imageEmbedWrite')

const bytes = new ArrayBuffer(1)
const real = api.uploadAsset
let targets: string[] = []

beforeEach(() => {
    targets = []
    // the module's seam: api.uploadAsset (path in, final path out)
    api.uploadAsset = async (target: string) => {
        targets.push(target)
        return target
    }
})
afterEach(() => {
    api.uploadAsset = real
})

describe('embedUploadsIntoValue', () => {
    test('appends each upload embed in order after the existing value', async () => {
        const { value: next, landed } = await embedUploadsIntoValue({
            uploads: [
                { name: 'a.png', bytes },
                { name: 'b.png', bytes },
            ],
            notePath: 'cards/card.md',
            value: () => 'some text',
        })
        expect(next).toBe('some text\n\n![[a.png]]\n![[b.png]]')
        expect(targets.length).toBe(2)
        expect(landed).toBe(2)
    })

    test('an empty value becomes just the embeds', async () => {
        const { value: next, landed } = await embedUploadsIntoValue({
            uploads: [{ name: 'a.png', bytes }],
            notePath: 'card.md',
            value: () => '',
        })
        expect(next).toBe('![[a.png]]')
    })

    test('no uploads leaves the value untouched', async () => {
        const { value: next, landed } = await embedUploadsIntoValue({
            uploads: [],
            notePath: 'card.md',
            value: () => 'keep',
        })
        expect(next).toBe('keep')
    })

    test('appends to the value as it is AFTER the upload resolves, not before', async () => {
        let text = 'before'
        api.uploadAsset = async (target: string) => {
            text = 'before + typed during upload'
            return target
        }
        const res = await embedUploadsIntoValue({
            uploads: [{ name: 'a.png', bytes }],
            notePath: 'card.md',
            value: () => text,
        })
        expect(res.value).toBe('before + typed during upload\n\n![[a.png]]')
        expect(res.landed).toBe(1)
    })
})
