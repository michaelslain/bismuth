import { tempDir } from './helpers'
// core/test/settings.test.ts
import { test, expect, describe, it, afterEach } from 'bun:test'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeNote } from '../src/files'
import {
    readSettings,
    getVaultSchema,
    reconcileSettings,
    readDaemonEnabledSync,
} from '../src/settings'
import { keySuggestions } from '../src/schema/suggest'
import { validateDocument } from '../src/schema/validate'

async function emptyVault(): Promise<string> {
    return tempDir('bismuth-settings-')
}

test('readSettings returns null when settings.yaml is absent', async () => {
    const vault = await emptyVault()
    expect(await readSettings(vault)).toBeNull()
})

test('readSettings returns raw text + parsed data', async () => {
    const vault = await emptyVault()
    await writeNote(vault, '.settings', 'appearance:\n  theme: light\n')
    const res = await readSettings(vault)
    expect(res).not.toBeNull()
    expect(res!.raw).toContain('theme: light')
    expect(res!.data).toEqual({ appearance: { theme: 'light' } })
})

test('readSettings tolerates malformed YAML by returning empty data', async () => {
    const vault = await emptyVault()
    await writeNote(vault, '.settings', 'appearance:\n  theme: : : broken\n')
    const res = await readSettings(vault)
    expect(res).not.toBeNull()
    expect(res!.data).toEqual({})
})

test('getVaultSchema parses the properties section into a registry', async () => {
    const vault = await emptyVault()
    await writeNote(
        vault,
        '.settings',
        'properties:\n  due: date\n  status:\n    enum: [todo, doing, done]\n',
    )
    const schema = await getVaultSchema(vault)
    expect(schema.due.type).toBe('date')
    expect(schema.status.type).toEqual({
        kind: 'enum',
        values: ['todo', 'doing', 'done'],
    })
})

test('getVaultSchema returns only the built-in properties when there is no settings.yaml', async () => {
    const vault = await emptyVault()
    const schema = await getVaultSchema(vault)
    // Built-ins are always known (tags/aliases/cssclasses/icon); no user properties.
    expect(Object.keys(schema).sort()).toEqual([
        'aliases',
        'cssclasses',
        'icon',
        'tags',
    ])
    expect(schema.tags.type).toEqual({ kind: 'list', item: 'string' })
})

test("icon is a built-in known property of type 'icon'", async () => {
    const vault = await emptyVault()
    const schema = await getVaultSchema(vault)
    expect(schema.icon).toBeDefined()
    expect(schema.icon.type).toBe('icon')
})

test("keySuggestions includes the built-in icon key for prefix 'ic' and ''", async () => {
    const vault = await emptyVault()
    const schema = await getVaultSchema(vault)
    expect(keySuggestions(schema, 'ic')).toContain('icon')
    expect(keySuggestions(schema, '')).toContain('icon')
})

test('an icon frontmatter value (emoji OR arbitrary string) validates with zero diagnostics', async () => {
    const vault = await emptyVault()
    const schema = await getVaultSchema(vault)
    expect(
        validateDocument({ icon: '🪶' }, schema, { mode: 'frontmatter' }),
    ).toEqual([])
    expect(
        validateDocument({ icon: 'House' }, schema, { mode: 'frontmatter' }),
    ).toEqual([])
})

import { initializeSettings, SETTINGS_SEED } from '../src/settings'

test('initializeSettings writes a sparse file — no keys, every setting reads as its default', async () => {
    const vault = await emptyVault()
    await initializeSettings(vault)
    const res = await readSettings(vault)
    expect(res).not.toBeNull()
    expect(res!.raw).toBe(SETTINGS_SEED)
    expect(res!.data).toEqual({}) // comment-only: no key is materialized
    const merged = await serializeSettingsForFrontend(vault)
    expect((merged.appearance as Record<string, unknown>).theme).toBe('ink')
    expect((merged.graph as Record<string, unknown>).nodeSize).toBe(6)
    expect((merged.calendar as Record<string, unknown>).defaultView).toBe(
        'week',
    )
})

test('initializeSettings does not clobber an existing file', async () => {
    const vault = await emptyVault()
    await writeNote(vault, '.settings', 'appearance:\n  theme: light\n')
    await initializeSettings(vault)
    const res = await readSettings(vault)
    expect(res!.data).toEqual({ appearance: { theme: 'light' } })
})

import { setFolderIcon } from '../src/settings'

test('setFolderIcon persists a folder icon into settings.yaml', async () => {
    const vault = await emptyVault()
    await setFolderIcon(vault, 'projects', 'Folder')
    expect((await readSettings(vault))?.data.folderIcons ?? {}).toEqual({ projects: 'Folder' })
    const res = await readSettings(vault)
    expect((res!.data.folderIcons as Record<string, unknown>).projects).toBe(
        'Folder',
    )
})

test('setFolderIcon cannot inject a folderVisibility line through its key or icon', async () => {
    const vault = await emptyVault()
    const key = 'x:\nfolderVisibility:\n  Secret: all\n#'
    await setFolderIcon(vault, key, 'Folder\nfolderVisibility: {}')
    const res = await readSettings(vault)
    expect(res!.parseError).toBeUndefined()
    expect(res!.data.folderVisibility).toBeUndefined()
    expect((await readSettings(vault))?.data.folderIcons ?? {}).toEqual({
        [key]: 'Folder\nfolderVisibility: {}',
    })
})

test('setFolderIcon with an empty icon deletes the entry', async () => {
    const vault = await emptyVault()
    await setFolderIcon(vault, 'projects', 'Folder')
    await setFolderIcon(vault, 'projects', '')
    expect((await readSettings(vault))?.data.folderIcons ?? {}).toEqual({})
    // sparse: the emptied map is its default, so the key leaves the file too
    expect((await readSettings(vault))!.data.folderIcons).toBeUndefined()
})

test('a fresh vault reads folderIcons as an empty map', async () => {
    const vault = await emptyVault()
    await initializeSettings(vault)
    expect((await serializeSettingsForFrontend(vault)).folderIcons).toEqual({})
})

test('serializeSettingsForFrontend includes the folderIcons map', async () => {
    const vault = await emptyVault()
    await setFolderIcon(vault, 'projects', 'Folder')
    const data = await serializeSettingsForFrontend(vault)
    expect(data.folderIcons).toEqual({ projects: 'Folder' })
})

import { readFolderVisibility, setFolderVisibility } from '../src/settings'

test('readFolderVisibility returns {} when settings.yaml is absent', async () => {
    const vault = await emptyVault()
    expect(await readFolderVisibility(vault)).toEqual({})
})

