import { readFile } from 'node:fs/promises'
import { parseFrontmatter } from '../lib/frontmatter.ts'
import type { VaultContext } from '../lib/config.ts'
import type { DenyEntry } from '../lib/visibility.ts'
import { composeBrain } from '../lib/coreBrain.js'
import { DEFAULT_DAEMON_IDENTITY } from '../../../core/src/daemonIdentity.ts'

type ComposeBrain = (opts: {
    vaultDir: string
    memoryDir: string | null
    channel: 'daemon'
    waitMs?: number
}) => Promise<string | null>

/** How long a daemon session waits for a cold vault-map build before the persona goes out without
 *  its `# Vault map` section. core's own default is 1 s (built for interactive chat); a daemon
 *  session is a background run, so it waits up to 30 s. */
export const DAEMON_BRAIN_WAIT_MS = 30_000

/** How a daemon backend receives the persona text:
 *  - `systemPromptAppend`: the Agent SDK's `systemPrompt: { type: 'preset', preset: 'claude_code', append }`.
 *  - `developerInstructions`: `codex exec --config developer_instructions=<TOML string>`. */
export type PersonaChannel = 'systemPromptAppend' | 'developerInstructions'

/** Every backend that can run a vault's brain, and the channel its persona rides. Literal
 *  duplication of the `daemon` capability in core/src/agentBackends/catalog.ts (this workspace has
 *  no dependency on @bismuth/core); persona.test.ts asserts every daemon-capable catalog entry has
 *  a channel here. A backend with no entry can never run as a daemon — sendMessage refuses it. */
export const DAEMON_PERSONA_CHANNELS: Readonly<Record<string, PersonaChannel>> =
    {
        claude: 'systemPromptAppend',
        codex: 'developerInstructions',
    }

// The default personality lives in core, beside the one core-side write to identity.md (the
// first-run rename), so both writers seed the same text.
export { DEFAULT_DAEMON_IDENTITY }

/** The bot's persona for one vault: "You are <name>." followed by the user-editable
 *  .daemon/identity.md (or the default above when absent/empty), plus an ADVISORY visibility
 *  appendix naming any notes off-limits per the vault's visibility settings. Delivered to EVERY daemon backend through that backend's own channel
 *  ({@link DAEMON_PERSONA_CHANNELS}) so the daemon self-identifies (e.g. "Atlas") with whatever personality
 *  the user authored. Read fresh per session, so edits to identity.md/visibility take effect on
 *  the next cron/message.
 *
 *  The visibility appendix is defense-in-depth ONLY — same posture as the `dream` cron's
 *  unenforced boundary — never the gate. The REAL gate is sendMessage's managedSettings.deny +
 *  sandbox.filesystem.denyRead (core/src/visibility.ts's docs/vault/visibility.md threat model
 *  applies here too: this restricts the daemon's own tool calls, not the vault owner). */
export async function buildDaemonPersona(
    ctx: VaultContext,
    denyEntries: DenyEntry[],
    compose: ComposeBrain = composeBrain,
): Promise<string> {
    let identity = DEFAULT_DAEMON_IDENTITY
    try {
        // identity.md carries the name in YAML frontmatter (read by the registry → ctx.name) and the
        // personality in the body — use the body here; ctx.name supplies the "You are <name>" prefix.
        const { body } = parseFrontmatter(
            await readFile(ctx.identityFile, 'utf-8'),
        )
        const trimmed = body.trim()
        if (trimmed) identity = trimmed
    } catch {
        // no identity.md (or unreadable) → default
    }
    let prompt = `You are ${ctx.name}.\n\n${identity}`
    if (denyEntries.length > 0) {
        const list = denyEntries.map(e => `- ${e.rel}`).join('\n')
        prompt +=
            "\n\nThe following notes are marked off-limits by the vault's visibility settings — your Read/" +
            'Edit/Grep/Glob/Bash access to them is already blocked at the tool level, but treat them as if ' +
            "they don't exist: don't mention them, guess at their contents, or try alternate ways to reach " +
            `them if a tool call is denied.\n${list}`
    }
    // The brain block (profile, vault map, memory index) rides the same persona text, so Claude and
    // Codex both get it. A cold map build is
    // waited for up to DAEMON_BRAIN_WAIT_MS (core's default is 1 s); past that the map section is
    // omitted for this session. Failure-proof: a
    // throw or null leaves the persona exactly as it was.
    try {
        const brain = await compose({
            vaultDir: ctx.root,
            memoryDir: ctx.memoryDir,
            channel: 'daemon',
            waitMs: DAEMON_BRAIN_WAIT_MS,
        })
        if (brain) prompt += `\n\n${brain}`
    } catch (err) {
        console.error(`[persona:${ctx.name}] brain unavailable: ${err}`)
    }
    return prompt
}
