// core/test/support/fakeConfigAcp.ts
// A tiny ACP agent for the config-call tests: it appends every request (method + params) to the file
// named by FAKE_CONFIG_ACP_LOG, advertises goose-style modes and a model + effort config, and takes
// 150 ms to switch a model, as goose does while it rebuilds its provider.
import { appendFileSync } from 'node:fs'

const log = process.env.FAKE_CONFIG_ACP_LOG as string
const options = () => [
    {
        id: 'model',
        category: 'model',
        type: 'select',
        currentValue: 'm1',
        options: [
            { value: 'm1', name: 'm1' },
            { value: 'm2', name: 'm2' },
        ],
    },
    {
        id: 'thinking_effort',
        category: 'thought_level',
        type: 'select',
        currentValue: 'high',
        options: [
            { value: 'low', name: 'low' },
            { value: 'high', name: 'high' },
            { value: 'max', name: 'max' },
        ],
    },
]
const modes = {
    currentModeId: 'auto',
    availableModes: ['auto', 'approve', 'smart_approve', 'chat'].map(id => ({
        id,
        name: id,
    })),
}
const send = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n')

let buf = ''
process.stdin.on('data', async chunk => {
    buf += chunk.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.trim()) continue
        const req = JSON.parse(line)
        appendFileSync(log, JSON.stringify({ method: req.method, params: req.params }) + '\n')
        const reply = (result: unknown) => send({ jsonrpc: '2.0', id: req.id, result })
        switch (req.method) {
            case 'initialize':
                reply({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] })
                break
            case 'session/new':
                reply({ sessionId: 's-new', modes, configOptions: options() })
                break
            case 'session/load':
                await Bun.sleep(400)
                reply({ modes, configOptions: options() })
                break
            case 'session/set_config_option':
                if (req.params.configId === 'model') await Bun.sleep(150)
                reply({ configOptions: options() })
                break
            case 'session/prompt':
                if (process.env.FAKE_CONFIG_ACP_RETRY)
                    for (const n of [1, 2])
                        send({
                            jsonrpc: '2.0',
                            method: 'session/update',
                            params: {
                                sessionId: 's-new',
                                update: {
                                    sessionUpdate: 'session_info_update',
                                    _meta: {
                                        codex: {
                                            error: {
                                                message: `Reconnecting... ${n}/2`,
                                                additionalDetails: 'the model server is down',
                                                willRetry: true,
                                            },
                                        },
                                    },
                                },
                            },
                        })
                reply({ stopReason: 'end_turn' })
                break
            default:
                reply({})
        }
    }
})
