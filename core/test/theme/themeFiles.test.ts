import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { themeTemplate } from '../../src/theme/customTheme'
import {
    listCustomThemes,
    readCustomTheme,
    themesFeed,
    writeCustomThemeFile,
} from '../../src/theme/themeFiles'
import { THEMES } from '../../src/theme/tokens'
import { tempDir } from '../tempDirs'

let vault: string
beforeEach(async () => {
    vault = tempDir('themes-')
})
afterEach(async () => {
    await rm(vault, { recursive: true, force: true })
})

describe('themeFiles', () => {
    it('.themes as a regular file lists empty and serializes settings', async () => {
        await writeFile(join(vault, '.themes'), 'x')
        expect(await listCustomThemes(vault)).toEqual([])
        const { serializeSettingsForFrontend } = await import('../../src/settings')
        await serializeSettingsForFrontend(vault)
    })
    it('unreadable theme file becomes a diagnostic', async () => {
        await mkdir(join(vault, '.themes/bad.yaml'), { recursive: true })
        expect(await readCustomTheme(vault, 'bad')).toMatchObject({
            name: 'bad',
            diagnostics: [{ severity: 'error' }],
        })
    })
    it('missing dir is empty', async () => {
        expect(await listCustomThemes(vault)).toEqual([])
        expect(await readCustomTheme(vault, 'dusk')).toBeNull()
        expect(await themesFeed(vault)).toEqual({ themes: [], invalid: [] })
    })
    it('lists valid + invalid sorted, ignoring stray files', async () => {
        await writeCustomThemeFile(vault, 'zeta', themeTemplate({ label: 'Zeta', extends: 'paper' }))
        await writeCustomThemeFile(vault, 'alpha', themeTemplate({ label: 'Alpha', extends: 'ink' }))
        await writeFile(join(vault, '.themes', 'broken.yaml'), "label: B\ntokens:\n  accent: 'nope'\n")
        await writeFile(join(vault, '.themes', 'notes.txt'), 'hello')
        await writeFile(join(vault, '.themes', 'Bad Name.yaml'), 'label: x')
        await mkdir(join(vault, '.themes', 'sub.yaml'))
        const list = await listCustomThemes(vault)
        expect(list.map(p => p.name)).toEqual(['alpha', 'broken', 'zeta'])
        expect(list[1].theme).toBeUndefined()
        const feed = await themesFeed(vault)
        expect(feed.themes.map(t => [t.name, t.label, t.isLight])).toEqual([
            ['alpha', 'Alpha', false],
            ['zeta', 'Zeta', true],
        ])
        expect(feed.invalid).toHaveLength(1)
        expect(feed.invalid[0].name).toBe('broken')
        expect(feed.invalid[0].diagnostics.some(d => d.field === 'accent')).toBe(true)
    })
    it('read returns the parse; write creates the dir', async () => {
        await writeCustomThemeFile(vault, 'dusk', themeTemplate({ label: 'Dusk', extends: 'cathode' }))
        const p = await readCustomTheme(vault, 'dusk')
        expect(p?.theme?.colors.accent).toBe(THEMES.cathode.accent)
        expect(await readFile(join(vault, '.themes/dusk.yaml'), 'utf8')).toContain('Dusk')
    })
    it('refuses symlinked files and dirs', async () => {
        await mkdir(join(vault, '.themes'))
        await writeFile(join(vault, 'real.yaml'), "label: R\n")
        await symlink(join(vault, 'real.yaml'), join(vault, '.themes', 'link.yaml'))
        const p = await readCustomTheme(vault, 'link')
        expect(p?.theme).toBeUndefined()
        expect(p?.diagnostics[0].message).toBe('cannot read file: symlink refused')
        expect((await listCustomThemes(vault)).map(t => t.name)).toEqual(['link'])
        await expect(writeCustomThemeFile(vault, 'link', 'label: x')).rejects.toThrow()
        expect(await readFile(join(vault, 'real.yaml'), 'utf8')).toBe('label: R\n')

        const v2 = tempDir('themes-link-')
        try {
            await mkdir(join(v2, 'elsewhere'))
            await writeFile(join(v2, 'elsewhere', 'a.yaml'), '')
            await symlink(join(v2, 'elsewhere'), join(v2, '.themes'))
            expect((await listCustomThemes(v2)).map(p => [p.name, p.diagnostics[0].message])).toEqual([
                ['a', 'cannot read file: symlink refused'],
            ])
            expect((await readCustomTheme(v2, 'a'))?.diagnostics[0].message).toBe(
                'cannot read file: symlink refused',
            )
            await expect(writeCustomThemeFile(v2, 'b', '')).rejects.toThrow()
        } finally {
            await rm(v2, { recursive: true, force: true })
        }
    })
    it('a directory named like a theme file is not read', async () => {
        await mkdir(join(vault, '.themes', 'd.yaml'), { recursive: true })
        const p = await readCustomTheme(vault, 'd')
        expect(p?.theme).toBeUndefined()
        expect(p?.diagnostics[0].message).toBe('cannot read file: not a regular file')
    })
    it('files over 64 KB are not parsed', async () => {
        await mkdir(join(vault, '.themes'))
        await writeFile(join(vault, '.themes', 'big.yaml'), '# ' + 'x'.repeat(65 * 1024))
        const p = await readCustomTheme(vault, 'big')
        expect(p?.theme).toBeUndefined()
        expect(p?.diagnostics[0].message).toBe('file too large (>64 KB)')
        await writeFile(join(vault, '.themes', 'ok.yaml'), '# ' + 'x'.repeat(60 * 1024))
        expect((await readCustomTheme(vault, 'ok'))?.theme).toBeDefined()
    })
    it('read returns null unless the name matches THEME_NAME_RE', async () => {
        for (const n of ['Dusk', '.hidden', 'a b', '', 'a'.repeat(41)])
            expect(await readCustomTheme(vault, n)).toBeNull()
    })
    it('empty file is a valid theme in the feed', async () => {
        await writeCustomThemeFile(vault, 'blank', '')
        const feed = await themesFeed(vault)
        expect(feed.themes).toHaveLength(1)
        expect(feed.themes[0]).toMatchObject({ name: 'blank', label: 'blank', extends: 'ink', tokens: {} })
        expect(feed.themes[0].colors).toEqual(THEMES.ink)
    })
    it('refuses unsafe names', async () => {
        await expect(writeCustomThemeFile(vault, '../x', 'a: 1')).rejects.toThrow()
        expect(await readCustomTheme(vault, '../x')).toBeNull()
    })
})