test('setFolderVisibility persists a folder visibility into settings.yaml', async () => {
    const vault = await emptyVault()
    await setFolderVisibility(vault, 'private', 'hidden')
    expect(await readFolderVisibility(vault)).toEqual({ private: 'hidden' })
    const res = await readSettings(vault)
    expect(
        (res!.data.folderVisibility as Record<string, unknown>).private,
    ).toBe('hidden')
})

test('setFolderVisibility with a null/undefined value deletes the entry', async () => {
    const vault = await emptyVault()
    await setFolderVisibility(vault, 'private', 'chat-only')
    await setFolderVisibility(vault, 'private', null)
    expect(await readFolderVisibility(vault)).toEqual({})
})

test('setFolderVisibility ignores a value outside the two-literal union', async () => {
    const vault = await emptyVault()
    await setFolderVisibility(vault, 'private', 'hidden')
    // @ts-expect-error — deliberately invalid at the call site, mirrors runtime guard
    await setFolderVisibility(vault, 'private', 'all')
    expect(await readFolderVisibility(vault)).toEqual({})
})

test('a fresh vault reads folderVisibility as an empty map', async () => {
    const vault = await emptyVault()
    await initializeSettings(vault)
    expect(
        (await serializeSettingsForFrontend(vault)).folderVisibility,
    ).toEqual({})
})

test('serializeSettingsForFrontend includes the folderVisibility map', async () => {
    const vault = await emptyVault()
    await setFolderVisibility(vault, 'private', 'hidden')
    const data = await serializeSettingsForFrontend(vault)
    expect(data.folderVisibility).toEqual({ private: 'hidden' })
})

test("setFolderVisibility leaves a corrupt file's bytes unchanged (never clobbers content)", async () => {
    const vault = await emptyVault()
    await writeNote(vault, '.settings', ': : : not yaml\n[[[')
    const before = readFileSync(join(vault, '.settings'), 'utf8')
    await setFolderVisibility(vault, 'private', 'hidden')
    expect(readFileSync(join(vault, '.settings'), 'utf8')).toBe(before)
})

import { serializeSettingsForFrontend, SETTINGS_FILE } from '../src/settings'

test('serializeSettingsForFrontend returns defaults when no file exists', async () => {
    const vault = await emptyVault()
    const data = await serializeSettingsForFrontend(vault)
    expect((data.appearance as any).theme).toBe('ink')
    expect((data.graph as any).nodeSize).toBe(6)
})

test('serializeSettingsForFrontend overlays valid keys, ignoring wrong types', async () => {
    const vault = await emptyVault()
    await writeNote(
        vault,
        '.settings',
        'appearance:\n  uiFont: Monaspace Radon\n  editorFontSize: big\ngraph:\n  nodeSize: 9\n',
    )
    const data = await serializeSettingsForFrontend(vault)
    expect((data.appearance as any).uiFont).toBe('Monaspace Radon') // valid string, applied
    expect((data.appearance as any).editorFontSize).toBe(13.5) // "big" is wrong type → default
    expect((data.graph as any).nodeSize).toBe(9) // valid number, applied
})

test('serializeSettingsForFrontend clamps out-of-range numbers and invalid enums to defaults', async () => {
    const vault = await emptyVault()
    await writeNote(
        vault,
        '.settings',
        // editorFontSize max is 28, theme is an enum — both stored values are invalid.
        'appearance:\n  editorFontSize: 999\n  theme: not-a-real-theme\n',
    )
    const data = await serializeSettingsForFrontend(vault)
    expect((data.appearance as any).editorFontSize).toBe(13.5) // above max → default
    expect((data.appearance as any).theme).toBe('ink') // invalid enum → default
})

test('serializeSettingsForFrontend accepts a well-formed list leaf, rejects a malformed one', async () => {
    const vault = await emptyVault()
    await writeNote(
        vault,
        '.settings',
        'editor:\n  wrapSelectionChars: ["+", "="]\n',
    )
    const data = await serializeSettingsForFrontend(vault)
    expect((data.editor as any).wrapSelectionChars).toEqual(['+', '=']) // well-formed string[], applied

    const vault2 = await emptyVault()
    await writeNote(
        vault2,
        '.settings',
        // typeof [] === typeof {} === "object", so a malformed object must be caught structurally.
        'editor:\n  wrapSelectionChars: { foo: bar }\n',
    )
    const data2 = await serializeSettingsForFrontend(vault2)
    expect((data2.editor as any).wrapSelectionChars).toEqual([
        '*',
        '_',
        '~',
        '`',
    ]) // malformed → default
})

test('serializeSettingsForFrontend reads a list of objects (chat.presets) instead of resetting it', async () => {
    const vault = await emptyVault()
    await writeNote(
        vault,
        '.settings',
        [
            'chat:',
            '  presets:',
            '    - name: quick',
            '      provider: claude',
            '      model: haiku',
            '      effort: low',
            '    - name: bare',
            '      provider: codex',
            '    - not an object',
            '',
        ].join('\n'),
    )
    const data = await serializeSettingsForFrontend(vault)
    expect((data.chat as any).presets).toEqual([
        { name: 'quick', provider: 'claude', model: 'haiku', effort: 'low' },
        { name: 'bare', provider: 'codex', model: '', effort: '' }, // missing fields read as ""
    ]) // the non-object item is dropped
})

test('serializeSettingsForFrontend omits the properties registry section', async () => {
    const vault = await emptyVault()
    await writeNote(vault, '.settings', 'properties:\n  due: date\n')
    const data = await serializeSettingsForFrontend(vault)
    expect(data.properties).toBeUndefined()
})

import { readFileSync } from 'node:fs'

test('reconcile never fills missing keys — they read as their defaults instead', async () => {
    const vault = await emptyVault()
    await writeNote(
        vault,
        '.settings',
        'appearance:\n  uiFont: Monaspace Radon\n',
    )
    const wrote = await reconcileSettings(vault)
    expect(wrote).toBe(false)
    const { data } = (await readSettings(vault))!
    expect(data).toEqual({ appearance: { uiFont: 'Monaspace Radon' } })
    const merged = await serializeSettingsForFrontend(vault)
    expect((merged.appearance as any).uiFont).toBe('Monaspace Radon') // user value wins
    expect((merged.appearance as any).theme).toBe('ink') // absent → default
    expect((merged.graph as any).spin).toBe(true) // absent section → defaults
})

test('a value written equal to its default stays in a sparse file', async () => {
    const vault = await emptyVault()
    await writeNote(vault, '.settings', 'appearance:\n  theme: ink\n')
    expect(await reconcileSettings(vault)).toBe(false)
    expect((await readSettings(vault))!.data).toEqual({
        appearance: { theme: 'ink' },
    })
})

