// app/src/editor/foldBlocks.test.ts
import { describe, expect, test } from 'bun:test'
import { Text } from '@codemirror/state'
import { scanFoldables } from './foldBlocks'

const doc = (s: string) => Text.of(s.split('\n'))
// regionTo as a line number, for readable assertions.
const endLine = (t: Text, pos: number) => t.lineAt(pos).number

describe('scanFoldables — headings', () => {
    test('folds down to the next same-or-higher heading', () => {
        const t = doc(['# A', 'body 1', 'body 2', '# B', 'body 3'].join('\n'))
        const blocks = scanFoldables(t)
        expect(blocks).toHaveLength(2)
        const a = blocks[0]
        expect(a.kind).toBe('h')
        expect(a.depth).toBe(0)
        expect(t.lineAt(a.anchorFrom).number).toBe(1)
        expect(endLine(t, a.regionTo)).toBe(3) // stops before "# B"
    })

    test("a deeper heading is nested inside its parent's region", () => {
        const t = doc(['# A', '## B', 'text', '# C'].join('\n'))
        const blocks = scanFoldables(t)
        const a = blocks.find(b => b.id.startsWith('h|1|A'))!
        const b = blocks.find(b => b.id.startsWith('h|2|B'))!
        expect(endLine(t, a.regionTo)).toBe(3) // A swallows ## B and its text
        expect(endLine(t, b.regionTo)).toBe(3) // B's own region is just "text"
    })

    test('a heading with no body is not foldable', () => {
        const t = doc(['# Empty', '# Next', 'x'].join('\n'))
        const blocks = scanFoldables(t)
        expect(blocks.map(b => b.id)).toEqual(['h|1|Next|0'])
    })

    test('trailing blank lines are trimmed from the region', () => {
        const t = doc(['# A', 'body', '', ''].join('\n'))
        const blocks = scanFoldables(t)
        expect(endLine(t, blocks[0].regionTo)).toBe(2) // not the blank lines 3/4
    })
})

describe('scanFoldables — bullets', () => {
    test('folds the indented children beneath a bullet', () => {
        const t = doc(
            ['- parent', '  - child 1', '  - child 2', '- sibling'].join('\n'),
        )
        const blocks = scanFoldables(t)
        const parent = blocks.find(b => b.id.startsWith('l|parent'))!
        expect(parent.kind).toBe('l')
        expect(parent.depth).toBe(0)
        expect(endLine(t, parent.regionTo)).toBe(3) // both children, not the sibling
    })

    test('a childless bullet is not foldable', () => {
        const t = doc(['- a', '- b'].join('\n'))
        expect(scanFoldables(t)).toHaveLength(0)
    })

    test('nested bullet depth drives the chevron offset', () => {
        const t = doc(['- a', '  - b', '    - c', '    - c2'].join('\n'))
        const b = scanFoldables(t).find(x => x.id.startsWith('l|b'))!
        expect(b.depth).toBe(1) // two leading spaces => depth 1
    })

    test('depth is structural, not space-counted: 4-space nesting is depth 1, not 2', () => {
        const t = doc(
            ['- a', '    - b', '        - c', '        - c2'].join('\n'),
        )
        const b = scanFoldables(t).find(x => x.id.startsWith('l|b'))!
        expect(b.depth).toBe(1) // 4 leading spaces is still one level deep
    })

    test('a bullet nested under a numbered item is depth 1 (the number counts as a level)', () => {
        const t = doc(
            ['1. Alpha', '    - sub', '        - deep', '2. Beta'].join('\n'),
        )
        const sub = scanFoldables(t).find(x => x.id.startsWith('l|sub'))!
        expect(sub.depth).toBe(1)
    })

    test('a thematic break is never a bullet', () => {
        const t = doc(['- real', '  - kid', '---', 'after'].join('\n'))
        const blocks = scanFoldables(t)
        expect(blocks.every(b => !b.id.includes('---'))).toBe(true)
    })

    test('tasks fold like bullets', () => {
        const t = doc(['- [ ] task', '  - sub', '- [x] done'].join('\n'))
        const task = scanFoldables(t).find(b => b.id.startsWith('l|[ ] task'))!
        expect(task).toBeTruthy()
        expect(endLine(t, task.regionTo)).toBe(2)
    })
})

