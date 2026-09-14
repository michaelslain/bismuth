export { tempDir } from './tempDirs'
import { tempDir } from './tempDirs'
import { writeFileSync, mkdirSync, watch } from 'node:fs'
import { join } from 'node:path'
import { writeNote } from '../src/files'

/**
 * Build a throwaway vault from a `{ relativePath: content }` map in a fresh
 * tmpdir (parent dirs created as needed). Returns the vault root. Shared by the
 * search/replace tests so the fixture lives in one place.
 */
export function makeVault(
    files: Record<string, string>,
    prefix = 'bismuth-vault-',
): string {
    const dir = tempDir(prefix)
    for (const [rel, content] of Object.entries(files)) {
        const abs = join(dir, rel)
        mkdirSync(join(abs, '..'), { recursive: true })
        writeFileSync(abs, content)
    }
    return dir
}

/**
 * Build a throwaway sample vault + memory in tmpdirs, mirroring the notes the
 * server/cli tests assert against. Each call is isolated, so tests that mutate
 * the vault (writes, backups) can't bleed into one another.
 */
export async function makeSampleVault(): Promise<{
    vault: string
    memory: string
}> {
    const vault = tempDir('bismuth-vault-')
    const memory = tempDir('bismuth-memory-')

    await writeNote(
        vault,
        'essay.md',
        '# Essay\n\nReligion and historical materialism.\n',
    )
    await writeNote(
        vault,
        'housing.md',
        '---\nstatus: in-progress\npriority: 1\ntags: [logistics]\n---\n# Housing\n\nSigned the lease.\n',
    )
    await writeNote(
        vault,
        'internship.md',
        '# Internship\n\nApplying. Depends on [[housing]].\n',
    )

    await writeNote(
        memory,
        'michael-profile.md',
        'Profile of the user. He is working on [[internship]] and [[essay]].\n',
    )

    return { vault, memory }
}

/**
 * Resolve once `dir` has produced no fs events for `quietMs`, or after `maxMs` regardless. macOS
 * FSEvents can deliver a write's notification well after the write's own promise resolved — worse, and
 * more variably, under the CPU/IO load a full `bun test core` run puts on the box — and can replay a
 * directory's very recent write history to a BRAND-NEW watcher. A fixed sleep before attaching a
 * server's own watcher is a coin flip against that lag; actively watching for the storm to end waits
 * exactly as long as the filesystem needs to. Shared by server.bootConfig.test.ts and
 * server.selfWrite.test.ts.
 */
export function waitForFsQuiet(
    dir: string,
    quietMs = 200,
    maxMs = 3000,
): Promise<void> {
    return new Promise(resolve => {
        let settled = false
        let timer: ReturnType<typeof setTimeout>
        const finish = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            clearTimeout(hardCap)
            try {
                w.close()
            } catch {}
            resolve()
        }
        const w = watch(dir, { recursive: true }, () => {
            clearTimeout(timer)
            timer = setTimeout(finish, quietMs)
        })
        timer = setTimeout(finish, quietMs)
        const hardCap = setTimeout(finish, maxMs)
    })
}