test('reconcile preserves unknown keys', async () => {
    const vault = await emptyVault()
    await writeNote(
        vault,
        '.settings',
        'appearance:\n  theme: ink\n  myCustomKey: 42\n',
    )
    await reconcileSettings(vault)
    const { data } = (await readSettings(vault))!
    expect((data.appearance as any).myCustomKey).toBe(42)
})

test('reconcile preserves comments', async () => {
    const vault = await emptyVault()
    await writeNote(
        vault,
        '.settings',
        '# my notes\nappearance:\n  theme: ink # inline\n',
    )
    await reconcileSettings(vault)
    const raw = readFileSync(join(vault, '.settings'), 'utf8')
    expect(raw).toContain('# my notes')
    expect(raw).toContain('# inline')
})

test('reconcile is a no-op write when nothing is missing', async () => {
    const vault = await emptyVault()
    await reconcileSettings(vault) // absent -> writes the sparse seed
    const before = readFileSync(join(vault, '.settings'), 'utf8')
    await reconcileSettings(vault) // second run must not rewrite
    const after = readFileSync(join(vault, '.settings'), 'utf8')
    expect(after).toBe(before)
})

test('reconcile leaves a corrupt file untouched', async () => {
    const vault = await emptyVault()
    await writeNote(vault, '.settings', ': : : not yaml\n[[[')
    const before = readFileSync(join(vault, '.settings'), 'utf8')
    await reconcileSettings(vault)
    expect(readFileSync(join(vault, '.settings'), 'utf8')).toBe(before)
})

import { DEFAULTS } from '../src/schema/settingsSchema'
import { parseDocument, stringify } from 'yaml'
const DEFAULT_APPEARANCE = DEFAULTS.appearance as Record<string, unknown>
const DEFAULT_EDITOR = DEFAULTS.editor as Record<string, unknown>

test('reconcile migrates a legacy-theme .settings file exactly once, resetting the type scale and pruning editorFont', async () => {
    const vault = await emptyVault()
    await writeNote(
        vault,
        '.settings',
        [
            '# my notes',
            'appearance:',
            '  theme: oxide-duotone # inline',
            '  editorFont: Lora',
            '  editorFontSize: 16',
            '  uiFontSize: 14',
            '  tabFontSize: 12',
            '  iconSize: 18',
            '  paletteInputFontSize: 17',
            '  monoScale: 0.85',
            '  sidebarWidth: 280',
            '  myCustomKey: 42',
            'editor:',
            '  lineHeight: 1.65',
            '',
        ].join('\n'),
    )
    await reconcileSettings(vault)
    const raw1 = readFileSync(join(vault, '.settings'), 'utf8')
    const { data } = (await readSettings(vault))!
    const appearance = data.appearance as any
    expect(appearance.theme).toBe('ink') // dark legacy name (no "-light" suffix)
    // editorFont is deleted outright, never translated — "Lora" does NOT end up forced onto
    // uiFont (a Monaspace-only key) or copied onto proseFont (which just resolves its own default).
    expect(appearance.editorFont).toBeUndefined()
    expect(appearance.uiFont).toBeUndefined()
    expect(appearance.proseFont).toBeUndefined()
    // The type scale is reset by REMOVING the keys: absent reads as the current default.
    expect(appearance.editorFontSize).toBeUndefined()
    expect(appearance.uiFontSize).toBeUndefined()
    expect(appearance.tabFontSize).toBeUndefined()
    expect(appearance.iconSize).toBeUndefined()
    // paletteInputFontSize is a retired key: pruned, not reset to a default it no longer has.
    expect(appearance.paletteInputFontSize).toBeUndefined()
    expect(appearance.monoScale).toBeUndefined()
    expect(appearance.sidebarWidth).toBeUndefined()
    expect(data.editor).toBeUndefined() // lineHeight was the section's only key — no `editor: {}` left
    const merged = await serializeSettingsForFrontend(vault)
    expect((merged.appearance as any).editorFontSize).toBe(
        DEFAULT_APPEARANCE.editorFontSize,
    )
    expect((merged.editor as any).lineHeight).toBe(DEFAULT_EDITOR.lineHeight)
    // Untouched: comments + unknown keys survive the rewrite.
    expect(appearance.myCustomKey).toBe(42)
    expect(raw1).toContain('# my notes')
    expect(raw1).toContain('# inline')
    // 'editorFont:' (with the colon) so this doesn't false-positive on the still-valid
    // 'editorFontSize:' key, which this same fixture also carries.
    expect(raw1).not.toContain('editorFont:')

    // Fires exactly once: a second reconcile is a no-op write (theme is now a current-era
    // value and editorFont is already gone, so neither trigger can match this file again).
    await reconcileSettings(vault)
    const raw2 = readFileSync(join(vault, '.settings'), 'utf8')
    expect(raw2).toBe(raw1)
})

test("reconcile maps a '-light' legacy theme to 'paper'", async () => {
    const vault = await emptyVault()
    await writeNote(
        vault,
        '.settings',
        'appearance:\n  theme: rose-gold-light\n',
    )
    await reconcileSettings(vault)
    const { data } = (await readSettings(vault))!
    expect((data.appearance as any).theme).toBe('paper')
})

test('reconcile prunes a legacy editorFont key outright, without triggering the type-scale reset when theme is already valid', async () => {
    const vault = await emptyVault()
    await writeNote(
        vault,
        '.settings',
        'appearance:\n  theme: cathode\n  editorFont: Georgia\n  editorFontSize: 20\n',
    )
    await reconcileSettings(vault)
    const { data } = (await readSettings(vault))!
    const appearance = data.appearance as any
    expect(appearance.theme).toBe('cathode') // already valid — left alone
    // editorFont alone no longer triggers migrateLegacyAppearance (that branch is gone); the
    // key is still gone, but via pruneRetiredKeys, not a value-based legacy-font migration —
    // and unlike the old font migration, pruning alone never resets the type scale.
    expect(appearance.editorFont).toBeUndefined()
    expect(appearance.editorFontSize).toBe(20) // no legacy-theme trigger fired — NOT reset
    expect(appearance.uiFont).toBeUndefined() // never inherits the deleted value
})

test('reconcile leaves a new-scheme .settings file untouched', async () => {
    const vault = await emptyVault()
    await reconcileSettings(vault) // absent -> writes the sparse seed
    const before = readFileSync(join(vault, '.settings'), 'utf8')
    const merged = await serializeSettingsForFrontend(vault)
    expect((merged.appearance as any).theme).toBe('ink')
    expect((merged.appearance as any).uiFont).toBe('Monaspace Xenon')
    expect((merged.appearance as any).proseFont).toBe('Libron')

    await reconcileSettings(vault) // nothing to migrate, nothing to strip
    const after = readFileSync(join(vault, '.settings'), 'utf8')
    expect(after).toBe(before) // byte-identical
})

