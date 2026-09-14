// bench/verifyReport.ts — the PURE half of bench/verify.ts: arg parsing, shot comparison, the
// pass/fail verdict, and the exact summary text. No I/O, no `Bun.*`, no `node:fs` — everything here
// takes plain data in and returns plain data out, which is what makes it unit-testable without a
// Storybook, a Chrome, or a filesystem in the loop. `bench/verify.ts` is the other half: it spawns
// the three tools, reads their JSON, hashes shot files, and calls into this module to decide the
// verdict and render what gets printed. Splitting it this way is the same seam `bench/poolSize.ts`
// and `bench/storyReady.ts` already draw between "pure decision" and "the I/O that feeds it" — it is
// what let this file's tests run in milliseconds with zero Chrome involved, TDD'd before verify.ts
// existed at all.
export type VerifyArgs = {
    port: number
    prefixes: string[]
    baseline?: string
    out?: string
    app?: string
    keep: boolean
    bootTimeout: number
}

const USAGE =
    'usage: bun bench/verify.ts --port <n> --prefix <story-id-prefix> [--prefix <p> ...] ' +
    '[--baseline <dir>] [--out <dir>] [--app <dir>] [--keep] [--boot-timeout <ms>]'

/** Parses argv into VerifyArgs, or an { error } describing what is missing. `--port` has
 *  deliberately NO default — 6006 is the trap every sibling tool in this directory has, where a
 *  forgotten flag silently measures whatever Storybook happens to be listening on 6006, which in a
 *  worktree is the MAIN CHECKOUT's server, not this one's. Making it required (rather than
 *  defaulting and warning) is the only way to guarantee that trap can't fire from this tool. */
export function parseArgs(argv: string[]): VerifyArgs | { error: string } {
    let port: number | undefined
    const prefixes: string[] = []
    let baseline: string | undefined
    let out: string | undefined
    let app: string | undefined
    let keep = false
    let bootTimeout = 120000

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        switch (a) {
            case '--port':
                port = Number(argv[++i])
                break
            case '--prefix':
                if (argv[i + 1] !== undefined) prefixes.push(argv[++i]!)
                break
            case '--baseline':
                baseline = argv[++i]
                break
            case '--out':
                out = argv[++i]
                break
            case '--app':
                app = argv[++i]
                break
            case '--keep':
                keep = true
                break
            case '--boot-timeout':
                bootTimeout = Number(argv[++i])
                break
        }
    }

    if (port === undefined || !Number.isFinite(port))
        return { error: `--port is required (no default)\n${USAGE}` }
    if (prefixes.length === 0)
        return { error: `at least one --prefix is required\n${USAGE}` }
    if (!Number.isFinite(bootTimeout))
        return { error: `--boot-timeout must be a number\n${USAGE}` }

    return { port, prefixes, baseline, out, app, keep, bootTimeout }
}

/** Set-diffs two shot-name→md5 maps. `missing` is every baseline name absent from `current` — the
 *  caller is responsible for having already restricted `baseline` to names whose story matches one
 *  of the run's prefixes, since this module has no notion of prefix matching (that lives in the
 *  sibling tools' own `id === p || id.startsWith(p)` semantics). */
export function compareShots(
    current: Record<string, string>,
    baseline: Record<string, string>,
): { changed: string[]; unchanged: string[]; added: string[]; missing: string[] } {
    const changed: string[] = []
    const unchanged: string[] = []
    const added: string[] = []
    const missing: string[] = []

    for (const [name, hash] of Object.entries(current)) {
        if (!(name in baseline)) added.push(name)
        else if (baseline[name] !== hash) changed.push(name)
        else unchanged.push(name)
    }
    for (const name of Object.keys(baseline)) {
        if (!(name in current)) missing.push(name)
    }

    changed.sort()
    unchanged.sort()
    added.sort()
    missing.sort()
    return { changed, unchanged, added, missing }
}

/** storyAudit.ts flag kinds that mean nothing rendered — everything else is a lead: worth looking
 *  at, never a reason to fail this tool. Kept as the single source of truth so verify.ts's split
 *  into hard/leads and this module's verdict rule can never drift apart. */
export const HARD_AUDIT_FLAGS = new Set(['empty-render', 'crashed', 'probe-failed'])

export type PrefixResult = {
    prefix: string
    play:
        | { pass: number; fail: number; skip: number; error: number; unsafe: number; failed: string[] }
        | { toolError: string }
    invariants:
        | { exit: number; findings: number; blank: number; failed: string[] }
        | { toolError: string }
    audit:
        | { stories: number; hard: { id: string; kind: string; detail: string }[]; leads: { id: string; kind: string; detail: string }[] }
        | { toolError: string }
}

