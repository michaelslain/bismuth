import type { CommandMap } from '../types'
import { requireVault, memoryDir, out, fail } from '../args'
import { buildGraph } from '../../../core/src/engine'
import {
    agentChannel,
    agentDenyEntries,
    agentMemoryDirAllowed,
    filterGraph,
} from '../../../core/src/visibilityFilter'

export const commands: CommandMap = {
    graph: {
        summary:
            'Build the knowledge graph (vault + optional memory) and print it as JSON',
        usage: '[--vault <dir>] [--memory <dir>] [--pretty]',
        run: async args => {
            const vault = requireVault(args)
            const memory = memoryDir(args)
            // Fail closed: throws when visibility is undeterminable.
            const entries = await agentDenyEntries(vault)
            if (agentChannel() && memory && !agentMemoryDirAllowed(vault, memory))
                fail(
                    "refused: an agent's --memory must be exactly the vault's .daemon/memory",
                )
            const graph = await buildGraph(vault, memory)
            out(filterGraph(graph, entries), args)
        },
    },
}