describe('scanFoldables — stable ids', () => {
    test('duplicate text gets distinct occurrence indices', () => {
        const t = doc(['# Dup', 'x', '# Dup', 'y'].join('\n'))
        const ids = scanFoldables(t).map(b => b.id)
        expect(ids).toEqual(['h|1|Dup|0', 'h|1|Dup|1'])
    })
})

describe('scanFoldables — yaml mode', () => {
    test('a key with nested entries is foldable', () => {
        const t = doc(
            [
                'appearance:',
                '  theme: dark',
                '  accent: blue',
                'editor:',
                '  livePreview: true',
            ].join('\n'),
        )
        const blocks = scanFoldables(t, 'yaml')
        const ids = blocks.map(b => b.id)
        expect(ids).toEqual(['y|appearance:|0', 'y|editor:|0'])
        expect(endLine(t, blocks[0].regionTo)).toBe(3) // appearance swallows its two children
    })

    test('a leaf key (no children) is not foldable', () => {
        const t = doc(['theme: dark', 'accent: blue'].join('\n'))
        expect(scanFoldables(t, 'yaml')).toHaveLength(0)
    })

    test('nested depth drives the offset', () => {
        const t = doc(['a:', '  b:', '    c: 1', '    d: 2'].join('\n'))
        const b = scanFoldables(t, 'yaml').find(x => x.id.startsWith('y|b:'))!
        expect(b.depth).toBe(1)
    })

    test('comment lines are not anchors', () => {
        const t = doc(
            ['# a comment', '  still indented note', 'real:', '  x: 1'].join(
                '\n',
            ),
        )
        const ids = scanFoldables(t, 'yaml').map(b => b.id)
        expect(ids).toContain('y|real:|0')
        expect(ids.every(id => !id.includes('comment'))).toBe(true)
    })

    test('markdown headings are ignored in yaml mode', () => {
        const t = doc(['# A', 'body'].join('\n'))
        expect(scanFoldables(t, 'yaml')).toHaveLength(0) // '# A' is a comment line in yaml
    })
})

describe('scanFoldables — fenced code is code, not structure', () => {
    test('a # comment inside a fence is not a heading', () => {
        const t = doc(
            ['```bash', '# install deps', 'bun install', '```', 'after'].join(
                '\n',
            ),
        )
        expect(scanFoldables(t)).toEqual([])
    })

    test('a - line inside a fence is not a bullet', () => {
        const t = doc(['```yaml', '- name: a', '  run: b', '```'].join('\n'))
        expect(scanFoldables(t)).toEqual([])
    })

    test("a heading's region runs across a fence holding a # line", () => {
        const t = doc(
            [
                '## Setup',
                '```sh',
                '# one',
                'make',
                '```',
                'text',
                '## Next',
                'x',
            ].join('\n'),
        )
        const setup = scanFoldables(t).find(b => b.id === 'h|2|Setup|0')!
        expect(endLine(t, setup.regionTo)).toBe(6) // through `text`, not cut at `# one`
        expect(scanFoldables(t).map(b => b.id)).toEqual([
            'h|2|Setup|0',
            'h|2|Next|0',
        ])
    })

    test('a region ending on a fence ends on its closing line', () => {
        const t = doc(['# A', 'text', '```py', '# c', 'x = 1', '```'].join('\n'))
        const a = scanFoldables(t)[0]
        expect(a.id).toBe('h|1|A|0')
        expect(endLine(t, a.regionTo)).toBe(6)
    })

    test('a fence nested under a bullet folds with it whole', () => {
        const t = doc(
            ['- step', '    ```sh', '# at the margin', '    ```', 'after'].join(
                '\n',
            ),
        )
        const step = scanFoldables(t)[0]
        expect(step.id).toBe('l|step|0')
        expect(endLine(t, step.regionTo)).toBe(4)
    })

    test('an unclosed fence stays ordinary lines', () => {
        const t = doc(['```', '# A', 'body'].join('\n'))
        expect(scanFoldables(t).map(b => b.id)).toEqual(['h|1|A|0'])
    })
})