test('reconcile leaves customized NEW-era appearance values untouched', async () => {
    const vault = await emptyVault()
    await writeNote(
        vault,
        '.settings',
        [
            'appearance:',
            '  theme: paper',
            '  uiFont: Monaspace Neon',
            '  proseFont: Monaspace Radon',
            '  editorFontSize: 20',
            '  uiFontSize: 13',
            '  sidebarWidth: 400',
            '  monoScale: 0.7',
            'editor:',
            '  lineHeight: 1.4',
            '',
        ].join('\n'),
    )
    await reconcileSettings(vault)
    const { data } = (await readSettings(vault))!
    const appearance = data.appearance as any
    expect(appearance.theme).toBe('paper')
    expect(appearance.uiFont).toBe('Monaspace Neon')
    expect(appearance.proseFont).toBe('Monaspace Radon')
    expect(appearance.editorFontSize).toBe(20)
    expect(appearance.uiFontSize).toBe(13)
    expect(appearance.sidebarWidth).toBe(400)
    expect(appearance.monoScale).toBe(0.7)
    expect((data.editor as any).lineHeight).toBe(1.4)
})

describe('reconcile strips a pre-sparse materialized defaults dump, once', () => {
    // What every vault was seeded with before `.settings` went sparse: the whole schema, at defaults.
    const dumpDoc = () => parseDocument(stringify(DEFAULTS))

    test('every default leaf goes; overrides, unknown keys and commented lines stay', async () => {
        const vault = await emptyVault()
        const doc = dumpDoc()
        doc.setIn(['appearance', 'theme'], 'paper') // a real override
        doc.setIn(['graph', 'myCustomKey'], 42) // unknown key
        const spin = doc.getIn(['graph', 'spin'], true) as { comment?: string }
        spin.comment = ' keep spinning' // a commented default — the comment is the user's
        await writeNote(vault, '.settings', doc.toString())

        expect(await reconcileSettings(vault)).toBe(true)
        const { data, raw } = (await readSettings(vault))!
        expect(data).toEqual({
            appearance: { theme: 'paper' },
            graph: { spin: true, myCustomKey: 42 },
        })
        expect(raw).toContain('# keep spinning')

        // Fires once: what is left is a sparse file, which is never stripped again.
        expect(await reconcileSettings(vault)).toBe(false)
    })

    test('an older dump missing keys added since still strips', async () => {
        const vault = await emptyVault()
        const doc = dumpDoc()
        for (const section of ['calendar', 'terminal', 'chat', 'daemon'])
            doc.deleteIn([section]) // sections a long-ago dump never had
        doc.setIn(['editor', 'lineHeight'], 1.4)
        await writeNote(vault, '.settings', doc.toString())

        await reconcileSettings(vault)
        expect((await readSettings(vault))!.data).toEqual({
            editor: { lineHeight: 1.4 },
        })
    })

    test('a stripped file reads exactly as the dump did', async () => {
        const vault = await emptyVault()
        const doc = dumpDoc()
        doc.setIn(['graph', 'nodeSize'], 9)
        await writeNote(vault, '.settings', doc.toString())
        // appearance.tokens lists only keys PRESENT in the file (legacy keys folded in), so the
        // dump's default-valued legacy keys vanish from it once stripped. Every other field of the
        // feed is unchanged; the dropped tokens were all at their registry defaults.
        const strip = (feed: any) => {
            const { tokens, ...appearance } = feed.appearance
            return [{ ...feed, appearance }, tokens] as const
        }
        const [before, tokensBefore] = strip(await serializeSettingsForFrontend(vault))
        await reconcileSettings(vault)
        const [after, tokensAfter] = strip(await serializeSettingsForFrontend(vault))
        expect(after).toEqual(before)
        expect(Object.keys(tokensBefore).length).toBeGreaterThan(0)
        expect(tokensAfter).toEqual({})
    })
})

