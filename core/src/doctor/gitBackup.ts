// The doctor's backup store: a local git repo (`~/.bismuth/doctor-backups`) that holds what each
// destructive repair deletes or rewrites, committed BEFORE the repair runs.
//
// Each backup is one tar.gz of the touched paths (archived relative to `/`, so symlinks, nested
// `.git` dirs and modes survive, which a plain `git add` of a nested repo would not), committed,
// then removed from the work tree in a second commit: the object store keeps one copy and the
// directory stays empty. Restore: `git -C <repo> show <commit>:<file> | tar -xzf - -C /`.
//
// Every git call strips the env vars that redirect which repo git targets (backup.ts explains the
// incident behind them): a git hook's GIT_DIR would otherwise aim these commits at another repo.
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { GIT_LOCATION_VARS } from '../backup'
import type { Exec } from '../serviceUnit'
import type { RepairBackup } from './types'

export const BACKUP_REPO_DIR = 'doctor-backups'
const TAR_TIMEOUT_MS = 300_000

function present(path: string): boolean {
    try {
        return lstatSync(path, { throwIfNoEntry: false }) != null
    } catch {
        return false
    }
}

/** The path with its parent resolved (the last segment kept as is, so a symlink is archived as a
 *  link): tar refuses to extract through a symlinked ancestor such as macOS's `/var`. */
function physical(path: string): string {
    try {
        return join(realpathSync(dirname(path)), basename(path))
    } catch {
        return path
    }
}

/** `legacy.claude-bot-home` at a time → `legacy.claude-bot-home-20261013T184405Z.tar.gz`; any
 *  character a file name should not carry (`:`, `/` in qualified ids) becomes `_`. */
export function backupFileName(id: string, now: Date): string {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
    return `${id.replace(/[^A-Za-z0-9._-]/g, '_')}-${stamp}.tar.gz`
}

/** The shell line that puts a backup back where it came from. */
export function restoreCommand(b: RepairBackup): string {
    return `git -C ${b.repo} show ${b.commit}:${b.file} | tar -xzf - -C /`
}

export async function gitBackup(
    deps: { exec: Exec; bismuthHome: string; now?: () => Date },
    id: string,
    description: string,
    paths: string[],
): Promise<RepairBackup | null> {
    const existing = paths.filter(present)
    if (existing.length === 0) return null
    const repo = join(deps.bismuthHome, BACKUP_REPO_DIR)
    const unset = GIT_LOCATION_VARS.flatMap(v => ['-u', v])
    const git = (args: string[]) =>
        deps.exec(['env', ...unset, 'git', '-C', repo, ...args], 60_000)
    const must = async (args: string[]) => {
        const r = await git(args)
        if (r.code !== 0)
            throw new Error(
                `git ${args[0]} failed: ${(r.stderr || r.stdout).trim()}`,
            )
        return r.stdout.trim()
    }

    mkdirSync(repo, { recursive: true })
    if (!existsSync(join(repo, '.git'))) {
        await must(['init', '-q'])
        await must(['config', 'user.name', 'bismuth doctor'])
        await must(['config', 'user.email', 'doctor@bismuth.local'])
    }

    const file = backupFileName(id, (deps.now ?? (() => new Date()))())
    const tar = await deps.exec(
        [
            'tar',
            '-czf',
            join(repo, file),
            '-C',
            '/',
            ...existing.map(p => physical(p).replace(/^\/+/, '')),
        ],
        TAR_TIMEOUT_MS,
    )
    if (tar.code !== 0)
        throw new Error(`tar failed: ${(tar.stderr || tar.stdout).trim()}`)

    await must(['add', '--', file])
    await must(['commit', '-q', '-m', `${id} // ${description}`])
    const commit = await must(['rev-parse', 'HEAD'])
    await must(['rm', '-q', '--', file])
    await must(['commit', '-q', '-m', `${id} // drop ${file} from the work tree`])
    return { repo, commit, file }
}
