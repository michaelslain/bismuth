// What every chat backend owes the user, checked for each one in the catalog, so a backend that
// skips a piece fails here instead of in a chat:
//   - instructions: the text it actually sends carries the rendering note, the daemon's name and
//     the `bismuth` CLI note (chatInstructions.ts);
//   - MCP: a backend that speaks MCP wires Bismuth's `bismuth-mcp` into its sessions;
//   - history: the catalog's `sessionPicker` matches a history source that lists its chats;
//   - window: a backend that runs local models sizes its prompt to the loaded window.
// A new backend has no row in the tables below and fails until it is wired and given one.
import { bismuthHome } from '../../src/bismuthHome'
import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    BACKEND_LIST,
    type BackendId,
} from '../../src/agentBackends/catalog'
import { createCodexRegistrar } from '../../src/agentBackends/mcpRegistrars'
import { claudeMcpAddArgs } from '../../src/bismuthInstall'
import { localSpawnFor } from '../../src/agentBackends/localModel'
import { claudeChatSystemPrompt } from '../../src/chat'
import { AGENT_CLI_NOTE } from '../../src/agentCliNote'
import { CHAT_RENDERING_NOTE } from '../../src/chatRenderingNote'
import { ACP_AGENTS } from '../../src/chatProviders/acp/agents'
import {
    acpInstructionBlocks,
    buildMcpServers,
} from '../../src/chatProviders/acp/driver'
import { CHAT_HISTORY_SOURCES } from '../../src/chatProviders/chatHistorySources'
import { buildCodexExecArgs } from '../../src/chatProviders/codex/driver'
import {
    opencodeInstructionHead,
    opencodeMcp,
} from '../../src/chatProviders/opencode/opencode'
import { pickTier, OPENCODE_BASE_TOKENS } from '../../src/chatProviders/opencode/opencodeBudget'
import { buildOpencodeConfig } from '../../src/chatProviders/opencode/opencodeConfig'
import { tempDir } from '../tempDirs'

const chatBackends = BACKEND_LIST.filter(b => b.capabilities.chat)
const ACP_IDS = new Set<string>(ACP_AGENTS.map(a => a.id))

/** A vault whose daemon is named `m`. */
function daemonVault(): string {
    const vault = tempDir('bismuth-contract-')
    writeFileSync(join(vault, '.settings'), '')
    mkdirSync(join(vault, '.daemon'))
    writeFileSync(join(vault, '.daemon', 'identity.md'), '---\nname: m\n---\n\nbody\n')
    return vault
}

/** The standing instructions each backend sends its agent, read from its own wire builder. */
const INSTRUCTIONS: Record<string, (vault: string) => Promise<string> | string> = {
    claude: vault => claudeChatSystemPrompt(vault).append,
    opencode: vault => opencodeInstructionHead(vault).join('\n\n'),
    codex: vault => {
        const args = buildCodexExecArgs({
            jsonFlag: '--json',
            cwd: vault,
            threadId: null,
            imagePaths: [],
        })
        const raw = args.find(a => a.startsWith('developer_instructions='))
        return raw ? JSON.parse(raw.slice('developer_instructions='.length)) : ''
    },
}
const instructionsOf = (id: string) =>
    INSTRUCTIONS[id] ??
    (ACP_IDS.has(id)
        ? (vault: string) =>
              acpInstructionBlocks(vault, true)
                  .map(b => (b.type === 'text' ? b.text : ''))
                  .join('\n')
        : undefined)

const FAKE_MCP = '/opt/bismuth/bin/bismuth-mcp'

/** The Bismuth MCP command each MCP-speaking backend's sessions get, or null. */
const MCP: Record<string, (vault: string) => Promise<string | null> | string | null> = {
    // Claude chats load the user-scope `bismuth` server `bismuth install` registers.
    claude: () => (claudeMcpAddArgs().at(-1) ?? null),
    opencode: vault => {
        const cfg = buildOpencodeConfig({
            local: null,
            servers: [],
            limits: [],
            profile: 'default',
            mcp: opencodeMcp(vault, {
                command: [FAKE_MCP],
                environment: {},
            }),
        }) as { mcp?: { bismuth?: { command?: string[] } } } | null
        return cfg?.mcp?.bismuth?.command?.[0] ?? null
    },
    // Codex has no per-session MCP: `codex mcp add` registers it once, user-wide.
    codex: async () => {
        let added: string[] = []
        const registrar = createCodexRegistrar({
            which: bin => `/bin/${bin}`,
            run: async (_, args) => {
                added = args
                return { code: 0, stdout: '', stderr: '' }
            },
            readFile: () => null,
            writeFile: () => {},
            homedir: () => '/home',
            now: () => '',
        })
        await registrar.register({ mcpBin: FAKE_MCP, cliBin: '/opt/bismuth/bin/bismuth' })
        return added.includes(FAKE_MCP) ? FAKE_MCP : null
    },
}
const mcpOf = (id: string) =>
    MCP[id] ??
    (ACP_IDS.has(id)
        ? (vault: string) => {
              const agent = ACP_AGENTS.find(a => a.id === id)
              if (agent?.supportsSessionMcpServers === false) return null
              return buildMcpServers(vault, undefined, FAKE_MCP)[0]?.command ?? null
          }
        : undefined)

