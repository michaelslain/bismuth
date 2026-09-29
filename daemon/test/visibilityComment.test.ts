// A trailing YAML comment on `visibility:` must not defeat the deny list. Core parses frontmatter
// with the `yaml` package (`hidden # private` -> `hidden`); the daemon's line-regex reader used to
// keep the comment, fail the literal check, inherit "all", and leave the note readable to a cron.
import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDenyPaths } from '../src/lib/visibility.ts'
import { readVaultSettingsDoc } from '../src/lib/vaultSettings.ts'

test('visibility: hidden # comment is in the deny list', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bismuth-vis-'))
    try {
        writeFileSync(
            join(root, 'secret.md'),
            '---\nvisibility: hidden # private\n---\nbody\n',
        )
        writeFileSync(join(root, 'open.md'), '---\ntitle: x\n---\nbody\n')
        const entries = await buildDenyPaths(root)
        expect(entries.map(e => e.rel)).toEqual(['secret.md'])
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test('readVaultSettingsDoc: first readable shape wins, null when none', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bismuth-vs-'))
    try {
        expect(await readVaultSettingsDoc(root)).toBeNull()
        writeFileSync(join(root, 'settings.yaml'), 'daemon:\n  enabled: true\n')
        expect(await readVaultSettingsDoc(root)).toEqual({
            daemon: { enabled: true },
        })
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})
