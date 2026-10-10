// `bismuth brain`: the session-start context an agent gets (profile, vault map, memory index),
// composed in this process with no long-lived core. The CLI twin of the MCP `brain` tool.
import type { CommandMap } from '../types'
import { requireVault, out } from '../args'
import { composeBrain } from '../../../core/src/brain'
import { cliGateChannel } from '../../../core/src/visibilityCliGate'
import { memoryDirFor } from '../../../mcp/src/memory'

// A cold map build must finish here (no cache to fall back on), so the wait is effectively unbounded.
const CLI_WAIT_MS = 600_000

export const commands: CommandMap = {
    brain: {
        summary: 'Print the brain: who you work with, the vault map and the memory index',
        usage: '[--vault <dir>]',
        run: async args => {
            const vault = requireVault(args)
            // The strictest of both env signals (an MCP-spawned CLI counts). The owner gets the chat view.
            const channel = cliGateChannel() === 'daemon' ? 'daemon' : 'chat'
            out(
                await composeBrain({
                    vaultDir: vault,
                    memoryDir: memoryDirFor(vault),
                    channel,
                    waitMs: CLI_WAIT_MS,
                }),
                args,
            )
        },
    },
}
