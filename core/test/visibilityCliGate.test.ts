import { tempDir } from './helpers'
import { test, expect, describe } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
    commandTier,
    decideCliGate as decideWithOpts,
    gateChannel,
    AGENT_PROTECTED_PATHS,
    gateCliArgs,
    gateCliInvocation,
    mcpChannel,
    cliAgentChannel,
    cliIsAgentHand,
    type DecideOpts,
} from '../src/visibilityCliGate'
import { doctorAgentOptions } from '../../cli/src/commands/doctor'

// The hole this gate closes, restated so a future reader knows what not to "simplify" away:
// `bismuth read Private/secret.md` returns a hidden note verbatim, whether run through the
// `bismuth_cli` MCP tool (gateCliArgs) OR as a bare Bash subprocess with no MCP layer at all
// (gateCliInvocation, hooked at the CLI's own dispatch point). Claude sessions were protected by
// the SDK-specific `disallowedTools: ["mcp__bismuth__bismuth_cli"]`, which touches only the MCP
// calling convention — Bash is deliberately never disallowed (the daemon needs `bismuth checkpoint`).

const RESTRICTED = [
    { rel: 'Private/secret.md', abs: '/vaults/v/Private/secret.md' },
]

/** `decideCliGate` against the fixture vault `/vaults/v` (the real `vaultRoot` is required). */
const decideCliGate = (
    args: string[],
    restricted: typeof RESTRICTED,
    opts: Partial<DecideOpts> = {},
) => decideWithOpts(args, restricted, { vaultRoot: '/vaults/v', ...opts })

describe('mcpChannel', () => {
    test('defaults to the STRICTER daemon channel when unset or unrecognized', () => {
        // Fail-safe: a spawner that forgets to declare itself must not get the permissive answer.
        expect(mcpChannel({})).toBe('daemon')
        expect(mcpChannel({ BISMUTH_MCP_CHANNEL: 'nonsense' })).toBe('daemon')
        expect(mcpChannel({ BISMUTH_MCP_CHANNEL: '' })).toBe('daemon')
    })
    test('honours an explicit chat channel', () => {
        expect(mcpChannel({ BISMUTH_MCP_CHANNEL: 'chat' })).toBe('chat')
    })
})

describe('cliIsAgentHand', () => {
    test('an agent channel stamp or an MCP spawn is an agent; neither is the owner', () => {
        expect(cliIsAgentHand({})).toBe(false)
        expect(cliIsAgentHand({ BISMUTH_AGENT_CHANNEL: '' })).toBe(false)
        expect(cliIsAgentHand({ BISMUTH_AGENT_CHANNEL: 'chat' })).toBe(true)
        expect(cliIsAgentHand({ BISMUTH_AGENT_CHANNEL: 'nonsense' })).toBe(true)
        expect(cliIsAgentHand({ BISMUTH_MCP_CHANNEL: 'daemon' })).toBe(true)
    })
})

describe('cliAgentChannel', () => {
    test("ABSENT means the OWNER's own hand — 'owner', not a channel", () => {
        // This is the crux of the CLI's own gate: get this backwards and either the owner is locked
        // out of their own CLI, or every agent that forgets to stamp the var is ungated.
        expect(cliAgentChannel({})).toBe('owner')
    })
    test('an explicit chat/daemon value is honoured', () => {
        expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: 'chat' })).toBe('chat')
        expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: 'daemon' })).toBe(
            'daemon',
        )
    })
    test("a garbled NON-EMPTY value fails safe to 'daemon', NOT to 'owner'", () => {
        // Unset and garbled must not collapse to the same answer — a corrupted signal should still gate.
        expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: 'nonsense' })).toBe(
            'daemon',
        )
        // NOTE: an EMPTY value used to assert "daemon" here. The acceptance run showed that locks the
        // OWNER out of their own CLI (`export BISMUTH_AGENT_CHANNEL=` is ordinary in a human shell), and
        // Bismuth never writes an empty value itself. See the dedicated empty-value test below.
    })
})

