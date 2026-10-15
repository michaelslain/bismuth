// The ICON-BRACKET guard (icon-brackets-system plan, Task 9). Brackets on an icon-only control
// mean ON; the pure detectors live in `iconBracketsGuard.ts`, this file is the red/green cases
// for each rule plus the file-tree scan and the allow-lists. Rules:
//   1. an IconButton `icon=` that is a ternary (an icon swap to show state)
//   2. `variant="selected"` as a literal on IconButton / IconTextButton outside ui/
//   3. `variant={… ? 'selected' : 'normal'}` (a toggle whose off state is normal)
//   4. `icon="Trash…"` / `"X"` / `"x"` on an IconButton
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { blankComments, iconBracketFindings, iconTags, type IconBracketRule } from './iconBracketsGuard'

const SRC = join(import.meta.dir, '..')

/** Production `.tsx` under app/src — stories and tests are not shipped UI. */
function productionTsx(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return productionTsx(path)
        if (!name.endsWith('.tsx')) return []
        if (name.endsWith('.stories.tsx') || name.includes('.test.')) return []
        return [path]
    })
}

/** Rule → file → reason. */
const ALLOW: Readonly<Record<IconBracketRule, Readonly<Record<string, string>>>> = {
    'icon-swap': {
        'shell/EdgeHandle.tsx': 'a direction chevron (points at the edge it moves), not a state',
    },
    'selected-literal': {},
    'toggle-normal': { 'chat/ChatControls.tsx': 'the worded history toggle keeps normal as its off state, documented there' },
    'trash-or-x': {},
}

const rules = (src: string, inUi = false) => iconBracketFindings(src, inUi).map(f => f.rule)

