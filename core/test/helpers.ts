export { tempDir } from './tempDirs'
import { tempDir } from './tempDirs'
import { writeFileSync, mkdirSync, rmSync, watch } from 'node:fs'
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
 * Resolve once every change made in `dir` so far has gone through the FSEvents log, so a watcher
 * started afterwards is never handed one of them as new. macOS FSEvents can deliver a write's
 * notification well after the write resolved, more so under the load a full `bun test core` puts
 * on the box, and a brand-new watcher is handed the very recent writes as if they were its own. A
 * quiet spell cannot tell "quiet" from "not live yet", and a fresh watch takes seconds to go live
 * under load, so this rewrites a hidden marker until a watch on `dir` reports it (FSEvents reports
 * in order, so every earlier write is logged by then) and removes it. A server's watcher drops
 * dot-files, so it never takes that removal for a change. Shared by server.bootConfig.test.ts,
 * server.bootViews.test.ts and server.selfWrite.test.ts.
 */
export async function waitForFsQuiet(dir: string): Promise<void> {
    const name = `.fs-drain-${process.pid}`
    const marker = join(dir, name)
    const deadline = Date.now() + 15_000
    let seen = false
    const w = watch(dir, { recursive: true }, (_event, filename) => {
        if (filename != null && String(filename) === name) seen = true
    })
    try {
        while (!seen) {
            if (Date.now() > deadline)
                throw new Error(`the watch on ${dir} never reported ${name}`)
            writeFileSync(marker, String(Date.now()))
            await new Promise(r => setTimeout(r, 100))
        }
    } finally {
        w.close()
        rmSync(marker, { force: true })
    }
}
