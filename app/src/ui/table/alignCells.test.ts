import { GlobalWindow } from 'happy-dom'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { marked } from 'marked'
import { alignCells } from './alignCells'

let win: GlobalWindow
beforeAll(() => {
    win = new GlobalWindow()
})
afterAll(() => win.happyDOM.close())

const tableOf = (md: string) => {
    const host = win.document.createElement('div')
    host.innerHTML = marked.parse(md, { gfm: true, async: false }) as string
    return host.querySelector('table') as unknown as HTMLTableElement
}

test('a --: column sits right and a :-- column left, header and body alike', () => {
    const table = tableOf('| a | b | c |\n| :-- | --: | --- |\n| 1 | 2 | 3 |')
    alignCells(table)
    const aligns = Array.from(table.rows).map(r =>
        Array.from(r.cells).map(c => c.style.textAlign),
    )
    expect(aligns).toEqual([
        ['left', 'right', ''],
        ['left', 'right', ''],
    ])
})

test('a centered column is left to the shared rule, so it renders left', () => {
    const table = tableOf('| a |\n| :-: |\n| 1 |')
    alignCells(table)
    for (const cell of Array.from(table.querySelectorAll('th, td')))
        expect((cell as HTMLElement).style.textAlign).toBe('')
})