/**
 * How each local-model backend fits its prompt to the loaded window. A backend listed in
 * UNSIZED instead runs a local model with no sizing: the gap is named, and closing it means
 * moving the backend into WINDOW_SIZED.
 */
const WINDOW_SIZED: Record<string, () => void> = {
    // opencode picks a leaner prompt for a smaller window (opencodeBudget.ts).
    opencode: () => {
        const tier = (window: number) =>
            pickTier({ window, base: OPENCODE_BASE_TOKENS, always: 900, brain: 2_700, message: 5 })
        expect(tier(8_192)).toBe('lean')
        expect(tier(200_000)).toBe('full')
    },
    // Claude Code is told the loaded window, and auto-compacts within it.
    claude: () => {
        const spawn = localSpawnFor('claude', LM, 'qwen/qwen3.5-9b', ['qwen/qwen3.5-9b'], {
            'qwen/qwen3.5-9b': 8_192,
        })
        expect(spawn?.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('8192')
    },
}
const LM = { url: 'http://127.0.0.1:1234', apiKey: '', model: '' }
const UNSIZED: Record<string, string> = {
    codex: 'not installed here, so the window setting it reads cannot be verified',
    goose: 'not installed here, so the window setting it reads cannot be verified',
}

describe('every chat backend', () => {
    test('the catalog has chat backends to check', () => {
        expect(chatBackends.length).toBeGreaterThan(3)
    })

    for (const b of chatBackends) {
        describe(b.id, () => {
            test('sends the shared instructions: rendering, the daemon by name, the bismuth CLI', async () => {
                const probe = instructionsOf(b.id)
                expect(probe, `${b.id} has no instructions probe`).toBeDefined()
                const text = await probe!(daemonVault())
                expect(text).toContain(CHAT_RENDERING_NOTE)
                expect(text).toContain("You are m, this vault's Bismuth daemon")
                expect(text).toContain(AGENT_CLI_NOTE)
            })

            test('wires the Bismuth MCP when it speaks MCP', async () => {
                const probe = mcpOf(b.id)
                expect(probe, `${b.id} has no MCP probe`).toBeDefined()
                const command = await probe!(daemonVault())
                if (b.capabilities.mcp === 'none') expect(command).toBeNull()
                else expect(command ?? '').toEndWith('bismuth-mcp')
            })

            test('lists its chats in history exactly when the catalog shows the picker', () => {
                const source = CHAT_HISTORY_SOURCES[b.id as BackendId]
                expect(!!source).toBe(b.capabilities.sessionPicker)
                if (source) expect(b.capabilities.historyReplay).toBe(true)
            })

            if (b.capabilities.localModel)
                test('sizes its prompt to a local model’s loaded window, or names why not', () => {
                    const sized = WINDOW_SIZED[b.id]
                    expect(!!sized || !!UNSIZED[b.id]).toBe(true)
                    sized?.()
                })
        })
    }

    test('the window gap list names only local-model backends that are not sized', () => {
        for (const id of Object.keys(UNSIZED)) {
            const b = chatBackends.find(x => x.id === id)
            expect(b?.capabilities.localModel).toBe(true)
            expect(WINDOW_SIZED[id]).toBeUndefined()
        }
    })
})

describe('the Bismuth MCP server an ACP agent launches', () => {
    test('runs the installed CLI and docs, as every other registration does', () => {
        const env = Object.fromEntries(
            (buildMcpServers('/vault', undefined, FAKE_MCP)[0]?.env ?? []).map(e => [e.name, e.value]),
        )
        expect(env.BISMUTH_CLI).toBe(bismuthHome('bin', 'bismuth'))
        expect(env.BISMUTH_DOCS_DIR).toBe(bismuthHome('docs'))
        expect(env.BISMUTH_VAULT).toBe('/vault')
    })
})

describe('history sources own disjoint ids', () => {
    test('a Claude session id and an opencode id each have one owner', () => {
        const ids = ['0ef199f6-7c8e-4f77-821d-76e79968c2ff', 'ses_e242d2f54ffeUXaxS7QRJDzuUF']
        for (const id of ids) {
            const owners = Object.entries(CHAT_HISTORY_SOURCES).filter(([, s]) => s?.owns(id))
            expect(owners.length).toBe(1)
        }
    })
})