export type VerifyInput = {
    base: string
    storybook: 'started' | 'reused' | 'failed-to-boot'
    stopped: boolean
    out: string
    prefixes: PrefixResult[]
    shots?: ReturnType<typeof compareShots> & { baseline: string }
}

const storybookPhrase = (storybook: VerifyInput['storybook'], stopped: boolean): string => {
    if (storybook === 'failed-to-boot') return 'storybook failed to boot'
    const who = storybook === 'reused' ? 'storybook reused' : 'storybook started by verify'
    return `${who}, ${stopped ? 'stopped' : 'left running'}`
}

/** Renders the exact summary block and decides ok/fail. Widths (46 for the play column, 33 for the
 *  invariants column, prefix names padded to the longest + 2) reproduce the plan's worked example
 *  byte-for-byte — see the last test in verifyReport.test.ts. */
export function summarize(input: VerifyInput): { text: string; ok: boolean } {
    let ok = input.storybook !== 'failed-to-boot'

    const nameWidth = Math.max(0, ...input.prefixes.map(p => p.prefix.length)) + 2
    const rowLines: string[] = []
    const leadLines: string[] = []
    const failureLines: string[] = []

    for (const pr of input.prefixes) {
        let playText: string
        if ('toolError' in pr.play) {
            ok = false
            playText = `play toolError: ${pr.play.toolError}`
            failureLines.push(`  ${pr.prefix}  play  toolError: ${pr.play.toolError}`)
        } else {
            const p = pr.play
            const nothingAsserted = p.pass === 0 && p.skip > 0
            playText =
                `play PASS=${p.pass} SKIP=${p.skip} FAIL=${p.fail} ERROR=${p.error} UNSAFE=${p.unsafe}` +
                (nothingAsserted ? ' (nothing asserted)' : '')
            if (p.fail + p.error + p.unsafe > 0) ok = false
            for (const id of p.failed) failureLines.push(`  ${id}  play`)
        }

        let invText: string
        if ('toolError' in pr.invariants) {
            ok = false
            invText = `invariants toolError: ${pr.invariants.toolError}`
            failureLines.push(`  ${pr.prefix}  invariants  toolError: ${pr.invariants.toolError}`)
        } else {
            const iv = pr.invariants
            invText = `invariants ${iv.findings} findings, ${iv.blank} blank`
            if (iv.exit !== 0) ok = false
            for (const id of iv.failed) failureLines.push(`  ${id}  invariants`)
        }

        let auditText: string
        if ('toolError' in pr.audit) {
            ok = false
            auditText = `audit toolError: ${pr.audit.toolError}`
            failureLines.push(`  ${pr.prefix}  audit  toolError: ${pr.audit.toolError}`)
        } else {
            const a = pr.audit
            auditText = `audit ${a.stories} stories, ${a.hard.length} hard, ${a.leads.length} leads`
            if (a.hard.length) ok = false
            for (const h of a.hard) failureLines.push(`  ${h.id}  audit  ${h.kind} ${h.detail}`)
            for (const l of a.leads) leadLines.push(`  ${l.id}  ${l.kind}  ${l.detail}`)
        }

        // padEnd only ADDS space when the text is shorter than the target width — a toolError
        // message routinely runs past it, and with no floor a `padEnd` that pads nothing runs the
        // next column's text straight into it with zero separation. `pad` guarantees at least a
        // two-space gap in that case, while leaving the normal (in-budget) case byte-identical to a
        // plain `padEnd` — see the two "the exact ... shape" tests in verifyReport.test.ts.
        const pad = (s: string, width: number) => (s.length >= width ? s + '  ' : s.padEnd(width))
        rowLines.push(`${pad(pr.prefix, nameWidth)}${pad(playText, 46)}${pad(invText, 33)}${auditText}`)
    }

    const lines: string[] = [
        `== verify: ${input.prefixes.length} prefix(es) @ ${input.base} — ${storybookPhrase(input.storybook, input.stopped)} ==`,
        ...rowLines,
    ]

    if (input.shots) {
        const s = input.shots
        lines.push(
            `shots: ${s.changed.length} changed, ${s.unchanged.length} unchanged, ${s.added.length} added, ${s.missing.length} missing   (baseline: ${s.baseline})`,
        )
        for (const name of s.changed) lines.push(`  ${name}`)
    }

    lines.push('leads:')
    lines.push(...(leadLines.length ? leadLines : ['  (none)']))
    lines.push('failures:')
    lines.push(...(failureLines.length ? failureLines : ['  (none)']))
    lines.push(`RESULT: ${ok ? 'PASS' : 'FAIL'}   out: ${input.out}   logs: ${input.out}/logs`)

    return { text: lines.join('\n'), ok }
}
