// Custom colour theme command group for the `bismuth` CLI: `<vault>/.themes/<name>.yaml`.
// Headless — calls core directly; the app's watcher repaints live on the write.
import type { CommandMap } from '../types'
import {
    out,
    flag,
    bool,
    fail,
    positionals,
    requireVault,
    BOOLEAN_FLAGS,
} from '../args'
import {
    THEME_NAME_RE,
    themeFilePath,
    themeTemplate,
    type ParsedTheme,
    type ThemeDiagnostic,
} from '../../../core/src/theme/customTheme'
import {
    listCustomThemes,
    readCustomTheme,
    writeCustomThemeFile,
} from '../../../core/src/theme/themeFiles'
import {
    THEMES,
    THEME_NAMES,
    THEME_LABELS,
    isBuiltinTheme,
    type ColorTokens,
    type ThemeName,
} from '../../../core/src/theme/tokens'
import {
    DESIGN_TOKENS,
    TOKEN_GROUPS,
    type TokenMap,
} from '../../../core/src/theme/designTokens'
import { readSettings, setSettingInFile } from '../../../core/src/settings'

const BOOLS = [...BOOLEAN_FLAGS, 'force']

const titleCase = (name: string) =>
    name
        .split('-')
        .filter(Boolean)
        .map(w => w[0].toUpperCase() + w.slice(1))
        .join(' ')

const diagLine = (d: ThemeDiagnostic) =>
    `  ${d.severity}: ${d.message}`

function failDiagnostics(name: string, diagnostics: ThemeDiagnostic[]): never {
    const lines = diagnostics.map(diagLine).join('\n')
    fail(`theme '${name}' is invalid\n${lines}\nFix the file, then run: bismuth theme validate ${name}`)
}

/** A built-in or VALID custom theme's tokens; fails (exit 1) when unknown or invalid. */
async function resolveKnown(
    vault: string,
    name: string,
): Promise<{
    label: string
    builtin: boolean
    tokens: ColorTokens
    extends: ThemeName
    overrides: TokenMap
}> {
    if (isBuiltinTheme(name))
        return {
            label: THEME_LABELS[name],
            builtin: true,
            tokens: THEMES[name],
            extends: name,
            overrides: {},
        }
    const p = await readCustomTheme(vault, name)
    if (!p)
        fail(
            `unknown theme '${name}' — run \`bismuth theme list\` to see themes, or \`bismuth theme create ${name}\``,
        )
    if (!p.theme) failDiagnostics(name, p.diagnostics)
    return {
        label: p.theme.label,
        builtin: false,
        tokens: p.theme.colors,
        extends: p.theme.extends,
        overrides: p.theme.tokens,
    }
}