describe('reconcile prunes retired schema keys', () => {
    test('editor.defaultMode is removed on reconcile and the file is rewritten', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'editor:\n  defaultMode: visual\n  livePreview: true\n',
        )
        const wrote = await reconcileSettings(vault)
        expect(wrote).toBe(true)
        const { data } = (await readSettings(vault))!
        expect((data.editor as any).defaultMode).toBeUndefined()
        expect((data.editor as any).livePreview).toBe(true)
    })

    test('appearance.paletteInputFontSize is removed on reconcile, siblings kept', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'appearance:\n  theme: cathode\n  paletteInputFontSize: 17\n  editorFontSize: 20\n',
        )
        const wrote = await reconcileSettings(vault)
        expect(wrote).toBe(true)
        const { data } = (await readSettings(vault))!
        const appearance = data.appearance as any
        expect(appearance.paletteInputFontSize).toBeUndefined()
        expect(appearance.editorFontSize).toBe(20)
    })

    test('the terminal section is removed, its cursor keys moved to appearance first', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'terminal:\n  fontSize: 15\n  lineHeight: 1.8\n  cursorWidth: 3\n',
        )
        const wrote = await reconcileSettings(vault)
        expect(wrote).toBe(true)
        const { data } = (await readSettings(vault))!
        expect((data as any).terminal).toBeUndefined()
        expect((data.appearance as any).cursorWidth).toBe(3)
    })

    test('daemon.recall.semantic moves to embeddings.enabled and the old key is gone', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'daemon:\n  recall:\n    semantic: true\n',
        )
        expect(await reconcileSettings(vault)).toBe(true)
        const { data } = (await readSettings(vault))!
        expect((data as any).embeddings).toEqual({ enabled: true })
        expect((data as any).daemon).toBeUndefined() // no empty daemon/recall husk left behind
        const raw = readFileSync(join(vault, '.settings'), 'utf8')
        expect(raw).not.toContain('semantic')
        expect(await reconcileSettings(vault)).toBe(false) // settled
    })

    test('daemon.recall.semantic false moves too, beside sibling recall keys', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'daemon:\n  recall:\n    midTurn: false\n    semantic: false\n',
        )
        await reconcileSettings(vault)
        const { data } = (await readSettings(vault))!
        expect((data as any).embeddings).toEqual({ enabled: false })
        expect((data as any).daemon.recall).toEqual({ midTurn: false })
    })

    test('an existing embeddings.enabled wins over daemon.recall.semantic, which is deleted', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'embeddings:\n  enabled: false\ndaemon:\n  recall:\n    semantic: true\n',
        )
        expect(await reconcileSettings(vault)).toBe(true)
        const { data } = (await readSettings(vault))!
        expect((data as any).embeddings).toEqual({ enabled: false })
        expect(readFileSync(join(vault, '.settings'), 'utf8')).not.toContain('semantic')
    })

    test('the comment above daemon.recall.semantic travels to embeddings.enabled', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'daemon:\n  recall:\n    midTurn: false\n    # meaning search, my note\n    semantic: true\n',
        )
        await reconcileSettings(vault)
        const raw = readFileSync(join(vault, '.settings'), 'utf8')
        expect(raw).toContain('# meaning search, my note')
        expect(raw.indexOf('# meaning search, my note')).toBeGreaterThan(
            raw.indexOf('embeddings'),
        )
        expect(raw.indexOf('# meaning search, my note')).toBeLessThan(raw.indexOf('enabled'))
    })

    test('a comment above the emptied daemon section survives the move', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            '# my daemon notes\ndaemon:\n  recall:\n    semantic: true\n',
        )
        await reconcileSettings(vault)
        const { data } = (await readSettings(vault))!
        expect((data as any).embeddings).toEqual({ enabled: true })
        expect(readFileSync(join(vault, '.settings'), 'utf8')).toContain('# my daemon notes')
    })

    test('a comment above the emptied recall section survives the move', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'daemon:\n  enabled: true\n  # recall tuning\n  recall:\n    semantic: true\n',
        )
        await reconcileSettings(vault)
        const { data } = (await readSettings(vault))!
        expect((data as any).embeddings).toEqual({ enabled: true })
        expect(readFileSync(join(vault, '.settings'), 'utf8')).toContain('# recall tuning')
    })

    test('daemon.recall.semantic moves into an embeddings section whose value is null', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'embeddings:\ndaemon:\n  recall:\n    semantic: true\n',
        )
        await reconcileSettings(vault)
        const { data } = (await readSettings(vault))!
        expect((data as any).embeddings).toEqual({ enabled: true })
        expect(readFileSync(join(vault, '.settings'), 'utf8')).not.toContain('semantic')
    })

    test('daemon.recall.semantic moves into an embeddings section holding a scalar', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'embeddings: true\ndaemon:\n  recall:\n    semantic: true\n',
        )
        await reconcileSettings(vault)
        const { data } = (await readSettings(vault))!
        expect((data as any).embeddings).toEqual({ enabled: true })
    })

    test('terminal cursor keys move into an appearance section whose value is null', async () => {
        const vault = await emptyVault()
        await writeNote(vault, '.settings', 'appearance:\nterminal:\n  cursorWidth: 3\n')
        await reconcileSettings(vault)
        const { data } = (await readSettings(vault))!
        expect((data.appearance as any).cursorWidth).toBe(3)
        expect((data as any).terminal).toBeUndefined()
    })

    test('terminal cursor keys move into an appearance section holding a scalar', async () => {
        const vault = await emptyVault()
        await writeNote(vault, '.settings', 'appearance: 5\nterminal:\n  cursorWidth: 3\n')
        await reconcileSettings(vault)
        const { data } = (await readSettings(vault))!
        expect((data.appearance as any).cursorWidth).toBe(3)
    })

    test('a comment above the first key of a moved section travels with the key', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'terminal:\n  # cursor note\n  cursorWidth: 3\n  fontSize: 15\n',
        )
        await reconcileSettings(vault)
        const raw = readFileSync(join(vault, '.settings'), 'utf8')
        expect(raw).toContain('# cursor note')
        expect(raw.indexOf('# cursor note')).toBeGreaterThan(raw.indexOf('appearance'))
        expect(raw.indexOf('# cursor note')).toBeLessThan(raw.indexOf('cursorWidth'))
    })

    test('a first-key comment moves without leaving an orphan beside a surviving sibling', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'daemon:\n  recall:\n    # which\n    semantic: true\n    other: 1\n',
        )
        await reconcileSettings(vault)
        const raw = readFileSync(join(vault, '.settings'), 'utf8')
        expect(raw.split('# which').length).toBe(2) // exactly once
        expect(raw.indexOf('# which')).toBeGreaterThan(raw.indexOf('embeddings'))
        expect(raw.indexOf('# which')).toBeLessThan(raw.indexOf('enabled'))
        const { data } = (await readSettings(vault))!
        expect((data as any).daemon.recall).toEqual({ other: 1 })
    })

    test('a scalar in a moved key\'s destination section is replaced with a warning naming it', async () => {
        const vault = await emptyVault()
        await writeNote(vault, '.settings', 'appearance: 5\nterminal:\n  cursorWidth: 3\n')
        const warned: string[] = []
        const warn = console.warn
        console.warn = (...a: unknown[]) => void warned.push(a.join(' '))
        try {
            await reconcileSettings(vault)
        } finally {
            console.warn = warn
        }
        expect(warned).toHaveLength(1)
        expect(warned[0]).toContain('appearance')
        expect(warned[0]).toContain('5')
    })

    test('a file that never had defaultMode is not rewritten by the prune step', async () => {
        const vault = await emptyVault()
        await reconcileSettings(vault) // absent -> writes the sparse seed (no defaultMode)
        const before = readFileSync(join(vault, '.settings'), 'utf8')
        const wrote = await reconcileSettings(vault)
        expect(wrote).toBe(false)
        expect(readFileSync(join(vault, '.settings'), 'utf8')).toBe(before)
    })

    test('a comment written directly above the retired key survives the prune', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'editor:\n  # a comment nested inside a section\n  defaultMode: visual\n',
        )
        await reconcileSettings(vault)
        const raw = readFileSync(join(vault, '.settings'), 'utf8')
        expect(raw).toContain('# a comment nested inside a section')
        expect(raw).not.toContain('defaultMode')
    })
})

import { setSettingInFile } from '../src/settings'

test('setSettingInFile updates a nested key, preserving siblings/comments/unknowns', async () => {
    const vault = await emptyVault()
    await writeNote(
        vault,
        '.settings',
        '# hdr\nappearance:\n  theme: ink\n  myCustom: 1\ngraph:\n  spin: true\n',
    )
    await setSettingInFile(vault, ['appearance', 'theme'], 'light')
    const raw = readFileSync(join(vault, '.settings'), 'utf8')
    const { data } = (await readSettings(vault))!
    expect((data.appearance as any).theme).toBe('light')
    expect((data.appearance as any).myCustom).toBe(1) // unknown preserved
    expect((data.graph as any).spin).toBe(true) // sibling preserved
    expect(raw).toContain('# hdr') // comment preserved
})

