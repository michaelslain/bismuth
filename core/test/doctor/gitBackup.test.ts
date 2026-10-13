// The doctor's backup store against real git and tar under a temp home: a backup is one commit
// whose tarball restores the touched paths byte for byte, and the work tree is left empty.
import { describe, expect, test } from 'bun:test'
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../tempDirs'
import { defaultExec } from '../../src/serviceUnit'
import {
    backupFileName,
    gitBackup,
    restoreCommand,
} from '../../src/doctor/gitBackup'
import { activityVaults } from '../../src/doctor/context'

describe('gitBackup', () => {
    test('commits a tarball of the touched paths and restores them after deletion', async () => {
        const home = tempDir('doctor-backup-')
        const bismuthHome = join(home, '.bismuth')
        const victim = join(home, '.claude-bot')
        mkdirSync(join(victim, 'memory', '.git'), { recursive: true })
        writeFileSync(join(victim, 'memory', 'note.md'), 'keep me')
        writeFileSync(join(victim, 'memory', '.git', 'HEAD'), 'ref: x')
        symlinkSync('memory/note.md', join(victim, 'link'))

        const b = await gitBackup(
            { exec: defaultExec, bismuthHome, now: () => new Date('2026-10-13T18:44:05.123Z') },
            'legacy.claude-bot-home',
            `delete ${victim}`,
            [victim, join(home, 'gone')],
        )
        expect(b).not.toBeNull()
        expect(b!.repo).toBe(join(bismuthHome, 'doctor-backups'))
        expect(b!.file).toBe('legacy.claude-bot-home-20261013T184405Z.tar.gz')
        expect(b!.commit).toMatch(/^[0-9a-f]{40}$/)
        expect(readdirSync(b!.repo)).toEqual(['.git'])

        rmSync(victim, { recursive: true })
        const r = await defaultExec(['bash', '-c', restoreCommand(b!)], 30_000)
        expect(r.stderr).toBe('')
        expect(r.code).toBe(0)
        expect(readFileSync(join(victim, 'memory', 'note.md'), 'utf8')).toBe('keep me')
        expect(readFileSync(join(victim, 'memory', '.git', 'HEAD'), 'utf8')).toBe('ref: x')
        expect(readFileSync(join(victim, 'link'), 'utf8')).toBe('keep me')
    })
    test('null when none of the paths exist, and no repo is created', async () => {
        const home = tempDir('doctor-backup-')
        const b = await gitBackup(
            { exec: defaultExec, bismuthHome: join(home, '.bismuth') },
            'x',
            'd',
            [join(home, 'missing')],
        )
        expect(b).toBeNull()
        expect(existsSync(join(home, '.bismuth', 'doctor-backups'))).toBe(false)
    })
    test('throws when a step fails, so the engine leaves the repair unapplied', async () => {
        const home = tempDir('doctor-backup-')
        writeFileSync(join(home, 'f'), 'x')
        await expect(
            gitBackup(
                {
                    exec: async () => ({ code: 1, stdout: '', stderr: 'nope' }),
                    bismuthHome: join(home, '.bismuth'),
                },
                'x',
                'd',
                [join(home, 'f')],
            ),
        ).rejects.toThrow('git init failed: nope')
    })
    test('file names keep only safe characters', () => {
        expect(
            backupFileName('install.cli-link-stale:/usr/local/bin/bismuth', new Date('2026-01-02T03:04:05Z')),
        ).toBe('install.cli-link-stale__usr_local_bin_bismuth-20260102T030405Z.tar.gz')
    })
})

describe('activityVaults', () => {
    test('the run vault alone, else every registered vault', () => {
        expect(activityVaults('/v/a', () => ['/v/b'])).toEqual(['/v/a'])
        expect(activityVaults(undefined, () => ['/v/b', '/v/c'])).toEqual(['/v/b', '/v/c'])
    })
})