describe('decideCliGate', () => {
    test('allows everything when the vault restricts nothing', () => {
        expect(decideCliGate(['read', 'Private/secret.md'], []).allowed).toBe(
            true,
        )
    })
    test('refuses a restricted path named relatively', () => {
        const d = decideCliGate(['read', 'Private/secret.md'], RESTRICTED)
        expect(d.allowed).toBe(false)
        expect(d.reason).toContain('Private/secret.md')
    })
    test('refuses the same file named ABSOLUTELY — both path forms are load-bearing', () => {
        // The exact bug docs/vault/visibility.md records for Claude's deny list: a gate keyed on one
        // path form silently fails on the other.
        expect(
            decideCliGate(['read', '/vaults/v/Private/secret.md'], RESTRICTED)
                .allowed,
        ).toBe(false)
    })
    test('refuses a path embedded in a flag value or a query string', () => {
        expect(
            decideCliGate(
                ['prop', 'get', '--path=Private/secret.md'],
                RESTRICTED,
            ).allowed,
        ).toBe(false)
        expect(
            decideCliGate(
                ['api', 'GET', '/file?path=Private/secret.md'],
                RESTRICTED,
            ).allowed,
        ).toBe(false)
    })
    test('refuses a case-variant path — macOS filesystems are case-insensitive', () => {
        expect(
            decideCliGate(['read', 'private/SECRET.md'], RESTRICTED).allowed,
        ).toBe(false)
    })
    test('allows an unrelated visible file while something else is restricted', () => {
        expect(decideCliGate(['read', 'open.md'], RESTRICTED).allowed).toBe(
            true,
        )
    })
    test('refuses the unfilterable content commands wholesale when ANYTHING is restricted', () => {
        // `api`/`export` return a hidden file's matching LINES without ever naming it, so no path check
        // can catch them, and nothing filters their output. Same reason Claude disables Grep/Glob outright.
        for (const cmd of ['api', 'export']) {
            const d = decideCliGate([cmd, 'THE-SECRET'], RESTRICTED)
            expect(d.allowed).toBe(false)
            expect(d.reason).toContain(cmd)
            // The message names the commands this tier covers.
            expect(d.reason).toContain('`settings status-bar`')
        }
    })
    test('refuses `bismuth api` — a passthrough to ANY server route, including the ambient GET /file oracle', () => {
        expect(
            decideCliGate(
                ['api', 'GET', '/file?path=Private/secret.md'],
                RESTRICTED,
            ).allowed,
        ).toBe(false)
    })
    test('refuses `bismuth serve` when restricted — it spins up another unauthenticated content oracle', () => {
        // A restricted vault must not let an agent shell out to its OWN fresh core server and curl the
        // unfiltered GET /file / POST /search / POST /rows routes from the same Bash tool.
        expect(
            decideCliGate(['serve', '--port', '9999'], RESTRICTED).allowed,
        ).toBe(false)
    })
    test('allows `bismuth serve` when nothing is restricted', () => {
        expect(decideCliGate(['serve'], []).allowed).toBe(true)
    })
    test('`checkpoint diff` is filtered, not refused — it prints paths only, which the command filters', () => {
        // `git diff --name-status` carries no note body; checkpoint.ts drops restricted paths itself.
        expect(commandTier(['checkpoint', 'diff'])).toBe('filtered')
        expect(decideCliGate(['checkpoint', 'diff'], RESTRICTED).allowed).toBe(
            true,
        )
        // An explicit restricted path in argv still refuses, as for every filtered command.
        expect(
            decideCliGate(
                ['checkpoint', 'diff', 'r', '--dir', 'Private/secret.md'],
                RESTRICTED,
            ).allowed,
        ).toBe(false)
    })
    test('allows `checkpoint advance`/`checkpoint ref` even when restricted — no content leaves either', () => {
        // Unlike `checkpoint diff`, these touch only a ref pointer. The daemon's own crons
        // (Feature #51 change-scoping) legitimately call these, and a restricted vault must not brick
        // that — this is why checkpoint needs a COMPOUND override rather than a whole-group tier.
        expect(
            decideCliGate(['checkpoint', 'advance'], RESTRICTED).allowed,
        ).toBe(true)
        expect(decideCliGate(['checkpoint', 'ref'], RESTRICTED).allowed).toBe(
            true,
        )
    })
    test('the filtered groups are allowed when no argv path is restricted — they filter their own output', () => {
        for (const cmd of [
            'tree',
            'templates',
            'graph',
            'search',
            'replace',
            'rows',
            'row',
            'base',
            'task',
            'card',
            'calendar',
            'gcal',
            'relay',
            'note',
            'daily',
        ]) {
            expect(commandTier([cmd, 'x'])).toBe('filtered')
            expect(decideCliGate([cmd, 'x'], RESTRICTED).allowed).toBe(true)
        }
    })
    test('the filtered groups still refuse when an argv token names a restricted path', () => {
        for (const cmd of ['search', 'rows', 'task', 'base', 'note', 'tree']) {
            const d = decideCliGate([cmd, 'Private/secret.md'], RESTRICTED)
            expect(d.allowed).toBe(false)
            expect(d.reason).toContain('Private/secret.md')
        }
        // And embedded in a flag value, like the path-scoped tier.
        expect(
            decideCliGate(['base', 'render', '--file=Private/secret.md'], RESTRICTED)
                .allowed,
        ).toBe(false)
    })
    test('the filtered tier allows when nothing is restricted', () => {
        expect(decideCliGate(['search', 'x'], []).allowed).toBe(true)
    })
    test('the groups that cannot be filtered per file stay refused', () => {
        for (const cmd of ['api', 'serve', 'export', 'chat', 'update']) {
            expect(commandTier([cmd, 'x'])).toBe('refuse-when-restricted')
            expect(decideCliGate([cmd, 'x'], RESTRICTED).allowed).toBe(false)
        }
        expect(
            decideCliGate(['settings', 'status-bar'], RESTRICTED).allowed,
        ).toBe(false)
    })
    test('`settings status-bar` refuses when restricted; other settings commands stay safe', () => {
        expect(commandTier(['settings', 'status-bar'])).toBe('refuse-when-restricted')
        expect(commandTier(['settings', 'get'])).toBe('always-safe')
    })
    test('an UNKNOWN command refuses — a future CLI command must not fail open', () => {
        // The whole point of inverting the denylist: this build cannot know what the CLI grows next.
        expect(
            decideCliGate(['some-new-command', 'x'], RESTRICTED).allowed,
        ).toBe(false)
        expect(commandTier(['some-new-command'])).toBe('refuse-when-restricted')
    })
    test('`chat` (cli/src/commands/chat.ts) falls through to refuse-when-restricted by default — no entry needed in ALWAYS_SAFE_COMMANDS/PATH_SCOPED_COMMANDS', () => {
        // `chat list/read/search` wrap the owner-gated GET /chat/sessions, GET /chat/session-messages,
        // POST /chat/search routes (cli/src/http.ts now attaches the owner token, making these
        // reachable from a shell for the first time). It is deliberately absent from both allowlists
        // above, so it lands in the same refuse-by-default tail as `search`/`api`/`export` — this
        // pins that classification so a future refactor can't silently move it into a safe tier.
        expect(commandTier(['chat', 'list'])).toBe('refuse-when-restricted')
        expect(commandTier(['chat', 'read'])).toBe('refuse-when-restricted')
        expect(commandTier(['chat', 'search'])).toBe('refuse-when-restricted')
        expect(decideCliGate(['chat', 'list'], RESTRICTED).allowed).toBe(false)
        expect(decideCliGate(['chat', 'search', 'x'], RESTRICTED).allowed).toBe(
            false,
        )
        // Nothing restricted in the vault → the gate has nothing to refuse, same as every other
        // Tier-C command (see "allows those same commands when nothing is restricted" above).
        expect(decideCliGate(['chat', 'list'], []).allowed).toBe(true)
    })
    test('an UNKNOWN checkpoint subcommand refuses too — only advance/ref are overridden', () => {
        expect(
            decideCliGate(['checkpoint', 'some-future-subcommand'], RESTRICTED)
                .allowed,
        ).toBe(false)
    })
    test('machine/app/daemon plumbing stays usable in a restricted vault', () => {
        // A restricted vault must not brick the agent's ability to drive the app or report status.
        for (const cmd of [
            'backends',
            'app',
            'daemon',
            'install',
            'settings',
            'page',
        ]) {
            expect(decideCliGate([cmd, 'status'], RESTRICTED).allowed).toBe(
                true,
            )
        }
        expect(decideCliGate(['--help'], RESTRICTED).allowed).toBe(true)
        expect(decideCliGate([], RESTRICTED).allowed).toBe(true)
    })
    test('allows those same commands when nothing is restricted', () => {
        expect(decideCliGate(['search', 'anything'], []).allowed).toBe(true)
        expect(decideCliGate(['checkpoint', 'diff'], []).allowed).toBe(true)
        expect(decideCliGate(['serve'], []).allowed).toBe(true)
    })
})

