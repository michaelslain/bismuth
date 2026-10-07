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

test('ICON_MAP has no stray entries beyond the canonical 142', () => {
    const names = new Set(ICON_NAMES)
    const stray = Object.keys(ICON_MAP).filter(n => !names.has(n))
    expect(stray).toEqual([])
})

test('counts: 140 slug entries, 2 custom, 0 known-missing', () => {
    const entries = Object.values(ICON_MAP)
    expect(entries.filter(e => e.kind === 'slug').length).toBe(140)
    expect(entries.filter(e => e.kind === 'custom').length).toBe(2)
    expect(KNOWN_MISSING.length).toBe(0)
    // 140 + 2 + 0 === 142, the whole canonical set, asserted directly rather than trusting addition.
    expect(entries.length + KNOWN_MISSING.length).toBe(ICON_NAMES.length)
})

test('the five former "gaps" map to real Phosphor art — no canonical name draws the dashed ?', () => {
    expect(KNOWN_MISSING).toEqual([])
    expect(ICON_MAP.ArchiveX).toEqual({ kind: 'slug', slug: 'file-archive' })
    expect(ICON_MAP.Blend).toEqual({ kind: 'slug', slug: 'intersect-three' })
    expect(ICON_MAP.FolderInput).toEqual({
        kind: 'slug',
        slug: 'arrow-square-in',
    })
    expect(ICON_MAP.Map).toEqual({ kind: 'slug', slug: 'map-trifold' })
    expect(ICON_MAP.Vote).toEqual({ kind: 'slug', slug: 'check-square-offset' })
})

test('Regex and WholeWord are hand-authored PATH marks — no <text>, no font', () => {
    for (const name of ['Regex', 'WholeWord']) {
        const entry = ICON_MAP[name]
        expect(entry.kind).toBe('custom')
        if (entry.kind !== 'custom') continue
        expect(entry.body, name).not.toContain('<text')
        expect(entry.body, name).not.toContain('font')
    }
    expect(ICON_MAP.Regex).toEqual({
        kind: 'custom',
        viewBox: '0 0 256 256',
        body: expect.stringContaining('<path'),
    })
    expect(ICON_MAP.WholeWord).toEqual({
        kind: 'custom',
        viewBox: '0 0 256 256',
        body: expect.stringContaining('<path'),
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
    // at the same MDI glyph before it was caught). Power/PowerOff and Columns2/Columns3 used to be
    // allow-listed here and were a real bug: the daemon's Enable/Disable pair drew ONE picture, so
    // the two buttons were indistinguishable. Only pairs that are the SAME concept may share.
    const bySlug = new Map<string, string[]>()
    for (const [name, entry] of Object.entries(ICON_MAP)) {
        if (entry.kind !== 'slug') continue
        const list = bySlug.get(entry.slug) ?? []
        list.push(name)
        bySlug.set(entry.slug, list)
    }
    const allowedPairs = [
        // Phosphor's `list` IS the hamburger; List and Menu are the same picture by design.
        ['List', 'Menu'],
        ['PanelLeft', 'PanelRight'],
        ['Undo2', 'RotateCcw'],
    ].map(pair => [...pair].sort().join(','))
    const unexpectedDuplicates = [...bySlug.values()]
        .filter(names => names.length > 1)
        .map(names => [...names].sort().join(','))
        .filter(key => !allowedPairs.includes(key))
    expect(unexpectedDuplicates).toEqual([])
})
