// core/test/support/fakeLastCellsAcp.ts
// A tiny scripted ACP agent for acpLastCells.test.ts. FAKE_LC is a JSON config: `modes` (ids offered),
// `options` (session/new's configOptions), `reply` (configOptions answered to a model switch, by
// model), `updates` (session/update payloads sent for a prompt), `stop` (its stopReason) and `hang` (a
// prompt that sends its updates and then never replies, like an agent retrying a failing model). Every
// request is appended to FAKE_LC_LOG as `{method, params}`.
import { appendFileSync } from 'node:fs'

const cfg = JSON.parse(process.env.FAKE_LC ?? '{}')
const log = process.env.FAKE_LC_LOG as string
const send = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n')
const modes = {
    currentModeId: cfg.modes?.[0] ?? 'default',
    availableModes: (cfg.modes ?? []).map((id: string) => ({ id, name: id })),
}

let buf = ''
let pendingPrompt: (() => void) | null = null
process.stdin.on('data', chunk => {
    buf += chunk.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.trim()) continue
        const req = JSON.parse(line)
        if (req.method === undefined && req.id === 900) {
            appendFileSync(
                log,
                JSON.stringify({
                    method: 'permission-answer',
                    params: { optionId: req.result?.outcome?.optionId ?? null },
                }) + '\n',
            )
            pendingPrompt?.()
            pendingPrompt = null
            continue
        }
        appendFileSync(log, JSON.stringify({ method: req.method, params: req.params }) + '\n')
        const reply = (result: unknown) => send({ jsonrpc: '2.0', id: req.id, result })
        switch (req.method) {
            case 'initialize':
                reply({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] })
                break
            case 'session/new':
                reply({ sessionId: 's-1', modes, ...(cfg.options && { configOptions: cfg.options }) })
                break
            case 'session/load':
                reply({ ...(!cfg.loadNoModes && { modes }), ...(cfg.options && { configOptions: cfg.options }) })
                break
            case 'session/set_config_option':
                reply({
                    configOptions:
                        (req.params.configId === 'model' && cfg.reply?.[req.params.value]) ||
                        cfg.options ||
                        [],
                })
                break
            case 'session/prompt':
                for (const update of cfg.updates ?? [])
                    send({
                        jsonrpc: '2.0',
                        method: 'session/update',
                        params: { sessionId: 's-1', update },
                    })
                if (cfg.permission) {
                    // An exec approval the way openclaw's bridge asks: park the turn until answered.
                    send({
                        jsonrpc: '2.0',
                        id: 900,
                        method: 'session/request_permission',
                        params: {
                            sessionId: 's-1',
                            toolCall: { toolCallId: 'x1', title: 'exec', kind: 'execute' },
                            options: [
                                { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
                                { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
                            ],
                        },
                    })
                    pendingPrompt = () => reply({ stopReason: cfg.stop ?? 'end_turn' })
                    break
                }
                if (cfg.hang) break
                reply({ stopReason: cfg.stop ?? 'end_turn' })
                break
            default:
                reply({})
        }
    }
})
