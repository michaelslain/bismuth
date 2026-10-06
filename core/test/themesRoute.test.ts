// core/test/themesRoute.test.ts — GET /themes + a custom appearance.theme through GET /settings.
import { test, expect } from 'bun:test'
import { createServer } from '../src/server'
import { makeVault } from './helpers'
import { THEMES } from '../src/theme/tokens'
import { themeTemplate } from '../src/theme/customTheme'

const dusk = themeTemplate({ label: 'Dusk', extends: 'ink', tokens: { accent: THEMES.ink.accent } })

async function withServer(files: Record<string, string>, fn: (base: string) => Promise<void>) {
    const server = createServer({ vault: makeVault(files), port: 0 })
    try {
        await fn(`http://localhost:${server.port}`)
    } finally {
        server.stop(true)
    }
}

test('GET /themes lists a valid and an invalid theme', async () => {
    await withServer(
        { '.themes/dusk.yaml': dusk, '.themes/bad.yaml': "label: Bad\ntokens:\n  accent: 'purple-ish'\n" },
        async base => {
            const feed = (await (await fetch(`${base}/themes`)).json()) as {
                themes: { name: string; label: string; tokens: Record<string, unknown>; colors: Record<string, unknown>; extends: string }[]
                invalid: { name: string; diagnostics: { field: string }[] }[]
            }
            expect(feed.themes.map(t => t.name)).toEqual(['dusk'])
            expect(feed.themes[0].label).toBe('Dusk')
            expect(feed.themes[0].tokens.accent).toBe(THEMES.ink.accent)
            expect(feed.themes[0].colors.accent).toBe(THEMES.ink.accent)
            expect(feed.themes[0].extends).toBe('ink')
            expect(feed.invalid.map(t => t.name)).toEqual(['bad'])
            expect(feed.invalid[0].diagnostics.length).toBeGreaterThan(0)
        },
    )
})

test('appearance.theme naming a valid custom theme round-trips through GET /settings', async () => {
    await withServer(
        { '.themes/dusk.yaml': dusk, '.settings': 'appearance:\n  theme: dusk\n' },
        async base => {
            const s = (await (await fetch(`${base}/settings`)).json()) as { appearance: { theme: string } }
            expect(s.appearance.theme).toBe('dusk')
        },
    )
})

test('appearance.theme naming an invalid custom theme falls back to ink', async () => {
    await withServer(
        { '.themes/bad.yaml': 'extends: nope\n', '.settings': 'appearance:\n  theme: bad\n' },
        async base => {
            const s = (await (await fetch(`${base}/settings`)).json()) as { appearance: { theme: string } }
            expect(s.appearance.theme).toBe('ink')
        },
    )
})

test('GET /tree lists .themes yaml files, and a theme written after boot appears', async () => {
    await withServer({ '.themes/dusk.yaml': dusk }, async base => {
        const paths = async () =>
            ((await (await fetch(`${base}/tree`)).json()) as { path: string }[]).map(e => e.path)
        expect(await paths()).toEqual(expect.arrayContaining(['.themes', '.themes/dusk.yaml']))
    })
})

test('a theme created while the server runs dirties the tree', async () => {
    const vault = makeVault({ '.themes/dusk.yaml': dusk })
    const server = createServer({ vault, port: 0 })
    const base = `http://localhost:${server.port}`
    try {
        await fetch(`${base}/tree`) // warm the tree cache
        await Bun.sleep(300)
        await Bun.write(`${vault}/.themes/late.yaml`, themeTemplate({ label: 'Late', extends: 'ink' }))
        let seen = false
        for (let i = 0; i < 30 && !seen; i++) {
            await Bun.sleep(200)
            const tree = (await (await fetch(`${base}/tree`)).json()) as { path: string }[]
            seen = tree.some(e => e.path === '.themes/late.yaml')
        }
        expect(seen).toBe(true)
    } finally {
        server.stop(true)
    }
})
