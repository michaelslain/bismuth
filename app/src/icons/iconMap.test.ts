// app/src/icons/iconMap.test.ts
//
// Guards the mapping data module itself (name -> Phosphor slug / custom mark / declared gap),
// independent of whether the actual @iconify-json/ph package resolves each slug (build-icon-svgs.ts
// checks that, at generation time, against the real installed package — see its self-check).
// This file's job is narrower: the TABLE is internally consistent and covers every canonical name
// exactly once.
import { test, expect } from 'bun:test'
import { ICON_NAMES } from './iconNames'
import { ICON_MAP, KNOWN_MISSING } from './iconMap'

test('every canonical name is covered exactly once — mapped XOR declared missing, never both, never neither', () => {
    const mapped = new Set(Object.keys(ICON_MAP))
    const missing = new Set(KNOWN_MISSING)
    const uncovered = ICON_NAMES.filter(n => !mapped.has(n) && !missing.has(n))
    const both = ICON_NAMES.filter(n => mapped.has(n) && missing.has(n))
    expect({ uncovered, both }).toEqual({ uncovered: [], both: [] })
})

test('ICON_MAP has no stray entries beyond the canonical 140', () => {
    const names = new Set(ICON_NAMES)
    const stray = Object.keys(ICON_MAP).filter(n => !names.has(n))
    expect(stray).toEqual([])
})

test('counts match the plan record: 133 slug entries, 2 custom, 5 known-missing', () => {
    const entries = Object.values(ICON_MAP)
    expect(entries.filter(e => e.kind === 'slug').length).toBe(133)
    expect(entries.filter(e => e.kind === 'custom').length).toBe(2)
    expect(KNOWN_MISSING.length).toBe(5)
    // 133 + 2 + 5 === 140, the whole canonical set, asserted directly rather than trusting addition.
    expect(entries.length + KNOWN_MISSING.length).toBe(ICON_NAMES.length)
})

test('KNOWN_MISSING is exactly the five confirmed Phosphor gaps', () => {
    expect([...KNOWN_MISSING].sort()).toEqual(
        ['ArchiveX', 'Blend', 'FolderInput', 'Map', 'Vote'].sort(),
    )
})

test('Regex and WholeWord are hand-authored custom marks, not slugs', () => {
    expect(ICON_MAP.Regex).toEqual({
        kind: 'custom',
        viewBox: '0 0 256 256',
        body: expect.stringContaining('.*'),
    })
    expect(ICON_MAP.WholeWord).toEqual({
        kind: 'custom',
        viewBox: '0 0 256 256',
        body: expect.stringContaining('[W]'),
    })
})

test('named icons resolve to their recorded slug, not merely to something', () => {
    // Absolute expected values — asserting only "it has an entry" could never fail against a
    // scrambled table.
    expect(ICON_MAP.Plus).toEqual({ kind: 'slug', slug: 'plus' })
    expect(ICON_MAP.Trash2).toEqual({ kind: 'slug', slug: 'trash' })
    expect(ICON_MAP.Folder).toEqual({ kind: 'slug', slug: 'folder' })
    expect(ICON_MAP.BrainCircuit).toEqual({
        kind: 'slug',
        slug: 'head-circuit',
    })
})

test('no two names share a slug by copy-paste accident, except the deliberate pairs', () => {
    // A duplicated slug means two different actions show the same picture — invisible to any other
    // check (the earlier Nerd Font migration hit exactly this: Columns3/SquareKanban both pointed
    // at the same MDI glyph before it was caught). Some sharing here IS deliberate — Columns2 and
    // Columns3 both use Phosphor's one 3-column glyph, Power/PowerOff share one power glyph,
    // PanelLeft/PanelRight share one sidebar glyph, Undo2/RotateCcw share one counter-clockwise
    // arrow — each pair a case where Phosphor has no distinct art and the specimen (iconSetData.ts)
    // made the same choice. Anything beyond that allow-list is a real regression.
    const bySlug = new Map<string, string[]>()
    for (const [name, entry] of Object.entries(ICON_MAP)) {
        if (entry.kind !== 'slug') continue
        const list = bySlug.get(entry.slug) ?? []
        list.push(name)
        bySlug.set(entry.slug, list)
    }
    const allowedPairs = [
        ['Columns2', 'Columns3'],
        ['Power', 'PowerOff'],
        ['PanelLeft', 'PanelRight'],
        ['Undo2', 'RotateCcw'],
    ].map(pair => [...pair].sort().join(','))
    const unexpectedDuplicates = [...bySlug.values()]
        .filter(names => names.length > 1)
        .map(names => [...names].sort().join(','))
        .filter(key => !allowedPairs.includes(key))
    expect(unexpectedDuplicates).toEqual([])
})