describe('gateCliArgs (the MCP path, end to end against a real vault)', () => {
    function makeVault(): string {
        const root = tempDir('bismuth-vis-gate-')
        mkdirSync(join(root, 'Private'), { recursive: true })
        writeFileSync(
            join(root, 'Private', 'secret.md'),
            '---\nvisibility: hidden\n---\nTHE-SECRET-STRING-42\n',
        )
        writeFileSync(
            join(root, 'Private', 'chatty.md'),
            '---\nvisibility: chat-only\n---\nchat may see this\n',
        )
        writeFileSync(join(root, 'open.md'), 'ordinary\n')
        return root
    }

    test('refuses reading a hidden note — the regression this gate exists for', async () => {
        const root = makeVault()
        const d = await gateCliArgs(['read', 'Private/secret.md'], {
            BISMUTH_VAULT: root,
        })
        expect(d.allowed).toBe(false)
        expect(d.reason).toContain('Private/secret.md')
    })

    test('gateCliArgs matches decideCliGate on the same argv — the filtered tier included', async () => {
        const root = makeVault()
        const env = { BISMUTH_VAULT: root, BISMUTH_MCP_CHANNEL: 'daemon' }
        // search/rows are `filtered`: allowed while no argv path is restricted, refused when one is.
        for (const argv of [
            ['search', 'THE-SECRET-STRING-42'],
            ['rows'],
            ['search', 'Private/secret.md'],
            ['task', 'list', '--file', 'Private/secret.md'],
            ['api', 'GET', '/graph'],
        ]) {
            const restricted = [
                {
                    rel: 'Private/secret.md',
                    abs: join(root, 'Private/secret.md'),
                },
            ]
            const viaArgs = await gateCliArgs(argv, env)
            const viaDecide = decideCliGate(argv, restricted)
            expect(viaArgs.allowed).toBe(viaDecide.allowed)
        }
    })

    test('allows reading an unrestricted note', async () => {
        const root = makeVault()
        expect(
            (await gateCliArgs(['read', 'open.md'], { BISMUTH_VAULT: root }))
                .allowed,
        ).toBe(true)
    })

    test('a chat-only note is refused on the daemon channel but allowed on chat', async () => {
        // The whole point of the middle tier, and the reason the channel default matters.
        const root = makeVault()
        const asDaemon = await gateCliArgs(['read', 'Private/chatty.md'], {
            BISMUTH_VAULT: root,
        })
        const asChat = await gateCliArgs(['read', 'Private/chatty.md'], {
            BISMUTH_VAULT: root,
            BISMUTH_MCP_CHANNEL: 'chat',
        })
        expect(asDaemon.allowed).toBe(false)
        expect(asChat.allowed).toBe(true)
    })

    test('a hidden note stays refused even on the chat channel', async () => {
        const root = makeVault()
        const asChat = await gateCliArgs(['read', 'Private/secret.md'], {
            BISMUTH_VAULT: root,
            BISMUTH_MCP_CHANNEL: 'chat',
        })
        expect(asChat.allowed).toBe(false)
    })

    test('no vault configured allows through — nothing to protect, and docs/help need no vault', async () => {
        expect((await gateCliArgs(['--help'], {})).allowed).toBe(true)
    })

    test('an unreadable vault REFUSES rather than allowing', async () => {
        // A gate that opens when it malfunctions is not a gate. buildDenyPaths tolerates a missing dir by
        // returning [], so assert the stronger property directly: a thrown resolution refuses.
        const d = await gateCliArgs(['read', 'x.md'], {
            BISMUTH_VAULT: '\0invalid',
        })
        expect(d.allowed).toBe(false)
    })

    test("a --vault FLAG (not just the env var) is also honored, matching requireVault's own resolution", async () => {
        // mcp/src/cli.ts passes process.env through unchanged, but an agent can still pass --vault
        // explicitly in argv; a gate that only checked env would miss it entirely.
        const root = makeVault()
        const d = await gateCliArgs(
            ['read', 'Private/secret.md', '--vault', root],
            {},
        )
        expect(d.allowed).toBe(false)
    })
})

