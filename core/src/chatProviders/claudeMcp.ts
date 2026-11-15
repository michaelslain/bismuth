// core/src/chatProviders/claudeMcp.ts
// Bismuth's own MCP server as a stdio spec, for the lean claude profile (claudeBudget.ts). The same
// spec acp/driver.ts's buildMcpServers builds, written out here because chat.ts cannot import that
// file: it is in the app's type graph (the app imports ChatFrame from chat.ts) and the app's
// TypeScript 5.6 rejects driver.ts's `for await` over a ReadableStream. A test pins the two equal.
import { existsSync } from 'node:fs'
import { bismuthHome } from '../bismuthHome'
import type { AcpMcpServerStdio } from './acp/protocol'

export function claudeMcpServers(
    vaultRoot: string,
    memoryDir?: string,
    bin: string | null = (() => {
        const p = bismuthHome('bin', 'bismuth-mcp')
        return existsSync(p) ? p : null
    })(),
): AcpMcpServerStdio[] {
    if (!bin) return []
    const env: { name: string; value: string }[] = [
        { name: 'BISMUTH_VAULT', value: vaultRoot },
        { name: 'BISMUTH_MCP_CHANNEL', value: 'chat' },
        { name: 'BISMUTH_AGENT_CHANNEL', value: 'chat' },
        { name: 'BISMUTH_CLI', value: bismuthHome('bin', 'bismuth') },
        { name: 'BISMUTH_DOCS_DIR', value: bismuthHome('docs') },
    ]
    if (memoryDir) env.push({ name: 'BISMUTH_MEMORY_DIR', value: memoryDir })
    return [{ name: 'bismuth', command: bin, args: [], env }]
}
