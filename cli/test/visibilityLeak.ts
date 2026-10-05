// cli/test/visibilityLeak.ts
// The shared fixture every agent-visibility leak test uses. One vault with a note in every
// restriction state, plus a runner that spawns the REAL CLI the two ways an agent can reach it, and
// the four-way assertion that says who may see what.
//
//   owner   no env vars                     sees everything
//   chat    hidden notes + hidden folders   sees open + chat-only
//   daemon  hidden + chat-only + folders    sees open only
//
// `via: 'cli'` stamps BISMUTH_AGENT_CHANNEL (a directly-spawned agent's shell). `via: 'mcp'` stamps
// ONLY BISMUTH_MCP_CHANNEL — what the CLI sees when the MCP server spawned it; with
// BISMUTH_AGENT_CHANNEL absent the CLI's own gate falls back to that var and gates and filters as an
// agent (neither var set is the ungated owner). Every leak test runs its daemon case through both.
import { expect } from 'bun:test'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'

export const TOKENS = {
    open: 'OPENTOKEN',
    secret: 'SECRETTOKEN',
    chatty: 'CHATTYTOKEN',
    folder: 'FOLDERTOKEN',
} as const

const REPO_ROOT = join(import.meta.dir, '..', '..')

/** The vault `runCli` targets when `args` carry no `--vault`: the one `makeLeakVault` made last.
 *  A test that needs a different vault (an unparseable one, say) passes `--vault` itself. */
let currentVault: string | undefined

const FLASHCARD_TAGS = 'flashcards'

/**
 * A temp vault containing:
 *
 *   open.md                  visible. OPENTOKEN, #shared, links [[secret]] [[chatty]], a task, a
 *                            flashcard, the `flashcards` tag
 *   Private/secret.md        `visibility: hidden`. SECRETTOKEN, #onlysecret, a task, a flashcard,
 *                            links [[open]]
 *   chatty.md                `visibility: chat-only`. CHATTYTOKEN, #onlychatty, a task
 *   Vault Hidden/inner.md    no frontmatter; its folder is hidden via `.settings` folderVisibility.
 *                            FOLDERTOKEN, a task
 *   All Notes.md             `type: base` table over every note (no source)
 *   Cal.md                   a visible `view: calendar` base, one event (OPENTOKEN)
 *   Private/Cal Secret.md    a hidden calendar base, one event (SECRETTOKEN)
 *   templates/Visible Tpl.md, templates/Secret Tpl.md (hidden)
 *   .settings                folderVisibility + the templates folder
 */
export function makeLeakVault(): { vault: string } {
    const vault = makeVault({
        'open.md':
            `---\ntags: [shared, ${FLASHCARD_TAGS}]\n---\n` +
            `# Open\n${TOKENS.open} #shared\n\n` +
            'links [[secret]] [[chatty]]\n\n' +
            `- [ ] open task ${TOKENS.open}\n\n` +
            `what is ${TOKENS.open}::open answer ${TOKENS.open}\n`,
        'Private/secret.md':
            `---\nvisibility: hidden\ntags: [onlysecret, ${FLASHCARD_TAGS}]\n---\n` +
            `# Secret\n${TOKENS.secret} #onlysecret\n\n` +
            'links [[open]]\n\n' +
            `- [ ] secret task ${TOKENS.secret}\n\n` +
            `what is ${TOKENS.secret}::secret answer ${TOKENS.secret}\n`,
        'chatty.md':
            '---\nvisibility: chat-only\ntags: [onlychatty]\n---\n' +
            `# Chatty\n${TOKENS.chatty} #onlychatty\n\n` +
            `- [ ] chatty task ${TOKENS.chatty}\n`,
        'Vault Hidden/inner.md':
            `# Inner\n${TOKENS.folder}\n\n- [ ] inner task ${TOKENS.folder}\n`,
        'All Notes.md': '---\ntype: base\nview: table\n---\n',
        'Cal.md':
            '---\ntype: base\nview: calendar\n---\n\n' +
            `- id: ev-open\n  title: Open event ${TOKENS.open}\n  date: 2026-10-05\n`,
        'Private/Cal Secret.md':
            '---\nvisibility: hidden\ntype: base\nview: calendar\n---\n\n' +
            `- id: ev-secret\n  title: Secret event ${TOKENS.secret}\n  date: 2026-10-06\n`,
        'templates/Visible Tpl.md': `# Visible template\n${TOKENS.open}\n`,
        'templates/Secret Tpl.md': `---\nvisibility: hidden\n---\n# Secret template\n${TOKENS.secret}\n`,
        '.settings':
            'folderVisibility:\n  Vault Hidden: hidden\ntemplates:\n  folder: templates\n',
    })
    currentVault = vault
    return { vault }
}