describe("gateCliInvocation (the CLI's own dispatch-point gate)", () => {
    function makeVault(): string {
        const root = tempDir('bismuth-vis-gate-direct-')
        mkdirSync(join(root, 'Private'), { recursive: true })
        writeFileSync(
            join(root, 'Private', 'secret.md'),
            '---\nvisibility: hidden\n---\nTHE-SECRET-STRING-42\n',
        )
        writeFileSync(
            join(root, 'Private', 'chatty.md'),
            '---\nvisibility: chat-only\n---\nchat may see this\n',
        )
        writeFileSync(join(root, 'open.md'), 'ordinary\n')
        return root
    }

    test("BISMUTH_AGENT_CHANNEL unset — the OWNER's own hand — reads a hidden note straight through", async () => {
        const root = makeVault()
        const d = await gateCliInvocation(
            ['read', 'Private/secret.md', '--vault', root],
            {},
        )
        expect(d.allowed).toBe(true)
    })

    test('the SAME command, same vault, with BISMUTH_AGENT_CHANNEL=daemon — refuses', async () => {
        const root = makeVault()
        const d = await gateCliInvocation(
            ['read', 'Private/secret.md', '--vault', root],
            {
                BISMUTH_AGENT_CHANNEL: 'daemon',
            },
        )
        expect(d.allowed).toBe(false)
        expect(d.reason).toContain('Private/secret.md')
    })

    test('`--vault=<v>` and `--dir=<v>` (the CLI flag()\'s second spelling) are resolved too — refused for a hidden path', async () => {
        const root = makeVault()
        for (const argv of [
            ['read', 'Private/secret.md', `--vault=${root}`],
            ['read', 'Private/secret.md', `--dir=${root}`],
            ['read', 'Private/secret.md', '--vault', root],
            ['read', 'Private/secret.md', '--dir', root],
        ]) {
            const d = await gateCliInvocation(argv, {
                BISMUTH_AGENT_CHANNEL: 'daemon',
            })
            expect(d.allowed, argv.join(' ')).toBe(false)
            expect(d.reason).toContain('Private/secret.md')
        }
    })

    test('ONLY BISMUTH_MCP_CHANNEL=daemon (an MCP-spawned CLI) is an agent: a hidden path is refused', async () => {
        const root = makeVault()
        const d = await gateCliInvocation(['read', 'Private/secret.md'], {
            BISMUTH_VAULT: root,
            BISMUTH_MCP_CHANNEL: 'daemon',
        })
        expect(d.allowed).toBe(false)
        expect(d.reason).toContain('Private/secret.md')
        // chat-only is visible on the chat channel, refused on daemon.
        expect(
            (
                await gateCliInvocation(['read', 'Private/chatty.md'], {
                    BISMUTH_VAULT: root,
                    BISMUTH_MCP_CHANNEL: 'chat',
                })
            ).allowed,
        ).toBe(true)
        // Neither var: the owner, ungated.
        expect(
            (
                await gateCliInvocation(['read', 'Private/secret.md'], {
                    BISMUTH_VAULT: root,
                })
            ).allowed,
        ).toBe(true)
        // BISMUTH_AGENT_CHANNEL still wins over the MCP var.
        expect(
            (
                await gateCliInvocation(['read', 'Private/chatty.md'], {
                    BISMUTH_VAULT: root,
                    BISMUTH_AGENT_CHANNEL: 'daemon',
                    BISMUTH_MCP_CHANNEL: 'chat',
                })
            ).allowed,
        ).toBe(false)
    })

    test('BISMUTH_AGENT_CHANNEL=chat also refuses a HIDDEN note (hidden means hidden from chat too)', async () => {
        const root = makeVault()
        const d = await gateCliInvocation(
            ['read', 'Private/secret.md', '--vault', root],
            {
                BISMUTH_AGENT_CHANNEL: 'chat',
            },
        )
        expect(d.allowed).toBe(false)
    })

    test('an agent channel still reads an UNRESTRICTED note fine', async () => {
        const root = makeVault()
        const d = await gateCliInvocation(
            ['read', 'open.md', '--vault', root],
            { BISMUTH_AGENT_CHANNEL: 'daemon' },
        )
        expect(d.allowed).toBe(true)
    })

    test('resolves the vault from the --vault ARGV flag, exactly like requireVault — env alone is not enough', async () => {
        // The daemon's own Bash tool never gets BISMUTH_VAULT in its env (only the MCP server's own env
        // block sets it) — it passes --vault explicitly, using its cwd. A gate that only checked env
        // would be a no-op for exactly this, the primary invocation shape this file exists to cover.
        const root = makeVault()
        const d = await gateCliInvocation(
            ['read', 'Private/secret.md', '--vault', root],
            {
                BISMUTH_AGENT_CHANNEL: 'daemon',
                BISMUTH_VAULT: undefined,
            },
        )
        expect(d.allowed).toBe(false)
    })

    test('`checkpoint diff` runs under an agent channel in a restricted vault, --dir only', async () => {
        // checkpoint.ts's own flag is --dir, not --vault (it's generic over any tracked repo). The
        // command filters its own path list, so a hidden note elsewhere in the vault does not refuse it.
        const root = makeVault()
        const d = await gateCliInvocation(
            ['checkpoint', 'diff', 'some-ref', '--dir', root],
            {
                BISMUTH_AGENT_CHANNEL: 'daemon',
            },
        )
        expect(d.allowed).toBe(true)
    })

    test('`checkpoint diff` is NOT refused for the owner (channel unset), --dir only', async () => {
        const root = makeVault()
        const d = await gateCliInvocation(
            ['checkpoint', 'diff', 'some-ref', '--dir', root],
            {},
        )
        expect(d.allowed).toBe(true)
    })

    test('`checkpoint advance`/`checkpoint ref` stay usable under an agent channel via --dir', async () => {
        const root = makeVault()
        for (const sub of ['advance', 'ref']) {
            const d = await gateCliInvocation(
                ['checkpoint', sub, 'some-ref', '--dir', root],
                {
                    BISMUTH_AGENT_CHANNEL: 'daemon',
                },
            )
            expect(d.allowed).toBe(true)
        }
    })

    test('app/daemon/install plumbing stays usable under an agent channel, in a restricted vault', async () => {
        const root = makeVault()
        for (const args of [
            ['app', 'tabs'],
            ['daemon', 'status'],
            ['install', '--status'],
            ['backends'],
        ]) {
            const d = await gateCliInvocation(args, {
                BISMUTH_AGENT_CHANNEL: 'daemon',
                BISMUTH_VAULT: root,
            })
            expect(d.allowed).toBe(true)
        }
    })

    test('no vault at all allows through regardless of channel — nothing to protect', async () => {
        expect(
            (
                await gateCliInvocation(['--help'], {
                    BISMUTH_AGENT_CHANNEL: 'daemon',
                })
            ).allowed,
        ).toBe(true)
    })
})

test('an EMPTY channel value is the owner, not an agent — found by the acceptance run', () => {
    // `export BISMUTH_AGENT_CHANNEL=` is ordinary in a human's shell, and Bismuth never writes an
    // empty value itself, so an empty one can only be the owner's. Treating it as an agent locked the
    // owner out of their own CLI — a violation of the one non-negotiable this feature has.
    expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: '' })).toBe('owner')
    expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: '   ' })).toBe('owner')
    expect(cliAgentChannel({})).toBe('owner')
    // A garbled NON-empty value still fails safe to the stricter channel.
    expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: 'nonsense' })).toBe(
        'daemon',
    )
    expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: 'chat' })).toBe('chat')
})

// --- Path spelling in argv: the same three axes isDeniedPath resolves ---
//
// The gate's original match was a lowercased SUBSTRING test, which handles case but nothing else.
// `bismuth read Private/../Private/secret.md` opens the hidden note (resolveInVault resolves the
// segments), and `café.md` written composed opens a file stored decomposed — both slid through.

