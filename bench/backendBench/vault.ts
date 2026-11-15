// bench/backendBench/vault.ts
// The vault every scenario runs in: a small, fixed seed written to a fresh temp directory, so a
// turn that edits notes never leaks into the next scenario. `chat.provider` names the target's
// backend, so the production router and the drivers' own `.settings` reads see what a person's
// vault would say.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { BenchTarget } from './types'

/** A string only `notes/sentinel.md` holds: seeing it in a reply or tool result proves the turn
 *  read that note. */
export const SENTINEL = 'bismuth-sentinel-7Q4Z'

/** The seeded daemon's name, in `.daemon/identity.md`; instructions checks look for it. */
export const DAEMON_NAME = 'quill'

/** Vault-relative path to content. */
export const VAULT_SEED: Record<string, string> = {
    'notes/sentinel.md': `---\ntags: [bench]\n---\n\n# Sentinel\n\nThe sentinel value is ${SENTINEL}.\n`,
    'notes/tasks.md':
        '# Tasks\n\n- [ ] write the parity report [due 2026-12-01] [high]\n- [x] seed the bench vault\n',
    'notes/kitchen.md':
        '# Kitchen\n\nSee [[sentinel]] for a value to look up.\n',
    'bases/reading.base.jsonl': [
        JSON.stringify({ view: 'table', title: 'Reading' }),
        JSON.stringify({ title: 'Dune', status: 'done' }),
        JSON.stringify({ title: 'Solaris', status: 'reading' }),
    ].join('\n') + '\n',
    '.daemon/identity.md': `---\nname: ${DAEMON_NAME}\n---\n\nA bench daemon.\n`,
    '.claude/skills/bench-skill/SKILL.md':
        '---\nname: bench-skill\ndescription: Use when the bench asks for the bench skill.\n---\n\n# bench-skill\n\nSay the word pelican.\n',
}

/** Where a vault goes. macOS's per-user temp dir resolves to `/private/var/...`, a path hermes treats
 *  as a system location and refuses to write under, so a vault there makes its write tool fail no
 *  matter what the user answers. `/tmp` resolves to `/private/tmp`, which it does not. */
export function vaultParent(): string {
    const dir = tmpdir()
    try {
        if (realpathSync(dir).startsWith('/private/var/')) return realpathSync('/tmp')
    } catch {
        /* no /tmp: keep the default */
    }
    return dir
}

/** A fresh vault for `target`: the seed plus a `.settings` naming its backend (and `localModel`
 *  when given). Returns its absolute path; the caller removes it. */
export function seedVault(
    target: BenchTarget,
    opts?: { localModel?: { url: string; model: string } },
): string {
    const root = mkdtempSync(join(vaultParent(), 'bismuth-bench-vault-'))
    for (const [rel, content] of Object.entries(VAULT_SEED)) {
        const abs = join(root, rel)
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, content)
    }
    const lines = ['chat:', `  provider: ${target.backend}`]
    if (opts?.localModel) {
        lines.push(
            'localModel:',
            '  enabled: true',
            `  url: ${opts.localModel.url}`,
            `  model: '${opts.localModel.model}'`,
        )
    }
    writeFileSync(join(root, '.settings'), lines.join('\n') + '\n')
    return root
}