test('setSettingInFile creates the file (via reconcile) when absent, then sets the key', async () => {
    const vault = await emptyVault()
    await setSettingInFile(vault, ['graph', 'nodeSize'], 12)
    const { data } = (await readSettings(vault))!
    expect(data).toEqual({ graph: { nodeSize: 12 } }) // only the change is written
    const raw = readFileSync(join(vault, '.settings'), 'utf8')
    expect(raw.startsWith(SETTINGS_SEED)).toBe(true) // the seed's header survives the write
})

test('setSettingInFile ignores an empty path', async () => {
    const vault = await emptyVault()
    await writeNote(vault, '.settings', 'appearance:\n  theme: ink\n')
    await setSettingInFile(vault, [], 'x')
    const { data } = (await readSettings(vault))!
    expect((data.appearance as any).theme).toBe('ink')
})

test("setSettingInFile leaves a corrupt file's bytes unchanged", async () => {
    const vault = await emptyVault()
    await writeNote(vault, '.settings', ': : : not yaml\n[[[')
    const before = readFileSync(join(vault, '.settings'), 'utf8')
    await setSettingInFile(vault, ['appearance', 'theme'], 'light')
    expect(readFileSync(join(vault, '.settings'), 'utf8')).toBe(before)
})

test("setFolderIcon leaves a corrupt file's bytes unchanged (never clobbers content)", async () => {
    const vault = await emptyVault()
    await writeNote(vault, '.settings', ': : : not yaml\n[[[')
    const before = readFileSync(join(vault, '.settings'), 'utf8')
    await setFolderIcon(vault, 'projects', 'Folder')
    expect(readFileSync(join(vault, '.settings'), 'utf8')).toBe(before)
})

import { loadAppConfig } from '../src/settings'

test('loadAppConfig returns file values merged over defaults, typed', async () => {
    const vault = await emptyVault()
    await writeNote(vault, '.settings', 'graph:\n  repulsion: -22\n')
    const cfg = await loadAppConfig(vault)
    expect((cfg.graph as any).repulsion).toBe(-22) // from file
    expect((cfg.graph as any).linkDistance).toBe(5) // schema default
    expect((cfg.appearance as any).theme).toBe('ink') // schema default
})

// --- toolbar serialization ---

function freshVault(): string {
    return tempDir('bismuth-toolbar-')
}

describe('toolbar serialization', () => {
    it('seeds the default toolbar into a fresh settings.yaml and serializes it', async () => {
        const vault = freshVault()
        await reconcileSettings(vault) // writes a fresh settings.yaml with defaults
        const out = await serializeSettingsForFrontend(vault)
        expect(out.toolbar).toEqual([
            { command: 'create-menu', icon: 'Plus' },
            { command: 'search', icon: 'Search' },
            { command: 'open-inbox', icon: 'Inbox' },
        ])
    })

    it('passes a user-defined toolbar list through, dropping malformed items', async () => {
        const vault = freshVault()
        await Bun.write(
            join(vault, SETTINGS_FILE),
            [
                'toolbar:',
                '  - command: settings',
                '    icon: Settings',
                '    tooltip: Preferences',
                '  - command: graph-both',
                '  - icon: Bug',
                '  - command: terminal',
                '    icon: SquareTerminal',
            ].join('\n'),
        )
        const out = await serializeSettingsForFrontend(vault)
        expect(out.toolbar).toEqual([
            { command: 'settings', icon: 'Settings', tooltip: 'Preferences' },
            { command: 'terminal', icon: 'SquareTerminal' },
        ])
    })

    it('honors an explicit empty toolbar', async () => {
        const vault = freshVault()
        await Bun.write(join(vault, SETTINGS_FILE), 'toolbar: []\n')
        const out = await serializeSettingsForFrontend(vault)
        expect(out.toolbar).toEqual([])
    })

    it('a user tabBar SHORTER than the default is honored as-is, not index-padded with the default', async () => {
        // Regression: removing the terminal button (default is [new-tab, terminal, new-claude-chat])
        // used to leave the default's trailing new-claude-chat at index 2 — rendering [+][💬][💬].
        const vault = freshVault()
        await Bun.write(
            join(vault, SETTINGS_FILE),
            [
                'tabBar:',
                '  - command: new-tab',
                '    icon: SquarePlus',
                '  - command: new-claude-chat',
                '    icon: MessageSquare',
            ].join('\n'),
        )
        const out = await serializeSettingsForFrontend(vault)
        expect(out.tabBar).toEqual([
            { command: 'new-tab', icon: 'SquarePlus' },
            { command: 'new-claude-chat', icon: 'MessageSquare' },
        ])
    })

    it('seeds the default tabBar into a fresh vault', async () => {
        const vault = freshVault()
        await reconcileSettings(vault)
        const out = await serializeSettingsForFrontend(vault)
        expect(out.tabBar).toEqual([
            { command: 'new-tab', icon: 'SquarePlus' },
            { command: 'terminal', icon: 'SquareTerminal' },
            { command: 'new-claude-chat', icon: 'MessageSquare' },
        ])
    })

    it('passes a multi-command button (commands list) through', async () => {
        const vault = freshVault()
        await Bun.write(
            join(vault, SETTINGS_FILE),
            [
                'toolbar:',
                '  - commands:',
                '      - new-note',
                '      - terminal',
                '    icon: Rocket',
                '    tooltip: Note + terminal',
            ].join('\n'),
        )
        const out = await serializeSettingsForFrontend(vault)
        expect(out.toolbar).toEqual([
            {
                commands: ['new-note', 'terminal'],
                icon: 'Rocket',
                tooltip: 'Note + terminal',
            },
        ])
    })

    it('drops a button that has neither command nor a non-empty commands list', async () => {
        const vault = freshVault()
        await Bun.write(
            join(vault, SETTINGS_FILE),
            [
                'toolbar:',
                '  - commands: []',
                '    icon: Empty',
                '  - command: terminal',
                '    icon: SquareTerminal',
            ].join('\n'),
        )
        const out = await serializeSettingsForFrontend(vault)
        expect(out.toolbar).toEqual([
            { command: 'terminal', icon: 'SquareTerminal' },
        ])
    })
})

// --- dailyNotes serialization ---