describe('decideCliGate: path spellings', () => {
    const restricted = [
        { rel: 'Private/secret.md', abs: '/vault/Private/secret.md' },
    ]

    test('refuses a `.` or `..` spelling of a restricted path', () => {
        for (const spelling of [
            'Private/secret.md',
            'Private/./secret.md',
            'Private/../Private/secret.md',
            './Private/secret.md',
        ]) {
            const d = decideCliGate(['read', spelling], restricted)
            expect(d.allowed).toBe(false)
            expect(d.reason).toContain('Private/secret.md')
        }
    })

    test('refuses a `.`/`..` spelling carried in a --flag=value pair', () => {
        expect(
            decideCliGate(
                ['read', '--path=Private/../Private/secret.md'],
                restricted,
            ).allowed,
        ).toBe(false)
    })

    test('refuses an NFC spelling of a restricted path stored decomposed', () => {
        const nfd = 'Private/cafe\u0301.md' // e + combining acute
        const nfc = 'Private/caf\u00e9.md' // precomposed e-acute
        expect(nfd).not.toBe(nfc)
        const entries = [{ rel: nfd, abs: `/vault/${nfd}` }]
        expect(decideCliGate(['read', nfd], entries).allowed).toBe(false)
        expect(decideCliGate(['read', nfc], entries).allowed).toBe(false)
    })

    test('refuses a restricted path EMBEDDED in a longer token, in either unicode form', () => {
        // The substring pass, not the per-token pass: an argv token that merely CONTAINS a restricted
        // path (an export path derived from the hidden note) is not itself a path, so findDeniedEntry
        // cannot resolve it — only the substring scan sees it, and that scan must fold unicode form the
        // same way, or the composed spelling of a decomposed name walks straight through it.
        const nfd = 'Private/cafe\u0301.md' // e + combining acute
        const nfc = 'Private/caf\u00e9.md' // precomposed e-acute
        const entries = [{ rel: nfd, abs: `/vault/${nfd}` }]
        for (const form of [nfd, nfc]) {
            const d = decideCliGate(
                ['render', '--out', `exports/${form}.html`],
                entries,
            )
            expect(d.allowed).toBe(false)
        }
    })

    test('refuses a restricted path embedded in a longer token under EVERY segment spelling', () => {
        // The reported hole: `findDeniedEntry` cannot resolve a token whose path is only a substring,
        // and an unnormalized substring scan cannot see through `/./` or `//`. The `..` spelling was
        // caught by luck (the needle survives the detour verbatim), which is not coverage.
        for (const spelling of [
            'exports/Private/secret.md.html',
            'exports/Private/./secret.md.html',
            'exports/Private/../Private/secret.md.html',
            'exports/Private//secret.md.html',
            'exports/PRIVATE/./SECRET.md.html',
        ]) {
            const d = decideCliGate(['render', '--out', spelling], restricted)
            expect(d.allowed).toBe(false)
            expect(d.reason).toContain('Private/secret.md')
        }
    })

    test('an innocent token that merely resembles a restricted path still runs', () => {
        // Negative controls for the widening above: normalizing the whole token must not smear the
        // deny across neighbouring names, sibling directories, or a `..` that lands somewhere visible.
        for (const spelling of [
            'exports/public.md.html',
            'exports/Privateer/secretive.md.html',
            'exports/Private/../public.md.html',
        ]) {
            expect(
                decideCliGate(['render', '--out', spelling], restricted)
                    .allowed,
            ).toBe(true)
        }
    })

    test('the substring scan over-refuses a token that CONTAINS a restricted path as a prefix', () => {
        // Not a regression and not introduced by segment normalization — both of these refuse on the
        // unnormalized scan too, because the deny path is a literal substring of the token. Pinned
        // rather than left undocumented: it is the deliberate direction of this gate (a false refusal
        // costs one tool call; a false allow leaks a note), and someone reading the "over-inclusive on
        // purpose" note above should be able to see exactly what that buys and costs.
        for (const spelling of [
            'exports/NotPrivate/secret.md.backup.html', // contains "Private/secret.md"
            'exports/Private/secret.mdx.html', //          "secret.md" is a prefix of "secret.mdx"
        ]) {
            expect(
                decideCliGate(['render', '--out', spelling], restricted)
                    .allowed,
            ).toBe(false)
        }
    })

    test('a token whose restricted segment is cancelled by `..` runs (a pinned loosening)', () => {
        // Same behaviour change as isDeniedPath's, seen through the CLI gate: these refused before
        // segment normalization, purely on the verbatim substring, and run now. They resolve to
        // Private/other.md, other.md and Private/ respectively — never to the hidden note.
        for (const spelling of [
            'Private/secret.md/../other.md',
            'Private/secret.md/../../other.md',
        ]) {
            expect(decideCliGate(['read', spelling], restricted).allowed).toBe(
                true,
            )
        }
        // `Private/secret.md/..` resolves to the FOLDER Private/, an ancestor of the hidden note:
        // path-scoped commands now refuse a folder token that holds a restricted entry
        // (`delete Private` would move the hidden note into the trash).
        expect(
            decideCliGate(['read', 'Private/secret.md/..'], restricted).allowed,
        ).toBe(false)
        // Control: a `..` that resolves back ONTO the restricted path must still refuse.
        expect(
            decideCliGate(['read', 'Private/sub/../secret.md'], restricted)
                .allowed,
        ).toBe(false)
    })

    test('a path-scoped command naming only VISIBLE files still runs', () => {
        // The widening must not swallow the whole tier: this is the case the gate exists to permit.
        expect(decideCliGate(['read', 'public.md'], restricted).allowed).toBe(
            true,
        )
        expect(
            decideCliGate(['read', 'Private/../public.md'], restricted).allowed,
        ).toBe(true)
    })
})

describe('doctor', () => {
    test('is classified always-safe, so a restricted vault does not refuse it outright', () => {
        expect(commandTier(['doctor'])).toBe('always-safe')
        expect(commandTier(['doctor', '--fix', '--vault', '/v'])).toBe(
            'always-safe',
        )
        expect(decideCliGate(['doctor', '--fix'], RESTRICTED).allowed).toBe(true)
    })

    test('docs is classified always-safe too (product docs, not vault content)', () => {
        expect(commandTier(['docs', 'search', 'bases'])).toBe('always-safe')
        expect(decideCliGate(['docs', 'list'], RESTRICTED).allowed).toBe(true)
        expect(commandTier(['memory', 'recall'])).toBe('always-safe')
        expect(decideCliGate(['memory', 'recall', 'x'], RESTRICTED).allowed).toBe(true)
    })

    describe('doctorAgentOptions', () => {
        test("an owner's options pass through untouched", () => {
            const opts = { fix: true, only: ['a.b'] }
            expect(doctorAgentOptions(opts, false, true)).toBe(opts)
        })
        test('an agent is forced to safe repairs only, whatever it asked for', () => {
            expect(doctorAgentOptions({ fix: true }, true, false)).toEqual({
                fix: true,
                risks: ['safe'],
            })
            expect(
                doctorAgentOptions(
                    { fix: true, risks: ['safe', 'destructive'], only: ['x.y'] },
                    true,
                    false,
                ),
            ).toEqual({ fix: true, risks: ['safe'], only: ['x.y'] })
        })
        test('an agent in an unrestricted vault keeps the vault section', () => {
            expect(
                doctorAgentOptions({ fix: true }, true, false).sections,
            ).toBeUndefined()
        })
        test('an agent in a restricted vault loses the vault section only', () => {
            const s = doctorAgentOptions({}, true, true).sections!
            expect(s).not.toContain('vault')
            expect(s).toContain('install')
            expect(s).toContain('legacy')
        })
        test('an explicit --section list loses vault too, even when vault is all it asked for', () => {
            expect(
                doctorAgentOptions({ sections: ['vault', 'daemon'] }, true, true)
                    .sections,
            ).toEqual(['daemon'])
            expect(
                doctorAgentOptions({ sections: ['vault'] }, true, true).sections,
            ).toEqual([])
        })
        test('the owner in a restricted vault still sees every section', () => {
            expect(doctorAgentOptions({}, false, true).sections).toBeUndefined()
        })
    })
})

