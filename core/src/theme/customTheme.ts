// core/src/theme/customTheme.ts
// Custom colour themes (v2): a vault's `.themes/<name>.yaml` carries an optional `label`, an
// optional `extends` (a built-in theme, default ink) and an optional `tokens:` map of overrides.
// Every key is optional: an empty file is stock Bismuth. This module is the pure half — parse,
// validate, scaffold — and stays bundle-safe (no node:*, Bun or Solid imports) because the app
// imports it too. The fs half is themeFiles.ts. The token vocabulary is designTokens.ts.

import { parse as parseYaml } from 'yaml'
import {
    DESIGN_TOKENS,
    TOKEN_GROUPS,
    applyColorTokens,
    nonFieldTokens,
    parseTokenMap,
    type TokenDef,
    type TokenMap,
} from './designTokens'
import {
    THEMES,
    THEME_NAMES,
    isBuiltinTheme,
    type ColorTokens,
    type ThemeName,
} from './tokens'

export const THEMES_DIR = '.themes'
export const THEME_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

export type ThemeDiagnostic = {
    field: string
    severity: 'error' | 'warning'
    message: string
}
export type CustomTheme = {
    name: string
    label: string // file's label, else the name
    extends: ThemeName // file's extends, else 'ink'
    tokens: TokenMap // the file's overrides, normalized (field + non-field)
    colors: ColorTokens // applyColorTokens(THEMES[extends], tokens)
}
/** `theme` is present iff there is no error-severity diagnostic. */
export type ParsedTheme = {
    name: string
    theme?: CustomTheme
    diagnostics: ThemeDiagnostic[]
}

/** The GET /themes response body. */
export type ThemesFeed = {
    themes: {
        name: string
        label: string
        extends: ThemeName
        isLight: boolean
        tokens: TokenMap
        colors: ColorTokens
    }[]
    invalid: { name: string; diagnostics: ThemeDiagnostic[] }[]
}

const PATH_RE = /^\.themes\/([^/]+)\.yaml$/

export function themeFilePath(name: string): string {
    return `${THEMES_DIR}/${name}.yaml`
}

export function themeNameFromPath(rel: string): string | null {
    const m = PATH_RE.exec(rel)
    return m && THEME_NAME_RE.test(m[1]) ? m[1] : null
}

export function isThemePath(rel: string): boolean {
    return themeNameFromPath(rel) !== null
}

function rgbOf(c: string): [number, number, number] | null {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)
    if (hex) {
        let h = hex[1]
        if (h.length === 3) h = h.replace(/./g, ch => ch + ch)
        return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [
            number,
            number,
            number,
        ]
    }
    const fn = /^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(c)
    if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])]
    return null
}

