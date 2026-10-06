// core/src/theme/themeFiles.ts
// The fs half of custom themes: `<vault>/.themes/*.yaml`. Desktop / CLI / server only —
// the pure parse and validate lives in customTheme.ts.

import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    THEMES_DIR,
    THEME_NAME_RE,
    buildThemesFeed,
    parseCustomTheme,
    themeFilePath,
    themeNameFromPath,
    type ParsedTheme,
    type ThemesFeed,
} from './customTheme'

const unreadable = (name: string, code: string | undefined): ParsedTheme => ({
    name,
    diagnostics: [
        { field: '', severity: 'error', message: `cannot read file: ${code ?? 'unknown'}` },
    ],
})

const MAX_BYTES = 64 * 1024

const tooLarge = (name: string): ParsedTheme => ({
    name,
    diagnostics: [{ field: '', severity: 'error', message: 'file too large (>64 KB)' }],
})

const symlinkRefused = (name: string): ParsedTheme => ({
    name,
    diagnostics: [
        { field: '', severity: 'error', message: 'cannot read file: symlink refused' },
    ],
})

const isLink = async (path: string): Promise<boolean | null> => {
    try {
        return (await lstat(path)).isSymbolicLink()
    } catch {
        return null // absent
    }
}

export async function readCustomTheme(
    vault: string,
    name: string,
): Promise<ParsedTheme | null> {
    if (!THEME_NAME_RE.test(name)) return null
    const file = join(vault, themeFilePath(name))
    let text: string
    try {
        if ((await isLink(join(vault, THEMES_DIR))) === true) return symlinkRefused(name)
        const st = await lstat(file)
        if (st.isSymbolicLink()) return symlinkRefused(name)
        if (!st.isFile()) return unreadable(name, 'not a regular file')
        if (st.size > MAX_BYTES) return tooLarge(name)
        text = await readFile(file, 'utf8')
        if (Buffer.byteLength(text) > MAX_BYTES) return tooLarge(name)
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (code === 'ENOENT') return null
        return unreadable(name, code)
    }
    return parseCustomTheme(name, text)
}

export async function listCustomThemes(vault: string): Promise<ParsedTheme[]> {
    let entries
    try {
        entries = await readdir(join(vault, THEMES_DIR), { withFileTypes: true })
    } catch {
        return []
    }
    const names = entries
        .filter(d => d.isFile() || d.isSymbolicLink())
        .map(d => themeNameFromPath(`${THEMES_DIR}/${d.name}`))
        .filter((n): n is string => n !== null)
        .sort()
    const out: ParsedTheme[] = []
    for (const n of names) {
        const p = await readCustomTheme(vault, n)
        if (p) out.push(p)
    }
    return out
}

export async function writeCustomThemeFile(
    vault: string,
    name: string,
    yamlText: string,
): Promise<void> {
    if (!THEME_NAME_RE.test(name)) throw new Error(`invalid theme name: ${name}`)
    const dir = join(vault, THEMES_DIR)
    if ((await isLink(dir)) === true)
        throw new Error(`${THEMES_DIR} is a symlink: refusing to write`)
    await mkdir(dir, { recursive: true })
    const file = join(vault, themeFilePath(name))
    if ((await isLink(file)) === true)
        throw new Error(`${themeFilePath(name)} is a symlink: refusing to write`)
    await writeFile(file, yamlText, 'utf8')
}

export async function themesFeed(vault: string): Promise<ThemesFeed> {
    return buildThemesFeed(await listCustomThemes(vault))
}