describe('gate bypasses: tokens, protected paths, reclassification', () => {
    const NONE: never[] = []
    const folderHidden = (dir: string) =>
        dir === 'Vault Hidden' || dir.startsWith('Vault Hidden/')
    const HIDDEN_FOLDER_ENTRIES = [
        {
            rel: 'Vault Hidden/inner.md',
            abs: '/vaults/v/Vault Hidden/inner.md',
        },
    ]

    test('AGENT_PROTECTED_PATHS is exactly the three rule/runnable paths', () => {
        expect([...AGENT_PROTECTED_PATHS]).toEqual([
            '.settings',
            'settings.yaml',
            '.daemon/processes',
        ])
    })

    test('protected paths refuse with an EMPTY restricted list, every spelling', () => {
        for (const argv of [
            ['write', '.settings', 'x'],
            ['write', './.settings', 'x'],
            ['write', '--path=.settings', 'x'],
            ['write', 'settings.yaml', 'x'],
            ['write', './.daemon/processes/x.md', 'x'],
            ['prop', '.daemon/processes/x.md', 'command', 'ls'],
            ['write', '/vaults/v/.daemon/processes/x.md', 'x'],
            ['read', '.DAEMON/Processes/x'],
            ['tree', '.daemon/processes'],
        ]) {
            const d = decideCliGate(argv, NONE)
            expect(d.allowed, argv.join(' ')).toBe(false)
            expect(d.reason).toContain('off-limits to AI sessions')
        }
        // And in a restricted vault too (check runs before the early return AND after it).
        expect(
            decideCliGate(['write', '.settings', 'x'], RESTRICTED).allowed,
        ).toBe(false)
    })

    test('protected-path tokens are not matched as bare substrings', () => {
        expect(decideCliGate(['write', 'my.settings.md', 'x'], NONE).allowed).toBe(true)
        expect(decideCliGate(['write', 'notes/daemon/processes.md', 'x'], NONE).allowed).toBe(true)
        // The always-safe tier is never path-checked: `daemon process toggle` must keep working.
        expect(decideCliGate(['daemon', 'process', 'toggle', 'x'], NONE).allowed).toBe(true)
    })

    test('the .md twin: a creator that appends .md cannot reach a hidden note', () => {
        for (const argv of [
            ['base', 'create', 'Private/secret'],
            ['calendar', 'create', 'Private/secret'],
            ['read', 'Private/secret'],
        ]) {
            const d = decideCliGate(argv, RESTRICTED)
            expect(d.allowed, argv.join(' ')).toBe(false)
            expect(d.reason).toContain('Private/secret.md')
        }
        expect(decideCliGate(['base', 'create', 'open'], RESTRICTED).allowed).toBe(true)
    })

    test('folder tokens: ancestor of a restricted entry refuses, an unrelated move does not', () => {
        for (const argv of [
            ['move', 'Private', 'Pub'],
            ['move', 'Private/', 'Pub'],
            ['delete', './Private'],
            ['move', '/vaults/v/Private', 'Pub'],
            ['delete', '--path=Private'],
        ]) {
            const d = decideCliGate(argv, RESTRICTED, { vaultRoot: '/vaults/v' })
            expect(d.allowed, argv.join(' ')).toBe(false)
            expect(d.reason).toContain('Private/secret.md')
        }
        expect(
            decideCliGate(['move', 'Pub/a.md', 'Other/a.md'], RESTRICTED).allowed,
        ).toBe(true)
        // Not applied to the filtered tier: `tree Private` filters its own output.
        expect(decideCliGate(['tree', 'Private'], RESTRICTED).allowed).toBe(true)
    })

    test('folder tokens: a restricted folder (or a child of one) refuses via restrictedFolder', () => {
        const opts = { restrictedFolder: folderHidden, vaultRoot: '/vaults/v' }
        for (const argv of [
            ['move', 'Vault Hidden', 'Pub'],
            ['delete', 'Vault Hidden'],
            ['write', 'Vault Hidden/new.md', 'x'],
            ['mkdir', 'Vault Hidden/x'],
            ['mkdir', 'Vault Hidden/x/y'],
        ]) {
            const d = decideCliGate(argv, NONE, opts)
            expect(d.allowed, argv.join(' ')).toBe(false)
            expect(d.reason).toContain('folder marked off-limits')
        }
        expect(decideCliGate(['move', 'Pub', 'Other'], NONE, opts).allowed).toBe(true)
        // The vault/dir flag values are never folder tokens.
        expect(
            decideCliGate(['read', 'open.md', '--vault', 'Vault Hidden'], NONE, opts).allowed,
        ).toBe(true)
        // Ancestor rule works with entries alone.
        expect(
            decideCliGate(['delete', 'Vault Hidden'], HIDDEN_FOLDER_ENTRIES).allowed,
        ).toBe(false)
    })

    test('reclassification: settings set/unset + folder-visibility refuse only when restricted', () => {
        for (const argv of [
            ['settings', 'set', 'folderVisibility', '{}'],
            ['settings', 'unset', 'folderVisibility'],
            ['folder-visibility', 'Vault Hidden', '--clear'],
            ['folder-visibility', 'A', 'hidden'],
        ]) {
            expect(commandTier(argv), argv.join(' ')).toBe('refuse-when-restricted')
            expect(decideCliGate(argv, RESTRICTED).allowed, argv.join(' ')).toBe(false)
            expect(decideCliGate(argv, NONE).allowed, argv.join(' ')).toBe(true)
        }
        expect(decideCliGate(['settings', 'get'], RESTRICTED).allowed).toBe(true)
        expect(decideCliGate(['settings', 'schema'], RESTRICTED).allowed).toBe(true)
        expect(decideCliGate(['settings', 'deny-list'], RESTRICTED).allowed).toBe(true)
    })

    test('existing two-arg callers keep working (opts optional)', () => {
        expect(decideCliGate(['read', 'open.md'], RESTRICTED).allowed).toBe(true)
    })
})

