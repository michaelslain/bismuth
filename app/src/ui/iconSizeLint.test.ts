import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { findIconSizeViolations } from './iconSizeLint'

const SRC = join(import.meta.dir, '..')

/** Every production .tsx under app/src — stories and `_*` story fixtures may show sizes. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return sourceFiles(path)
        if (!name.endsWith('.tsx')) return []
        if (name.endsWith('.stories.tsx') || name.startsWith('_')) return []
        return [path]
    })
}

describe('findIconSizeViolations', () => {
    it('flags a literal size on an icon component', () => {
        expect(findIconSizeViolations('<Icon value="Plus" size={13} />')).toEqual([
            { line: 1, tag: 'Icon', attr: 'size={13}' },
        ])
        expect(
            findIconSizeViolations('<IconButton\n    icon="X"\n    iconSize={15}\n/>'),
        ).toEqual([{ line: 3, tag: 'IconButton', attr: 'iconSize={15}' }])
    })
    it('flags a size hidden in a constant', () => {
        expect(findIconSizeViolations('<VBtn icon="X" iconSize={GLYPH} />')).toHaveLength(1)
    })
    it('passes a primitive forwarding its own prop, a non-icon component, and an exempt mark', () => {
        expect(findIconSizeViolations('<Icon value={v} size={props.iconSize} />')).toEqual([])
        expect(findIconSizeViolations('<WordmarkHero size={96} />')).toEqual([])
        expect(
            findIconSizeViolations(
                '<Icon\n    value="Sparkles"\n    /* icon-size-exempt: illustration mark */\n    size={22}\n/>',
            ),
        ).toEqual([])
    })
})

describe('the app uses ONE icon size', () => {
    it('no production component sets an icon size at the call site', () => {
        const found = sourceFiles(SRC).flatMap(file =>
            findIconSizeViolations(readFileSync(file, 'utf8')).map(
                v => `${relative(SRC, file)}:${v.line} <${v.tag} ${v.attr}>`,
            ),
        )
        // Fix: delete the attribute — every icon defaults to appearance.iconSize (ui/iconSize.ts).
        // An oversized illustration mark (never chrome) may keep one with an
        // `icon-size-exempt: <reason>` comment on or just above the attribute.
        expect(found).toEqual([])
    })
})