export type RunOpts = { channel: 'owner' | 'chat' | 'daemon'; via?: 'cli' | 'mcp' }

/**
 * Spawn `bun run cli/src/index.ts <args> --vault <vault>` in a real subprocess. `--vault` is
 * appended only when `args` lack one (the vault is the last `makeLeakVault()`'s). The owner gets
 * neither channel var; an agent gets exactly one, per `via` (default `'cli'`).
 */
export async function runCli(
    args: string[],
    opts: RunOpts,
): Promise<{ code: number; stdout: string; stderr: string }> {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    env.BROWSER = 'none'
    if (opts.channel !== 'owner') {
        if ((opts.via ?? 'cli') === 'mcp')
            env.BISMUTH_MCP_CHANNEL = opts.channel
        else env.BISMUTH_AGENT_CHANNEL = opts.channel
    }
    const full =
        currentVault && !args.includes('--vault')
            ? [...args, '--vault', currentVault]
            : args
    const proc = Bun.spawn(
        ['bun', 'run', join(REPO_ROOT, 'cli/src/index.ts'), ...full],
        { cwd: REPO_ROOT, env, stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { code, stdout, stderr }
}

/** Which tokens a channel may see. */
const SEES: Record<RunOpts['channel'], (keyof typeof TOKENS)[]> = {
    owner: ['open', 'secret', 'chatty', 'folder'],
    chat: ['open', 'chatty'],
    daemon: ['open'],
}

/** The restricted names that must be absent for a channel: file names a hidden note derives. */
const NAMES_HIDDEN_FROM: Record<RunOpts['channel'], string[]> = {
    owner: [],
    chat: [
        'Private/secret',
        'onlysecret',
        'Vault Hidden',
        'inner',
        'Secret Tpl',
        'Cal Secret',
    ],
    daemon: [
        'Private/secret',
        'onlysecret',
        'Vault Hidden',
        'inner',
        'Secret Tpl',
        'Cal Secret',
        'chatty.md',
        'onlychatty',
    ],
}

/** The name half of the assertion, for commands that print names but no body text (`tree`). */
export function expectNamesHiddenFrom(
    out: string,
    channel: RunOpts['channel'],
): void {
    for (const name of NAMES_HIDDEN_FROM[channel])
        expect(out, `"${name}" leaked to ${channel}`).not.toContain(name)
}

/**
 * The four-way assertion. owner sees all four tokens; chat sees open + chatty, not secret/folder;
 * daemon sees only open. Also asserts the restricted file NAMES (`Private/secret`, `chatty.md`,
 * `inner`, `Secret Tpl`, `Cal Secret`, the hidden tags and folder) are absent wherever their token must be. A command that prints names
 * but no content (`tree`) uses {@link expectNamesHiddenFrom} instead, since no token appears there.
 */
export function expectVisibleFor(
    out: string,
    channel: RunOpts['channel'],
): void {
    const sees = new Set(SEES[channel])
    for (const key of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
        if (sees.has(key))
            expect(out, `${TOKENS[key]} missing for ${channel}`).toContain(
                TOKENS[key],
            )
        else
            expect(out, `${TOKENS[key]} leaked to ${channel}`).not.toContain(
                TOKENS[key],
            )
    }
    expectNamesHiddenFrom(out, channel)
}