describe('gateChannel', () => {
    const A = 'BISMUTH_AGENT_CHANNEL'
    const M = 'BISMUTH_MCP_CHANNEL'
    test('neither var returns the fallback', () => {
        expect(gateChannel({}, null)).toBe(null)
        expect(gateChannel({}, 'daemon')).toBe('daemon')
        expect(gateChannel({ [A]: '' }, null)).toBe(null)
    })
    test('one var names its channel; garbled is daemon', () => {
        expect(gateChannel({ [A]: 'chat' }, null)).toBe('chat')
        expect(gateChannel({ [A]: 'x' }, null)).toBe('daemon')
        expect(gateChannel({ [M]: 'chat' }, null)).toBe('chat')
        expect(gateChannel({ [M]: 'daemon' }, null)).toBe('daemon')
        expect(gateChannel({ [M]: 'x' }, null)).toBe('daemon')
    })
    test('both set: chat only when both say chat', () => {
        expect(gateChannel({ [A]: 'chat', [M]: 'chat' }, null)).toBe('chat')
        expect(gateChannel({ [A]: 'chat', [M]: 'daemon' }, null)).toBe('daemon')
        expect(gateChannel({ [A]: 'daemon', [M]: 'chat' }, null)).toBe('daemon')
        expect(gateChannel({ [A]: 'chat', [M]: 'junk' }, 'chat')).toBe('daemon')
    })
})

describe('gate bypasses against real vaults', () => {
    function vault(): string {
        const root = tempDir('bismuth-vis-gate-bp-')
        mkdirSync(join(root, 'Private'), { recursive: true })
        mkdirSync(join(root, 'Vault Hidden'), { recursive: true })
        writeFileSync(
            join(root, 'Private', 'secret.md'),
            '---\nvisibility: hidden\n---\nS\n',
        )
        writeFileSync(join(root, 'Vault Hidden', 'inner.md'), 'I\n')
        writeFileSync(join(root, 'open.md'), 'o\n')
        writeFileSync(
            join(root, '.settings'),
            'folderVisibility:\n  Vault Hidden: hidden\n',
        )
        return root
    }
    const agent = { BISMUTH_AGENT_CHANNEL: 'daemon' }

    test('--dir cannot swap the checked vault: every root is gated', async () => {
        const root = vault()
        const empty = tempDir('bismuth-vis-gate-empty-')
        for (const argv of [
            ['read', 'Private/secret.md', '--vault', root, '--dir', empty],
            ['read', 'Private/secret.md', `--vault=${root}`, `--dir=${empty}`],
            ['read', 'Private/secret.md', '--dir', empty],
        ]) {
            const env = argv.includes('--vault') || argv[2]?.startsWith('--vault=')
                ? agent
                : { ...agent, BISMUTH_VAULT: root }
            expect((await gateCliInvocation(argv, env)).allowed, argv.join(' ')).toBe(false)
            expect((await gateCliArgs(argv, env)).allowed, argv.join(' ')).toBe(false)
        }
        // BISMUTH_VAULT is a root too, even when --vault names a harmless dir.
        expect(
            (
                await gateCliInvocation(['read', 'Private/secret.md', '--vault', empty], {
                    ...agent,
                    BISMUTH_VAULT: root,
                })
            ).allowed,
        ).toBe(false)
    })

    test('a subfolder addressed as the vault refuses; the vault root and the owner do not', async () => {
        const root = vault()
        const sub = join(root, 'Vault Hidden')
        const d = await gateCliInvocation(['read', 'inner.md', '--vault', sub], agent)
        expect(d.allowed).toBe(false)
        expect(d.reason).toContain('is inside the vault')
        expect((await gateCliArgs(['tree', '--vault', sub], agent)).allowed).toBe(false)
        expect(
            (await gateCliInvocation(['read', 'open.md', '--vault', root], agent)).allowed,
        ).toBe(true)
        expect(
            (await gateCliInvocation(['read', 'inner.md', '--vault', sub], {})).allowed,
        ).toBe(true)
        // The always-safe tier skips the subfolder check.
        expect(
            (await gateCliInvocation(['daemon', 'status', '--vault', sub], agent)).allowed,
        ).toBe(true)
        // <vault>/.daemon/memory is exempt.
        const mem = join(root, '.daemon', 'memory')
        mkdirSync(mem, { recursive: true })
        expect(
            (await gateCliInvocation(['checkpoint', 'ref', '--dir', mem], agent)).allowed,
        ).toBe(true)
    })

    test('folder token + protected path through the real entry points', async () => {
        const root = vault()
        for (const argv of [
            ['move', 'Vault Hidden', 'Pub', '--vault', root],
            ['delete', 'Vault Hidden', '--vault', root],
            ['write', '.settings', 'x', '--vault', root],
            ['folder-visibility', 'Vault Hidden', '--clear', '--vault', root],
            ['settings', 'set', 'folderVisibility', '{}', '--vault', root],
        ]) {
            expect((await gateCliInvocation(argv, agent)).allowed, argv.join(' ')).toBe(false)
            expect(
                (await gateCliArgs(argv, { BISMUTH_MCP_CHANNEL: 'daemon' })).allowed,
                argv.join(' '),
            ).toBe(false)
        }
        expect(
            (await gateCliInvocation(['move', 'open.md', 'b.md', '--vault', root], agent)).allowed,
        ).toBe(true)
    })

    test('process definitions are protected in a vault that restricts NOTHING', async () => {
        const root = tempDir('bismuth-vis-gate-plain-')
        writeFileSync(join(root, 'open.md'), 'o\n')
        const d = await gateCliInvocation(
            ['write', '.daemon/processes/x.md', 'x', '--vault', root],
            agent,
        )
        expect(d.allowed).toBe(false)
        expect(
            (await gateCliInvocation(['write', '.daemon/processes/x.md', 'x', '--vault', root], {}))
                .allowed,
        ).toBe(true)
    })

    test('a bad folderVisibility/.settings still refuses (fail closed)', async () => {
        const root = tempDir('bismuth-vis-gate-bad-')
        writeFileSync(join(root, '.settings'), 'folderVisibility: [oops\n')
        const d = await gateCliInvocation(['read', 'x.md', '--vault', root], agent)
        expect(d.allowed).toBe(false)
    })
})