describe('iconBracketsGuard detectors', () => {
    it('rule 1 flags a ternary icon, across lines and with => in another prop', () => {
        expect(rules(`<IconButton icon={on() ? 'EyeOff' : 'Eye'} />`)).toEqual(['icon-swap'])
        expect(
            rules(`<IconButton\n    onClick={() => go()}\n    icon={\n        open ? 'A' : 'B'\n    }\n/>`),
        ).toEqual(['icon-swap'])
    })
    it('rule 1 passes a plain, expression or optional-chained icon', () => {
        expect(rules(`<IconButton icon="Eye" />`)).toEqual([])
        expect(rules(`<IconButton icon={props.icon} />`)).toEqual([])
        expect(rules(`<IconButton icon={props.icon?.name ?? 'Eye'} />`)).toEqual([])
        expect(rules(`<IconTextButton icon={on ? 'A' : 'B'} />`)).toEqual([])
    })
    it('rule 2 flags variant="selected" outside ui/ on both buttons', () => {
        expect(rules(`<IconButton icon="Eye" variant="selected" />`)).toEqual(['selected-literal'])
        expect(rules(`<IconTextButton variant='selected'>x</IconTextButton>`)).toEqual(['selected-literal'])
    })
    it('rule 2 passes inside ui/, on other variants and on other components', () => {
        expect(rules(`<IconButton variant="selected" />`, true)).toEqual([])
        expect(rules(`<IconButton variant="primary" />`)).toEqual([])
        expect(rules(`<TextButton variant="selected" />`)).toEqual([])
    })
    it('rule 3 flags a selected-or-normal toggle', () => {
        expect(rules(`<IconButton variant={on() ? 'selected' : 'normal'} />`)).toEqual(['toggle-normal'])
        expect(rules(`<X\n variant={\n a ? "selected" : "normal"\n} />`)).toEqual(['toggle-normal'])
    })
    it('rule 3 flags the reversed order and the helper form anywhere in a file', () => {
        expect(rules(`<IconButton variant={on() ? 'normal' : 'selected'} />`)).toEqual(['toggle-normal'])
        expect(rules(`const v = () => (x ? 'selected' : 'normal')`)).toEqual(['toggle-normal'])
        expect(rules(`const v = () => (x ? "normal" : "selected")`)).toEqual(['toggle-normal'])
        expect(rules(`const v = () =>\n    x\n        ? 'selected'\n        : 'normal'`)).toEqual(['toggle-normal'])
        expect(rules('<BarTwin active={a()} offVariant="normal" />')).toEqual(['toggle-normal'])
    })
    it('rule 3 ignores a commented-out ternary', () => {
        expect(rules(`// const v = x ? 'selected' : 'normal'`)).toEqual([])
    })
    it('rule 2 catches a braced literal', () => {
        expect(rules(`<IconButton variant={'selected'} />`)).toEqual(['selected-literal'])
        expect(rules(`<IconTextButton variant={ "selected" } />`)).toEqual(['selected-literal'])
    })
    it('blankComments keeps string literals and only treats // after a delimiter as a comment', () => {
        expect(blankComments(`const u = 'http://x'`)).toBe(`const u = 'http://x'`)
        expect(blankComments(`go("a // b") // tail`)).toBe(`go("a // b") ` + ' '.repeat(7))
        expect(blankComments('const u = `//x`')).toBe('const u = `//x`')
        expect(blankComments(`  // whole line\nx`)).toBe(' '.repeat(15) + `\nx`)
        expect(blankComments(`go(); // a\nf(a, // b\n)`)).toBe(`go(); ` + ' '.repeat(4) + `\nf(a, ` + ' '.repeat(4) + `\n)`)
        expect(blankComments(`/* a\nb */x`)).toBe(`    \n    x`)
    })
    it('rule 3 passes selected-or-unselected', () => {
        expect(rules(`<IconButton variant={on() ? 'selected' : 'unselected'} />`)).toEqual([])
    })
    it('rule 4 flags Trash and X icons on an IconButton', () => {
        expect(rules(`<IconButton icon="Trash" />`)).toEqual(['trash-or-x'])
        expect(rules(`<IconButton icon="TrashCan" />`)).toEqual(['trash-or-x'])
        expect(rules(`<IconButton icon="X" />`)).toEqual(['trash-or-x'])
        expect(rules(`<IconButton icon='x' />`)).toEqual(['trash-or-x'])
        expect(rules(`<IconButton icon="trash-2" />`)).toEqual(['trash-or-x'])
        expect(rules(`<IconButton icon="LuTrash2" />`)).toEqual(['trash-or-x'])
        expect(rules(`<IconButton icon={'Trash2'} />`)).toEqual(['trash-or-x'])
    })
    it('rule 4 passes other icons and non-IconButton components', () => {
        expect(rules(`<IconButton icon="Box" />`)).toEqual([])
        expect(rules(`<IconTextButton icon="Trash" />`)).toEqual([])
    })
    it('ignores commented-out markup and reports the line', () => {
        expect(rules(`// <IconButton icon="X" />\n/* <IconButton icon="X" /> */`)).toEqual([])
        expect(iconBracketFindings(`a\n\n<IconButton icon="X" />`, false)[0]!.line).toBe(3)
    })
    it('parses a whole tag with nested braces and arrow functions', () => {
        const [tag] = iconTags(`<IconButton onClick={() => { go({ a: 1 }) }} icon="Eye" variant={v()} />`)
        expect(tag!.attrs.icon).toBe('"Eye"')
        expect(tag!.attrs.variant).toBe('{v()}')
    })
})

describe('icon brackets — scan of production tsx', () => {
    it('every allow-list entry matches a real hit', () => {
        const hits = new Set<string>()
        for (const file of productionTsx(SRC)) {
            const rel = relative(SRC, file)
            for (const f of iconBracketFindings(readFileSync(file, 'utf8'), rel.startsWith('ui/'))) hits.add(`${f.rule}|${rel}`)
        }
        const dead = Object.entries(ALLOW).flatMap(([rule, files]) =>
            Object.keys(files).filter(file => !hits.has(`${rule}|${file}`)).map(file => `${rule}: ${file}`),
        )
        expect(dead).toEqual([])
    })
    it('no icon swap, selected literal, selected/normal toggle or trash/x IconButton', () => {
        const offenders = productionTsx(SRC).flatMap(file => {
            const rel = relative(SRC, file)
            const inUi = rel.startsWith('ui/')
            return iconBracketFindings(readFileSync(file, 'utf8'), inUi)
                .filter(f => !(rel in ALLOW[f.rule]))
                .map(f => `${rel}:${f.line} ${f.rule}: ${f.text}`)
        })
        expect(offenders).toEqual([])
    })
})
