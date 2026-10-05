// Doctor command for the `bismuth` CLI — the ONE entry point for "is this machine (and this vault)
// in the state the current build expects?". All logic lives in core/src/doctor/; the MCP's
// bismuth_doctor tool bridges this exact command, so the two never drift.
//
// AGENT MODE. The visibility gate classes `doctor` always-safe (it never prints a note body), which
// leaves two things for the command itself to hold: an agent must not be able to apply DESTRUCTIVE
// repairs (deleting directories, unloading services) without the owner, and in a vault that hides
// anything the `vault` section is dropped, because its finding ids carry note paths.
import type { CommandMap } from '../types'
import { bool, flag, out } from '../args'
import { runDoctor } from '../../../core/src/doctor/run'
import { defaultContext } from '../../../core/src/doctor/context'
import { formatDoctorReport } from '../../../core/src/doctor/format'
import { DEFAULT_SECTIONS } from '../../../core/src/doctor/sections'
import type { DoctorOptions } from '../../../core/src/doctor/types'
import { buildDenyPaths } from '../../../core/src/visibility'
import { cliGateChannel, cliIsAgentHand } from '../../../core/src/visibilityCliGate'

const list = (s: string | undefined) =>
    s
        ? s
              .split(',')
              .map(x => x.trim())
              .filter(Boolean)
        : undefined

/** Pure: narrow `opts` for an agent caller. An owner's options pass through untouched. */
export function doctorAgentOptions(
    opts: DoctorOptions,
    agent: boolean,
    vaultRestricted: boolean,
): DoctorOptions {
    if (!agent) return opts
    const next: DoctorOptions = { ...opts, risks: ['safe'] }
    if (vaultRestricted)
        next.sections = (opts.sections ?? DEFAULT_SECTIONS.map(s => s.id)).filter(
            id => id !== 'vault',
        )
    return next
}

/** Agent = Bismuth stamped this process as an agent's hand, or the MCP server spawned it. */
const isAgent = () => cliIsAgentHand()

/** True when the vault hides anything from this agent's channel. A vault whose settings cannot be
 *  read counts as restricted: fail safe, same as the gate. */
async function vaultRestricted(vault: string | undefined): Promise<boolean> {
    if (!vault) return false
    try {
        return (
            (await buildDenyPaths(vault, cliGateChannel() ?? 'daemon')).length >
            0
        )
    } catch {
        return true
    }
}

export const commands: CommandMap = {
    doctor: {
        summary:
            'Find leftovers from older builds, version skew and pending vault migrations; --fix repairs them',
        usage: '[--fix] [--safe-only] [--only <id>[,<id>…]] [--section <id>[,<id>…]] [--vault <path>] [--json]',
        run: async args => {
            const vault = flag(args, 'vault') ?? process.env.BISMUTH_VAULT
            const agent = isAgent()
            const opts = doctorAgentOptions(
                {
                    fix: bool(args, 'fix'),
                    risks: bool(args, 'safe-only') ? ['safe'] : undefined,
                    only: list(flag(args, 'only')),
                    sections: list(flag(args, 'section')),
                },
                agent,
                agent && (await vaultRestricted(vault)),
            )
            const report = await runDoctor(defaultContext({ vault }), opts)
            if (args.includes('--json')) {
                out(report, args)
                return
            }
            console.log(formatDoctorReport(report))
            if (agent && report.pending.destructive > 0)
                console.log('agent mode // destructive repairs need the owner')
        },
    },
}