function luminance([r, g, b]: [number, number, number]): number {
    const lin = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio; null if either side is not an opaque hex / rgb(). */
export function contrastRatio(a: string, b: string): number | null {
    const ca = rgbOf(a)
    const cb = rgbOf(b)
    if (!ca || !cb) return null
    const la = luminance(ca)
    const lb = luminance(cb)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The first run's top-level keys → their v2 token key, for the migration warning. */
export const LEGACY_THEME_KEYS: Readonly<Record<string, string>> = {
    ...Object.fromEntries(
        DESIGN_TOKENS.filter(
            d => d.field && d.field !== 'accentPalette' && d.field !== 'isLight',
        ).map(d => [d.field as string, d.key]),
    ),
    accentPalette: 'graph-0..4',
    isLight: 'color-scheme',
}

export function parseCustomTheme(name: string, yamlText: string): ParsedTheme {
    const diagnostics: ThemeDiagnostic[] = []
    const add = (
        field: string,
        severity: 'error' | 'warning',
        problem: string,
    ) =>
        diagnostics.push({
            field,
            severity,
            message: field ? `${field}: ${problem}` : problem,
        })

    let doc: unknown
    try {
        doc = parseYaml(yamlText)
    } catch (e) {
        add('', 'error', `invalid YAML: ${(e as Error).message.split('\n')[0]}`)
        return { name, diagnostics }
    }
    if (doc === null || doc === undefined) doc = {}
    if (typeof doc !== 'object' || Array.isArray(doc)) {
        add('', 'error', 'theme file must be a YAML map of fields')
        return { name, diagnostics }
    }
    const src = doc as Record<string, unknown>

    if (!THEME_NAME_RE.test(name))
        add('name', 'error', `invalid theme name: ${name} (use a-z, 0-9, -; max 40)`)
    else if (isBuiltinTheme(name))
        add('name', 'error', `${name} is a built-in theme name`)

    let label = name
    if (Object.hasOwn(src, 'label')) {
        const l = src.label
        if (typeof l !== 'string' || l.trim() === '')
            add('label', 'error', 'must be a non-empty string')
        else label = l.trim()
    }

    let base: ThemeName = 'ink'
    if (Object.hasOwn(src, 'extends')) {
        const e = src.extends
        if (typeof e === 'string' && (THEME_NAMES as readonly string[]).includes(e))
            base = e as ThemeName
        else add('extends', 'error', `must be one of ${THEME_NAMES.join(', ')}`)
    }

    const parsedTokens = parseTokenMap(src.tokens)
    for (const d of parsedTokens.diagnostics)
        add(d.key, d.severity, d.message.startsWith(`${d.key}: `) ? d.message.slice(d.key.length + 2) : d.message)
    const tokens = parsedTokens.tokens

    for (const k of Object.keys(src)) {
        if (k === 'label' || k === 'extends' || k === 'tokens') continue
        if (Object.hasOwn(LEGACY_THEME_KEYS, k))
            add(
                k,
                'warning',
                `moved — write it under tokens: as ${LEGACY_THEME_KEYS[k]} (see bismuth theme tokens)`,
            )
        else add(k, 'warning', 'unknown field, ignored')
    }

    if (diagnostics.some(d => d.severity === 'error')) return { name, diagnostics }

    const colors = applyColorTokens(THEMES[base], tokens)
    const warnBelow = (fg: string, bg: string, key: string, bgKey: string, min: number) => {
        const r = contrastRatio(fg, bg)
        if (r !== null && r < min)
            add(
                key,
                'warning',
                `low contrast against ${bgKey}: ${r.toFixed(2)}:1 (aim for ${min}:1)`,
            )
    }
    warnBelow(colors.foreground, colors.background, 'fg', 'bg', 4.5)
    warnBelow(colors.neutral, colors.background, 'text-muted', 'bg', 3)
    warnBelow(colors.onAccent ?? '', colors.accent, 'on-accent', 'accent', 4.5)
    return {
        name,
        theme: { name, label, extends: base, tokens, colors },
        diagnostics,
    }
}

export function buildThemesFeed(parsed: readonly ParsedTheme[]): ThemesFeed {
    const feed: ThemesFeed = { themes: [], invalid: [] }
    for (const p of parsed) {
        if (p.theme)
            feed.themes.push({
                name: p.name,
                label: p.theme.label,
                extends: p.theme.extends,
                isLight: p.theme.colors.isLight === true,
                tokens: p.theme.tokens,
                colors: p.theme.colors,
            })
        else feed.invalid.push({ name: p.name, diagnostics: p.diagnostics })
    }
    return feed
}

/** name → resolved colours. */
export function customTokenMap(feed: ThemesFeed): Record<string, ColorTokens> {
    return Object.fromEntries(feed.themes.map(t => [t.name, t.colors]))
}

/** name → the non-field overrides, projected straight onto `:root`. */
export function customOverrideMap(feed: ThemesFeed): Record<string, TokenMap> {
    return Object.fromEntries(
        feed.themes.map(t => [t.name, nonFieldTokens(t.tokens)]),
    )
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`

/** The value a ColorTokens carries for a field token, as a token string; undefined if absent. */
function fieldValue(def: TokenDef, full: ColorTokens): string | undefined {
    if (def.field === 'isLight') return full.isLight ? 'light' : 'dark'
    if (def.field === 'accentPalette')
        return def.index === undefined ? undefined : full.accentPalette[def.index]
    const v = (full as unknown as Record<string, unknown>)[def.field as string]
    return typeof v === 'string' ? v : undefined
}

/** Minimal file when `full` is absent; with `full`, every token (field tokens live, the rest
 *  commented out at their registry default). Every string value is quoted. */
export function themeTemplate(input: {
    label: string
    extends: ThemeName
    tokens?: TokenMap
    full?: ColorTokens
}): string {
    const lines = [
        '# Bismuth theme. Every key is optional: an empty file is stock Bismuth.',
        '# List tokens: bismuth theme tokens   Validate: bismuth theme validate <name>',
        '# Quote colours: an unquoted # starts a YAML comment.',
        `label: ${q(input.label)}`,
        `extends: ${input.extends}`,
    ]
    const given = input.tokens ?? {}
    if (!input.full) {
        const own = DESIGN_TOKENS.filter(d => Object.hasOwn(given, d.key))
        if (own.length === 0) lines.push('tokens: {}')
        else {
            lines.push('tokens:')
            for (const d of own) lines.push(`  ${d.key}: ${q(given[d.key]!)}`)
        }
        return lines.join('\n') + '\n'
    }
    lines.push('tokens:')
    for (const group of TOKEN_GROUPS) {
        lines.push('', `  # ── ${group}`)
        for (const d of DESIGN_TOKENS.filter(t => t.group === group)) {
            lines.push(`  # ${d.doc}`)
            const live = d.field ? fieldValue(d, input.full) : given[d.key]
            if (live !== undefined) lines.push(`  ${d.key}: ${q(live)}`)
            else lines.push(`  # ${d.key}: ${q(d.default)}`)
        }
    }
    return lines.join('\n') + '\n'
}
