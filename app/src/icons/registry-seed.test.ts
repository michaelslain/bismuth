// app/src/icons/registry-seed.test.ts
//
// Guards the icon map: every icon name the app's command catalog references MUST resolve to
// mapped art (not the generic ▸ fallback), so command buttons never silently degrade.
// registry.ts has no DOM dependency anymore (it's two plain static name->art
// objects over the pure registry-core.ts), so — unlike the old lazy-manifest version of this
// test — importing it directly here is safe.
import { test, expect } from 'bun:test'
import { COMMAND_CATALOG } from '../../../core/src/commands'
import { isIconName, iconNames } from './registry'

test('every command-catalog icon resolves to a mapped glyph', () => {
    const missing = COMMAND_CATALOG.map(c => c.icon)
        .filter(
            (icon): icon is string =>
                typeof icon === 'string' && icon.length > 0,
        )
        .filter(icon => !isIconName(icon))
    expect(missing).toEqual([])
})

test('icon names are unique and non-empty', () => {
    const names = iconNames()
    expect(names.length).toBeGreaterThan(0)
    expect(new Set(names).size).toBe(names.length)
})
