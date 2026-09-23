// app/src/icons/registry-library.test.ts
//
// The full Phosphor icon library (assets/icons/icon-library.json) layered under the 140 canonical
// names: every pickable icon resolves, legacy Obsidian `Li*` names land on real art, the picker's
// ranking finds icons by meaning ("library" -> Books), and a stored canonical name highlights the
// library icon it draws as.
import { test, expect } from 'bun:test'
import {
    resolveIcon,
    installIconLibrary,
    iconLibraryInstalled,
    isPendingIconName,
    libraryIconList,
    libraryNameFor,
    FALLBACK_ART,
    type IconLibraryJson,
} from './registry'
import { LUCIDE_ALIASES } from './lucideAliases'
import { rankIcons } from '../ui/gallery/sources'
import libraryJson from '../assets/icons/icon-library.json'

test('before install, a name outside the 140 is pending, not missing', () => {
    if (iconLibraryInstalled()) return // another file in this process installed it first
    expect(isPendingIconName('Books')).toBe(true)
    expect(isPendingIconName('Plus')).toBe(false) // canonical — never pending
    expect(isPendingIconName('🪶')).toBe(false) // a glyph, not a name
    expect(resolveIcon('Books')).toBeNull()
})

test('the library holds every Phosphor Regular icon, uniquely named', () => {
    installIconLibrary(libraryJson as unknown as IconLibraryJson)
    const list = libraryIconList()
    expect(list.length).toBeGreaterThan(1500)
    expect(new Set(list.map(i => i.name)).size).toBe(list.length)
    for (const i of list) {
        expect(i.art.kind, i.name).toBe('svg')
        expect((i.art as { body: string }).body.length, i.name).toBeGreaterThan(
            0,
        )
    }
})

test('after install, library names resolve and nothing is pending', () => {
    installIconLibrary(libraryJson as unknown as IconLibraryJson)
    for (const name of [
        'Books',
        'House',
        'Mountains',
        'MapTrifold',
        'house-line',
    ])
        expect(resolveIcon(name), name).not.toBeNull()
    expect(isPendingIconName('Books')).toBe(false)
    expect(resolveIcon('NotAnIconAtAll')).toBeNull()
})

test('canonical names still win over a same-named library icon', () => {
    installIconLibrary(libraryJson as unknown as IconLibraryJson)
    // Canonical `Map` draws map-trifold; Phosphor has no plain `map`, so this is the canonical art.
    expect(resolveIcon('Map')).toEqual(resolveIcon('MapTrifold'))
    expect(resolveIcon('Map')).not.toEqual(FALLBACK_ART)
})

test('Obsidian Li* names resolve — same-spelled ones directly, the rest through LUCIDE_ALIASES', () => {
    installIconLibrary(libraryJson as unknown as IconLibraryJson)
    const vault = [
        'LiCarFront',
        'LiDice6',
        'LiFence',
        'LiGrid3x2',
        'LiHouse',
        'LiIdCard',
        'LiLanguages',
        'LiLeaf',
        'LiMap',
        'LiMountain',
        'LiPaintRoller',
        'LiRectangleVertical',
        'LiSignPost',
    ]
    for (const name of vault) {
        const art = resolveIcon(name)
        expect(art, name).not.toBeNull()
        expect(art, name).not.toEqual(FALLBACK_ART)
    }
    expect(resolveIcon('LiMountain')).toEqual(resolveIcon('Mountains'))
})

test('every LUCIDE_ALIASES target is a real library icon (a typo fails here, not on screen)', () => {
    installIconLibrary(libraryJson as unknown as IconLibraryJson)
    const names = new Set(libraryIconList().map(i => i.name.toLowerCase()))
    for (const [lucide, slug] of Object.entries(LUCIDE_ALIASES))
        expect(names.has(slug.replace(/-/g, '')), `${lucide} -> ${slug}`).toBe(
            true,
        )
})

test('libraryNameFor maps a stored value to the library icon it draws as', () => {
    installIconLibrary(libraryJson as unknown as IconLibraryJson)
    expect(libraryNameFor('Bot')).toBe('Robot')
    expect(libraryNameFor('Sparkles')).toBe('Sparkle')
    expect(libraryNameFor('LiHouse')).toBe('House')
    expect(libraryNameFor('Books')).toBe('Books')
    expect(libraryNameFor('🪶')).toBeNull()
})

test('the picker ranks by name first, then by meaning', () => {
    installIconLibrary(libraryJson as unknown as IconLibraryJson)
    const all = libraryIconList()
    const names = (q: string) => rankIcons(all, q).map(i => i.name)
    expect(names('library')).toContain('Books')
    expect(names('bot')).toContain('Robot') // canonical alias as a search term
    expect(names('house')[0]).toBe('House') // exact prefix first
    expect(names('map trifold')).toContain('MapTrifold')
    expect(names('')).toHaveLength(all.length)
    // Empty query: the app's own icons (same art as one of the 140) lead, then the rest.
    const firstNonCore = rankIcons(all, '').findIndex(i => !i.core)
    expect(firstNonCore).toBeGreaterThan(100)
    expect(
        rankIcons(all, '')
            .slice(firstNonCore)
            .every(i => !i.core),
    ).toBe(true)
    expect(names('').slice(0, firstNonCore)).toContain('Robot')
})
