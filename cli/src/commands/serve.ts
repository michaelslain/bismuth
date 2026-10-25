import type { CommandMap } from '../types'
import { flag, requireVault, memoryDir, out } from '../args'
import { commitVault, snapshotMessage } from '../../../core/src/backup'

export const commands: CommandMap = {
    serve: {
        summary: 'Run the core HTTP server (graph + vault API + SSE).',
        usage: '[--port N]',
        async run(args) {
            const portArg = flag(args, 'port')
            // Loaded on use: the server adds ~0.05s to every CLI start.
            const { createServer } = await import('../../../core/src/server')
            const s = createServer({
                vault: requireVault(args),
                memory: memoryDir(args),
                port: portArg ? Number(portArg) : 4321,
            })
            out(`core listening on http://localhost:${s.port}`, args)
            // The Bun.serve instance keeps the process alive on its own; don't block.
        },
    },

    backup: {
        summary: 'Commit a git snapshot of the vault (local only).',
        async run(args) {
            const vault = requireVault(args)
            const committed = await commitVault(vault, snapshotMessage())
            out(committed ? 'committed' : 'nothing to commit', args)
        },
    },
}
