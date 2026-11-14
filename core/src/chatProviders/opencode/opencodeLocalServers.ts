// core/src/chatProviders/opencode/opencodeLocalServers.ts
// The I/O half of the saved local servers (`chat.opencodeServers`): read them from a vault's
// `.settings` and probe each for its models and loaded windows. The pure half is ./opencodeConfig.ts.
import { probeLocalServer } from '../../agentBackends/contextWindowProbe'
import { readSettings } from '../../settings'
import {
    parseOpencodeServers,
    type OpencodeInjectedServer,
    type OpencodeSavedServerSetting,
} from './opencodeConfig'

/** The vault's saved servers; `[]` when none, absent, malformed or unreadable. */
export async function readOpencodeServers(
    vault: string,
): Promise<OpencodeSavedServerSetting[]> {
    try {
        const res = await readSettings(vault)
        const chat = res?.data.chat as { opencodeServers?: unknown } | undefined
        return parseOpencodeServers(chat?.opencodeServers)
    } catch {
        return []
    }
}

/** Each saved server probed, embedding models dropped; a server that answers nothing is left out. */
export async function resolveOpencodeServers(
    vault: string,
): Promise<OpencodeInjectedServer[]> {
    const saved = await readOpencodeServers(vault)
    const probed = await Promise.all(
        saved.map(async s => {
            const p = await probeLocalServer(s.url, s.apiKey)
            return p
                ? ({
                      ...s,
                      models: p.models
                          .filter(m => !m.embedding)
                          .map(m => ({ id: m.id, window: m.window })),
                  } satisfies OpencodeInjectedServer)
                : null
        }),
    )
    return probed.filter((s): s is OpencodeInjectedServer => s !== null)
}