describe('dailyNotes serialization', () => {
    it('seeds the default journal config into a fresh settings.yaml', async () => {
        const vault = tempDir('bismuth-daily-')
        await reconcileSettings(vault)
        const out = await serializeSettingsForFrontend(vault)
        expect(out.dailyNotes).toEqual([
            {
                id: 'journal',
                label: 'Journal',
                icon: 'BookOpen',
                folder: 'Journal',
                fileName: '{{date}} journal',
                template: 'Templates/Journal.md',
            },
        ])
    })

    it('drops malformed items and fills field defaults', async () => {
        const vault = tempDir('bismuth-daily-')
        await Bun.write(
            join(vault, SETTINGS_FILE),
            [
                'dailyNotes:',
                '  - id: work',
                '    fileName: "{{date}} work"',
                '  - label: NoId',
                '  - id: noFile',
            ].join('\n'),
        )
        const out = await serializeSettingsForFrontend(vault)
        expect(out.dailyNotes).toEqual([
            {
                id: 'work',
                label: 'work',
                icon: 'CalendarDays',
                folder: '',
                fileName: '{{date}} work',
                template: '',
            },
        ])
    })

    it('honors an explicit empty list', async () => {
        const vault = tempDir('bismuth-daily-')
        await Bun.write(join(vault, SETTINGS_FILE), 'dailyNotes: []\n')
        const out = await serializeSettingsForFrontend(vault)
        expect(out.dailyNotes).toEqual([])
    })
})

// --- concurrent mutation safety ---

describe('concurrent setSettingInFile', () => {
    it('serializes concurrent requests so none clobber each other', async () => {
        const vault = await emptyVault()
        // Set up initial settings with multiple keys
        await writeNote(
            vault,
            '.settings',
            'appearance:\n  theme: ink\n  uiFont: Monaspace Radon\ngraph:\n  nodeSize: 5\n',
        )

        // Fire 3 concurrent requests that each modify a different key
        const results = await Promise.all([
            setSettingInFile(vault, ['appearance', 'theme'], 'cathode'),
            setSettingInFile(
                vault,
                ['appearance', 'uiFont'],
                'Monaspace Neon',
            ),
            setSettingInFile(vault, ['graph', 'nodeSize'], 10),
        ])

        // All requests should complete successfully
        expect(results).toHaveLength(3)

        // Verify all three changes were persisted (none clobbered)
        const { data } = (await readSettings(vault))!
        expect((data.appearance as any).theme).toBe('cathode')
        expect((data.appearance as any).uiFont).toBe('Monaspace Neon')
        expect((data.graph as any).nodeSize).toBe(10)
    })

    it('preserves file integrity across concurrent mutations', async () => {
        const vault = await emptyVault()
        const comment = '# important settings\n'
        const custom = 'myCustomKey: 42\n'
        await writeNote(
            vault,
            '.settings',
            `${comment}appearance:\n  theme: ink\n${custom}graph:\n  spin: true\n`,
        )

        // Fire multiple concurrent mutations
        await Promise.all([
            setSettingInFile(vault, ['appearance', 'theme'], 'light'),
            setSettingInFile(vault, ['graph', 'spin'], false),
        ])

        const raw = readFileSync(join(vault, '.settings'), 'utf8')

        // Comments and unknown keys must survive concurrent mutations
        expect(raw).toContain(comment)
        expect(raw).toContain(custom)

        // And the updated values must be present
        const { data } = (await readSettings(vault))!
        expect((data.appearance as any).theme).toBe('light')
        expect((data.graph as any).spin).toBe(false)
    })

    it('handles high-concurrency scenarios (10+ requests)', async () => {
        const vault = await emptyVault()
        await reconcileSettings(vault) // set up a fresh settings.yaml

        // Fire 20 concurrent mutations to different keys
        const promises = Array.from({ length: 20 }, (_, i) =>
            setSettingInFile(vault, ['graph', 'nodeSize'], i),
        )
        await Promise.all(promises)

        // The final value should be one of the submitted values (deterministic last write)
        const { data } = (await readSettings(vault))!
        const final = (data.graph as any).nodeSize
        expect(final).toBeGreaterThanOrEqual(0)
        expect(final).toBeLessThan(20)
    })

    it('should handle 100+ concurrent mutations atomically', async () => {
        const vault = await emptyVault()
        await reconcileSettings(vault) // set up a fresh settings.yaml

        // Fire 100 concurrent mutations, each to a different key
        // Using a nested structure to avoid key collisions
        const promises = Array.from({ length: 100 }, (_, i) => {
            const keyPath = ['graph', `testKey${i}`]
            const value = `value_${i}`
            return setSettingInFile(vault, keyPath, value)
        })

        await Promise.all(promises)

        // Verify all 100 changes persisted correctly
        const { data } = (await readSettings(vault))!
        const graphData = data.graph as Record<string, unknown>

        let successCount = 0
        for (let i = 0; i < 100; i++) {
            const key = `testKey${i}`
            const expected = `value_${i}`
            if (graphData[key] === expected) {
                successCount++
            }
        }

        // All 100 mutations must have persisted successfully
        expect(successCount).toBe(100)
        expect(graphData.nodeSize).toBeUndefined() // sparse: reconcile never materializes defaults
    })

    it('should not bottleneck under 100+ concurrent mutations with different key paths', async () => {
        const vault = await emptyVault()
        await reconcileSettings(vault) // set up a fresh settings.yaml

        const startTime = Date.now()

        // Fire 150 concurrent mutations across different sections
        const promises = Array.from({ length: 150 }, (_, i) => {
            let keyPath: string[]
            const section = i % 3
            if (section === 0) {
                keyPath = ['appearance', `concurrKey${i}`]
            } else if (section === 1) {
                keyPath = ['graph', `concurrKey${i}`]
            } else {
                keyPath = ['calendar', `concurrKey${i}`]
            }
            return setSettingInFile(vault, keyPath, i)
        })

        await Promise.all(promises)
        const duration = Date.now() - startTime

        // Verify all changes persisted
        const { data } = (await readSettings(vault))!
        let totalPersistedChanges = 0

        for (let i = 0; i < 150; i++) {
            const section = i % 3
            const key = `concurrKey${i}`
            let sectionData: Record<string, unknown>

            if (section === 0) {
                sectionData = data.appearance as Record<string, unknown>
            } else if (section === 1) {
                sectionData = data.graph as Record<string, unknown>
            } else {
                sectionData = data.calendar as Record<string, unknown>
            }

            if (sectionData[key] === i) {
                totalPersistedChanges++
            }
        }

        // All 150 mutations must persist
        expect(totalPersistedChanges).toBe(150)
        // Should complete in reasonable time (not severely bottlenecked)
        // Allowing 5s for 150 mutations on typical hardware
        expect(duration).toBeLessThan(5000)
    })
})

