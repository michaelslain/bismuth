// Backends command group for the `bismuth` CLI.
//
// `bismuth backends` answers "which agent CLIs work on this machine, and what will Bismuth do with
// each?" The catalog (core/src/agentBackends/catalog.ts) declares what each CLI *can* do; this
// reports what is actually installed here, which is a different question and the one you want when
// a chat tab shows a setup screen.
//
// Read-only and cheap: it resolves binaries and asks for version strings. It never runs an agent
// turn, authenticates, spends money, starts a daemon, or writes config. Registering Bismuth's MCP
// server with a CLI is deliberately NOT here — that writes to files the user owns, so it stays an
// explicit `bismuth install --mcp <cli>`.
import type { CommandMap } from '../types'
import { bool, out } from '../args'
import {
    checkBackends,
    type BackendReport,
} from '../../../core/src/agentBackends/doctor'
import {
    installFreeAgent,
    type FreeAgentProgress,
} from '../../../core/src/freeAgent'

/** The hint shown under "Not installed:". opencode's is overridden HERE, in formatting only —
 *  `catalog.ts`'s `installHint` is also what the chat error frame shows, and must stay untouched. */
export function formatBackendHint(id: string, hint: string): string {
    return id === 'opencode'
        ? 'run `bismuth backends setup-free` for a free agent (no account), or install from opencode.ai'
        : hint
}

/** One human-readable line per backend. `--json` (via `out`) is the machine path; this is the
 *  default because the common use is a person checking why a provider won't start. */
function formatTable(reports: BackendReport[]): string {
    const rows = reports.map(r => {
        // An adapter is fetched by npx on first use, so it has no installed version to show and must not
        // get a bare ✓ — the runner being present says nothing about whether the bridge will run.
        const state = r.adapterPackage
            ? `adapter → ${r.adapterPackage}`
            : r.installed
              ? r.problem
                  ? `! ${r.problem}`
                  : (r.version ?? 'installed')
              : 'not installed'
        const surfaces = [
            r.surfaces.chat ? 'chat' : null,
            r.surfaces.terminal ? 'terminal' : null,
            r.surfaces.relayReporting !== 'none'
                ? `relay:${r.surfaces.relayReporting}`
                : null,
            r.surfaces.daemon ? 'daemon' : null,
            r.surfaces.mcp !== 'none' ? `mcp:${r.surfaces.mcp}` : null,
            `memory:${r.surfaces.memory}`,
            r.surfaces.localModel ? 'local' : null,
        ]
            .filter(Boolean)
            .join(' ')
        const mark = r.adapterPackage
            ? '~'
            : r.installed && !r.problem
              ? '✓'
              : r.installed
                ? '!'
                : '·'
        return { mark, id: r.id, state, surfaces, hint: r.installHint }
    })
    const idW = Math.max(...rows.map(r => r.id.length), 7)
    const stateW = Math.max(...rows.map(r => r.state.length), 5)
    const lines = rows.map(
        r =>
            `${r.mark} ${r.id.padEnd(idW)}  ${r.state.padEnd(stateW)}  ${r.surfaces}`,
    )
    const missing = rows.filter(r => r.hint)
    if (missing.length) {
        lines.push('')
        lines.push('Not installed:')
        for (const m of missing)
            lines.push(`  ${m.id}: ${formatBackendHint(m.id, m.hint!)}`)
    }
    return lines.join('\n')
}

type Install = typeof installFreeAgent

/** `bismuth backends setup-free [--json]`. The installer is injectable so tests never download.
 *  Exit code 1 (via `process.exitCode`, so output flushes) when the install ends in `phase:'error'`. */
export async function runSetupFree(
    args: string[],
    install: Install = installFreeAgent,
): Promise<void> {
    const json = bool(args, 'json')
    let lastPhase = ''
    let lastMb = -1
    const onProgress = (p: FreeAgentProgress) => {
        if (json) return
        if (p.phase === 'downloading') {
            const mb = Math.floor((p.received ?? 0) / 1048576)
            if (lastPhase === 'downloading' && mb === lastMb) return
            lastMb = mb
            lastPhase = p.phase
            const total = p.total ? ` / ${Math.round(p.total / 1048576)}` : ''
            console.log(`downloading opencode ${mb}${total} MB`)
            return
        }
        if (p.phase === lastPhase) return
        lastPhase = p.phase
        if (p.phase === 'verifying') console.log('checking the download…')
        else if (p.phase === 'installing') console.log('installing…')
    }
    const final = await install(undefined, onProgress)
    if (final.phase === 'error') process.exitCode = 1
    if (json) {
        out(final, args)
        return
    }
    if (final.phase === 'error') {
        console.error(`error: ${final.message ?? 'could not set up the free agent'}`)
    } else if (final.action === 'already-installed') {
        console.log(`ready: opencode already installed at ${final.path ?? 'PATH'}`)
    } else {
        console.log(`ready: opencode ${final.version ?? ''} (installed)`.replace('  ', ' '))
    }
}

export const commands: CommandMap = {
    'backends setup-free': {
        summary:
            'Download opencode into ~/.bismuth/agents/bin so chat can run on free models (no account)',
        usage: '[--json]',
        run: async args => runSetupFree(args),
    },
    backends: {
        summary:
            'List agent backends: which CLIs are installed here, and which surfaces each supports',
        usage: '[--json] [--installed]',
        run: async args => {
            const all = await checkBackends()
            const reports = bool(args, 'installed')
                ? all.filter(r => r.installed)
                : all
            // `--json` is handled by out(); the readable table is the default for a human debugging a
            // provider that won't start.
            if (bool(args, 'json')) {
                out(reports, args)
                return
            }
            console.log(formatTable(reports))
        },
    },
}
