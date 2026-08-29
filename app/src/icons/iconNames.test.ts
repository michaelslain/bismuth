// app/src/icons/iconNames.test.ts
//
// Pins the exact canonical-name count and guards against the two ways this list can silently rot:
// a duplicate name (two entries collapsing to one registry key) and drift away from nerdGlyphs.ts
// while that module still exists in the tree as the specimen's name source.
import { test, expect } from 'bun:test'
import { ICON_NAMES } from './iconNames'
import { NERD_GLYPHS } from './nerdGlyphs'

test('exactly 140 canonical names', () => {
    // Absolute, not a lower bound — plan §10's whole coverage table (133/140, 135/140 etc.) is
    // measured against this exact figure, so a silent add/drop here invalidates every percentage
    // quoted in the plan and in iconMap.ts's comments without any test noticing.
    expect(ICON_NAMES.length).toBe(140)
})

test('every name is unique', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length)
})

test('every name is PascalCase-shaped', () => {
    for (const name of ICON_NAMES)
        expect(`${name}: ${/^[A-Z][A-Za-z0-9]*$/.test(name)}`).toBe(
            `${name}: true`,
        )
})

test('matches nerdGlyphs.ts key set exactly (no drift between the retired and live name lists)', () => {
    const fromNerd = new Set(Object.keys(NERD_GLYPHS))
    const fromIconNames = new Set(ICON_NAMES)
    const onlyInNerd = [...fromNerd].filter(n => !fromIconNames.has(n))
    const onlyInIconNames = [...fromIconNames].filter(n => !fromNerd.has(n))
    expect({ onlyInNerd, onlyInIconNames }).toEqual({
        onlyInNerd: [],
        onlyInIconNames: [],
    })
})

test('includes both the ordinary and the awkward/technical names', () => {
    // Spot checks, not structural-only — a list could pass every check above by being 140 copies
    // of "Plus" with a Set that happens to dedupe wrong. These are absolute values.
    for (const name of [
        'Plus',
        'Search',
        'BrainCircuit',
        'Regex',
        'WholeWord',
        'Sigma',
        'ArchiveX',
        'Vote',
    ])
        expect(ICON_NAMES).toContain(name)
})
