// app/src/icons/iconNames.test.ts
//
// Pins the exact canonical-name count and guards against the way this list can silently rot: a
// duplicate name (two entries collapsing to one registry key). It used to also cross-check against
// nerdGlyphs.ts's key set while that retired module still existed in the tree as the icon font's
// codepoint source — that module and its own cross-check test were deleted (ds-conformance Task 8)
// once nothing referenced the font it described; this list needed no replacement source, since it
// was already set-independent (see iconNames.ts's header).
import { test, expect } from 'bun:test'
import { ICON_NAMES } from './iconNames'

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