describe('reconcileSettings daemon migration (now a no-op)', () => {
    let prevDir: string | undefined
    let tmpDir: string | undefined

    afterEach(() => {
        if (prevDir === undefined) delete process.env.BISMUTH_DAEMON_DIR
        else process.env.BISMUTH_DAEMON_DIR = prevDir
        if (tmpDir) {
            try {
                rmSync(tmpDir, { recursive: true, force: true })
            } catch {
                /* */
            }
            tmpDir = undefined
        }
    })

    // The daemon is bundled now: home is fixed (not a setting) and there is no
    // adopt-on-reconcile. Reconcile fills the new `name` key but never re-adds the
    // obsolete `home`, and never flips `enabled` even when a device is installed.
    it('does NOT adopt (enable) an installed daemon and never writes daemon.home', async () => {
        const vault = await emptyVault()
        await writeNote(vault, '.settings', 'daemon:\n  enabled: false\n')
        prevDir = process.env.BISMUTH_DAEMON_DIR
        tmpDir = tempDir('bismuth-daemon-')
        writeFileSync(join(tmpDir, 'device-id'), 'dev-x\n') // looks installed on this machine
        process.env.BISMUTH_DAEMON_DIR = tmpDir
        await reconcileSettings(vault)
        const res = await readSettings(vault)
        const daemon = (res!.data as any).daemon
        expect(daemon.enabled).toBe(false) // no adoption — the master switch stays as written
        expect(daemon.name).toBeUndefined() // name moved to .daemon/identity.md — not a settings key
        expect(daemon.home).toBeUndefined() // home is gone — migration never re-adds it
    })
})

describe('readDaemonEnabledSync', () => {
    it('returns the schema default (false) when there is no settings file', async () => {
        const vault = await emptyVault()
        expect(readDaemonEnabledSync(vault)).toBe(false)
    })

    it('reads daemon.enabled: true from the .settings file', async () => {
        const vault = await emptyVault()
        await writeNote(vault, '.settings', 'daemon:\n  enabled: true\n')
        expect(readDaemonEnabledSync(vault)).toBe(true)
    })

    it('reads daemon.enabled: false from the .settings file', async () => {
        const vault = await emptyVault()
        await writeNote(vault, '.settings', 'daemon:\n  enabled: false\n')
        expect(readDaemonEnabledSync(vault)).toBe(false)
    })

    it('degrades to false on a missing daemon section or non-boolean value', async () => {
        const vault = await emptyVault()
        await writeNote(vault, '.settings', 'appearance:\n  theme: light\n')
        expect(readDaemonEnabledSync(vault)).toBe(false)
        await writeNote(vault, '.settings', 'daemon:\n  enabled: yep\n')
        expect(readDaemonEnabledSync(vault)).toBe(false)
    })

    it('degrades to false on a corrupt file rather than throwing', async () => {
        const vault = await emptyVault()
        await writeNote(vault, '.settings', ': : : not yaml\n[[[')
        expect(readDaemonEnabledSync(vault)).toBe(false)
    })

    it('matches the value a full loadAppConfig resolves (sync seed == async load)', async () => {
        const vault = await emptyVault()
        await writeNote(vault, '.settings', 'daemon:\n  enabled: true\n')
        const cfg = await loadAppConfig(vault)
        expect(readDaemonEnabledSync(vault)).toBe(
            (cfg.daemon as { enabled: boolean }).enabled,
        )
    })
})

import { readFolderVisibilityResult } from '../src/settings'

describe('readFolderVisibilityResult fails closed on malformed rules', () => {
    test('an unknown value is not ok and names neither the key nor the value', async () => {
        const vault = await emptyVault()
        writeFileSync(
            join(vault, '.settings'),
            'folderVisibility:\n  Vault Hidden: hiden\n',
        )
        const r = await readFolderVisibilityResult(vault)
        expect(r.ok).toBe(false)
        if (!r.ok) {
            // The key is a hidden folder's name, and this reason reaches agents.
            expect(r.reason).toContain('a folderVisibility entry is not')
            expect(r.reason).not.toContain('Vault Hidden')
            expect(r.reason).not.toContain('hiden')
        }
    })

    test('a non-map folderVisibility is not ok', async () => {
        const vault = await emptyVault()
        writeFileSync(join(vault, '.settings'), 'folderVisibility: [a]\n')
        expect((await readFolderVisibilityResult(vault)).ok).toBe(false)
    })

    test('all is accepted and dropped from the map', async () => {
        const vault = await emptyVault()
        writeFileSync(
            join(vault, '.settings'),
            'folderVisibility:\n  Open: all\n  Priv: hidden\n',
        )
        expect(await readFolderVisibilityResult(vault)).toEqual({
            ok: true,
            map: { Priv: 'hidden' },
        })
    })

    test('absent folderVisibility is ok and empty', async () => {
        const vault = await emptyVault()
        writeFileSync(join(vault, '.settings'), 'theme: ink\n')
        expect(await readFolderVisibilityResult(vault)).toEqual({
            ok: true,
            map: {},
        })
    })
})

test('serializeSettingsForFrontend accepts a valid custom theme name and rejects an unknown one', async () => {
    const { themeTemplate } = await import('../src/theme/customTheme')
    const vault = await emptyVault()
    await writeNote(vault, '.themes/dusk.yaml', themeTemplate({ label: 'Dusk', extends: 'ink' }))
    await writeNote(vault, '.settings', 'appearance:\n  theme: dusk\n')
    const ok = await serializeSettingsForFrontend(vault)
    expect((ok.appearance as Record<string, unknown>).theme).toBe('dusk')
    await writeNote(vault, '.settings', 'appearance:\n  theme: nope\n')
    const bad = await serializeSettingsForFrontend(vault)
    expect((bad.appearance as Record<string, unknown>).theme).toBe('ink')
})

describe('appearance.tokens in the frontend feed', () => {
    test('validated, normalized, present-only; an explicit token beats its legacy key', async () => {
        const vault = await emptyVault()
        await writeNote(
            vault,
            '.settings',
            'appearance:\n  editorFontSize: 16\n  tokens:\n    sp-3: 10px\n    editor-font-size: 18px\n    bogus: 1\n',
        )
        const feed = (await serializeSettingsForFrontend(vault)) as any
        expect(feed.appearance.tokens).toEqual({
            'editor-font-size': '18px',
            'sp-3': '10px',
        })
        expect(feed.appearance.editorFontSize).toBe(16)
    })

    test('a legacy key alone folds into tokens', async () => {
        const vault = await emptyVault()
        await writeNote(vault, '.settings', 'appearance:\n  editorFontSize: 16\n')
        const feed = (await serializeSettingsForFrontend(vault)) as any
        expect(feed.appearance.tokens['editor-font-size']).toBe('16px')
        expect(feed.appearance.editorFontSize).toBe(16)
    })

    test('no tokens and no legacy keys gives {}', async () => {
        const vault = await emptyVault()
        const feed = (await serializeSettingsForFrontend(vault)) as any
        expect(feed.appearance.tokens).toEqual({})
        await writeNote(vault, '.settings', 'graph:\n  spin: false\n')
        const feed2 = (await serializeSettingsForFrontend(vault)) as any
        expect(feed2.appearance.tokens).toEqual({})
    })
})