describe('second-pass bypasses (pure decideCliGate)', () => {
    const hiddenFolder = (d: string) => d === 'Vault Hidden' || d.startsWith('Vault Hidden/')

    test('C1: --memory carrying the folder name does not switch off the folder check', () => {
        const d = decideCliGate(
            ['move', 'Vault Hidden', 'Pub', '--memory', 'Vault Hidden'],
            [],
            { restrictedFolder: hiddenFolder, vaultRoot: '/vaults/v' },
        )
        expect(d.allowed).toBe(false)
    })

    test('C2: ../, // and symlinked spellings of the folder still resolve to it', () => {
        const root = tempDir('gate-c2')
        mkdirSync(join(root, 'Vault Hidden'))
        const opts = { restrictedFolder: hiddenFolder, vaultRoot: root }
        const base = basename(root)
        for (const tok of [
            `../${base}/Vault Hidden`,
            `/${root}/Vault Hidden`,
            `//${root}/Vault Hidden`,
            'vault hidden',
        ])
            expect(decideCliGate(['move', tok, 'Pub'], [], opts).allowed, tok).toBe(false)
        expect(decideCliGate(['move', 'open.md', `//${root}/Vault Hidden/o.md`], [], opts).allowed).toBe(false)
    })

    test('a parent of an EMPTY hidden folder refuses, so moving it cannot orphan the rule', () => {
        const opts = { restrictingFolders: ['Parent/Empty'], folderRulesRestrict: true }
        for (const tok of ['Parent', 'parent', './Parent/'])
            expect(decideCliGate(['move', tok, 'X'], [], opts).allowed, tok).toBe(false)
        // A sibling, or the parent's own parent of an unrelated rule, still runs.
        expect(decideCliGate(['move', 'Par', 'X'], [], opts).allowed).toBe(true)
        expect(decideCliGate(['move', 'Other', 'X'], [], opts).allowed).toBe(true)
    })

    test('a folder NAMED ..x is inside the vault, not a climb out of it', () => {
        const root = tempDir('gate-dotdot')
        mkdirSync(join(root, '..dots'))
        const hidden = (d: string) => d === '..dots' || d.startsWith('..dots/')
        const opts = { restrictedFolder: hidden, folderRulesRestrict: true, vaultRoot: root }
        expect(decideCliGate(['move', '..dots', 'Pub'], [], opts).allowed).toBe(false)
        expect(decideCliGate(['delete', `${root}/..dots`], [], opts).allowed).toBe(false)
    })

    test('C3: the .daemon folder itself is protected, in every spelling', () => {
        for (const argv of [
            ['move', '.daemon', 'Stage'],
            ['move', 'Stage', '.daemon'],
            ['delete', '.daemon'],
        ])
            expect(decideCliGate(argv, []).allowed, argv.join(' ')).toBe(false)
        expect(decideCliGate(['read', '.daemon/memory/x.md'], []).allowed).toBe(true)
    })

    test('C4: protected paths are refused on the refuse tier in an unrestricted vault', () => {
        expect(
            decideCliGate(['export', 'a.md', '--out', '.daemon/processes/z.md'], []).allowed,
        ).toBe(false)
        expect(decideCliGate(['export', 'a.md', '--out', 'out/z.md'], []).allowed).toBe(true)
    })

    test('I1: a folder rule that restricts the channel counts even with no restricted file', () => {
        expect(
            decideCliGate(['folder-visibility', 'Journal', '--clear'], [], {
                folderRulesRestrict: true,
            }).allowed,
        ).toBe(false)
        expect(
            decideCliGate(['folder-visibility', 'Journal', '--clear'], [], {
                folderRulesRestrict: false,
            }).allowed,
        ).toBe(true)
    })
})

describe('R1/R2: stale run records + percent-encoded paths', () => {
    test('api GET with percent-encoded protected paths is refused (pure)', () => {
        for (const route of [
            '/file?path=%2Esettings',
            '/file?path=.daemon%2Fprocesses%2Fp.md',
            '/file?path=%252Esettings',
        ]) {
            const d = decideCliGate(['api', 'GET', route], [])
            expect(d.allowed, route).toBe(false)
        }
    })

    test('api GET with a percent-encoded hidden note is refused (pure)', () => {
        const d = decideCliGate(['api', 'GET', '/file?path=Private%2Fsecret.md'], RESTRICTED)
        expect(d.allowed).toBe(false)
    })

    test('a malformed escape does not throw', () => {
        expect(() => decideCliGate(['read', '100%.md'], [])).not.toThrow()
    })

    function withStaleRecord<T>(fn: () => Promise<T>): Promise<T> {
        const saved = process.env.BISMUTH_RUN_DIR
        const dir = tempDir('bismuth-vis-gate-run-')
        const gone = '/nonexistent/vault'
        writeFileSync(
            join(dir, `${Buffer.from(gone).toString('base64url')}.json`),
            JSON.stringify({ port: 6169, vault: gone, pid: process.pid }),
        )
        process.env.BISMUTH_RUN_DIR = dir
        return fn().finally(() => {
            if (saved === undefined) delete process.env.BISMUTH_RUN_DIR
            else process.env.BISMUTH_RUN_DIR = saved
        })
    }

    test('a run record whose vault is gone is ignored for HTTP-routed commands', async () => {
        const root = tempDir('bismuth-vis-gate-live-')
        writeFileSync(join(root, 'open.md'), 'ordinary\n')
        const d = await withStaleRecord(() =>
            gateCliInvocation(['api', 'GET', '/version', '--vault', root], {
                BISMUTH_AGENT_CHANNEL: 'daemon',
            }),
        )
        expect(d.allowed).toBe(true)
    })

    test('owner stays ungated with a stale record present', async () => {
        const d = await withStaleRecord(() =>
            gateCliInvocation(['api', 'GET', '/version'], {}),
        )
        expect(d.allowed).toBe(true)
    })
})