export const commands: CommandMap = {
    'theme tokens': {
        summary:
            'List every design token a theme can override: key, kind, group, default, doc',
        usage: '[--group <group>] [--kind <kind>]',
        run: async args => {
            const group = flag(args, 'group')
            const kind = flag(args, 'kind')
            const kinds = [...new Set(DESIGN_TOKENS.map(d => d.kind))]
            if (group && !TOKEN_GROUPS.includes(group as never))
                fail(
                    `unknown token group '${group}' — valid groups: ${TOKEN_GROUPS.join(', ')}`,
                )
            if (kind && !kinds.includes(kind as never))
                fail(
                    `unknown token kind '${kind}' — valid kinds: ${kinds.join(', ')}`,
                )
            out(
                DESIGN_TOKENS.filter(
                    d =>
                        (!group || d.group === group) &&
                        (!kind || d.kind === kind),
                ).map(d => ({
                    key: d.key,
                    kind: d.kind,
                    group: d.group,
                    default: d.default,
                    doc: d.doc,
                    ...(d.field ? { field: d.field } : {}),
                    ...(d.setting ? { setting: d.setting } : {}),
                })),
                args,
            )
        },
    },
    'theme list': {
        summary:
            'List built-in and custom themes with validity and token counts, plus the configured and active theme',
        run: async args => {
            const vault = requireVault(args)
            const settings = await readSettings(vault)
            const rawTheme = (settings?.data as any)?.appearance?.theme
            const configured: string | null =
                typeof rawTheme === 'string' ? rawTheme : null
            const custom = await listCustomThemes(vault)
            const valid = (n: string) =>
                isBuiltinTheme(n) ||
                custom.some(p => p.name === n && !!p.theme)
            const active = configured && valid(configured) ? configured : 'ink'
            const themes: unknown[] = THEME_NAMES.map(name => ({
                name,
                label: THEME_LABELS[name],
                extends: name,
                valid: true,
                tokens: 0,
            }))
            for (const p of custom)
                themes.push({
                    name: p.name,
                    label: p.theme?.label ?? p.name,
                    extends: p.theme?.extends ?? null,
                    valid: !!p.theme,
                    tokens: p.theme ? Object.keys(p.theme.tokens).length : 0,
                })
            out({ active, configured, themes }, args)
        },
    },
    'theme show': {
        summary:
            'Print label, extends, token overrides and diagnostics of a custom theme',
        usage: '<name>',
        run: async args => {
            const vault = requireVault(args)
            const [name] = positionals(args, BOOLS)
            if (!name) fail('usage: theme show <name>')
            if (isBuiltinTheme(name))
                return out(
                    {
                        name,
                        label: THEME_LABELS[name],
                        extends: name,
                        tokens: {},
                        diagnostics: [],
                    },
                    args,
                )
            const t = await resolveKnown(vault, name)
            const p = await readCustomTheme(vault, name)
            out(
                {
                    name,
                    label: t.label,
                    extends: t.extends,
                    tokens: t.overrides,
                    diagnostics: p?.diagnostics ?? [],
                },
                args,
            )
        },
    },
    'theme create': {
        summary:
            'Write .themes/<name>.yaml: a minimal file, or with --from a complete commented copy of that theme',
        usage: '<name> [--label <text>] [--from <theme>] [--extends <builtin>] [--force]',
        run: async args => {
            const vault = requireVault(args)
            const [name] = positionals(args, BOOLS)
            if (!name)
                fail('usage: theme create <name> [--label <text>] [--from <theme>] [--extends <builtin>] [--force]')
            if (isBuiltinTheme(name))
                fail(
                    `'${name}' is a built-in theme and cannot be replaced — choose another name, e.g. \`bismuth theme create my-${name} --from ${name}\``,
                )
            if (!THEME_NAME_RE.test(name))
                fail(
                    `invalid theme name '${name}' — use lowercase letters, digits and dashes, starting with a letter or digit, max 40 chars`,
                )
            const from = flag(args, 'from')
            const ext = flag(args, 'extends')
            if (ext && !isBuiltinTheme(ext))
                fail(
                    `--extends must be a built-in theme: ${THEME_NAMES.join(', ')}`,
                )
            const source = from ? await resolveKnown(vault, from) : null
            const existing = await readCustomTheme(vault, name)
            if (existing && !bool(args, 'force'))
                fail(
                    `${themeFilePath(name)} already exists — pass --force to overwrite it, or edit the file directly`,
                )
            const label = flag(args, 'label') ?? titleCase(name)
            await writeCustomThemeFile(
                vault,
                name,
                themeTemplate({
                    label,
                    extends: source ? source.extends : ((ext as ThemeName) ?? 'ink'),
                    tokens: source?.overrides,
                    full: source?.tokens,
                }),
            )
            out({ path: themeFilePath(name), name }, args)
        },
    },
    'theme validate': {
        summary:
            'Validate one custom theme, or every file in .themes/; exit 1 on any error (warnings pass)',
        usage: '[<name>]',
        run: async args => {
            const vault = requireVault(args)
            const [name] = positionals(args, BOOLS)
            let parsed: ParsedTheme[]
            if (name) {
                const p = await readCustomTheme(vault, name)
                if (!p)
                    fail(
                        isBuiltinTheme(name)
                            ? `'${name}' is a built-in theme — only custom themes in .themes/ are validated`
                            : `unknown theme '${name}' — expected ${themeFilePath(name)}; run \`bismuth theme create ${name}\``,
                    )
                parsed = [p]
            } else parsed = await listCustomThemes(vault)
            const results = parsed.map(p => ({
                name: p.name,
                diagnostics: p.diagnostics,
            }))
            const ok = !parsed.some(p =>
                p.diagnostics.some(d => d.severity === 'error'),
            )
            out({ ok, results }, args)
            if (!ok) {
                for (const p of parsed)
                    for (const d of p.diagnostics)
                        if (d.severity === 'error')
                            console.error(`${p.name}: ${d.message}`)
                process.exit(1)
            }
        },
    },
    'theme use': {
        summary:
            'Validate a theme, then set appearance.theme in .settings so the app repaints in it',
        usage: '<name>',
        run: async args => {
            const vault = requireVault(args)
            const [name] = positionals(args, BOOLS)
            if (!name) fail('usage: theme use <name>')
            await resolveKnown(vault, name)
            await setSettingInFile(vault, ['appearance', 'theme'], name)
            out({ ok: true, theme: name }, args)
        },
    },
}
