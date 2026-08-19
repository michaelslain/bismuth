import { tempDir } from '../helpers'
import { test, expect, describe } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    resolveVisibilityGate,
    enforcesFor,
} from '../../src/agentBackends/visibilityGate'
import { BACKENDS } from '../../src/agentBackends/catalog'

// The chokepoint that decides whether a backend may serve a channel for a vault.
//
// It exists because the per-backend drivers were written independently and NONE of codex, cline,
// gemini, goose, openclaw or the two ACP adapters checked visibility at all — the refusal frame was
// built and the docs claimed "refused", while those backends would actually have run UNGATED. Seven
// drivers cannot be kept honest by review; one chokepoint can.

function vaultWithHidden(): string {
    const root = tempDir('vis-gate-')
    mkdirSync(join(root, 'Private'), { recursive: true })
    writeFileSync(
        join(root, 'Private', 'secret.md'),
        '---\nvisibility: hidden\n---\nSENTINEL-9\n',
    )
    return root
}

function vaultWithChatOnly(): string {
    const root = tempDir('vis-gate-co-')
    writeFileSync(
        join(root, 'notes.md'),
        '---\nvisibility: chat-only\n---\nSENTINEL-CO\n',
    )
    return root
}

function openVault(): string {
    const root = tempDir('vis-gate-open-')
    writeFileSync(join(root, 'a.md'), 'ordinary\n')
    return root
}

describe('resolveVisibilityGate', () => {
    test('an unrestricted vault allows every backend — the gate must not tax vaults that hide nothing', async () => {
        const root = openVault()
        for (const id of Object.keys(BACKENDS)) {
            const v = await resolveVisibilityGate(id, 'chat', root)
            expect(v.allowed).toBe(true)
        }
    })

    test('claude is allowed for a restricted vault — it enforces natively', async () => {
        expect(
            (await resolveVisibilityGate('claude', 'chat', vaultWithHidden()))
                .allowed,
        ).toBe(true)
    })

    test('a backend that cannot enforce is REFUSED for a restricted vault', async () => {
        const v = await resolveVisibilityGate(
            'cline',
            'chat',
            vaultWithHidden(),
        )
        expect(v.allowed).toBe(false)
        if (!v.allowed) {
            expect(v.restrictedCount).toBe(1)
            expect(v.message).toContain('Cline')
            // Never name the hidden path — saying it out loud defeats the whole point of hiding it.
            expect(v.message).not.toContain('secret.md')
            expect(v.message).not.toContain('Private')
            // A refusal must never be a dead end: both ways out are stated.
            expect(v.message).toContain('Claude Code')
            expect(v.message.toLowerCase()).toContain('unhide')
        }
    })

    test('every non-enforcing backend is refused — none of the seven may start ungated', async () => {
        const root = vaultWithHidden()
        for (const id of [
            'codex',
            'cline',
            'gemini',
            'goose',
            'openclaw',
            'claude-code-acp',
            'codex-acp',
        ]) {
            const v = await resolveVisibilityGate(id, 'chat', root)
            expect(v.allowed).toBe(false)
        }
    })

    // opencode was downgraded from "wrapper-macos" to "none" (docs/vault/visibility-acceptance.md's
    // third dated section: two of three live probes never completed). Nothing above exercises
    // opencode specifically, so a silent revert of that downgrade would still pass every other test
    // here — this pins the catalog value itself against that regression.
    test('opencode is refused for chat — the wrapper-macos downgrade is pinned, not just documented', async () => {
        expect(BACKENDS.opencode.capabilities.visibilityGate).toEqual({
            chat: 'none',
            daemon: 'none',
        })
        const v = await resolveVisibilityGate(
            'opencode',
            'chat',
            vaultWithHidden(),
        )
        expect(v.allowed).toBe(false)
    })

    test('an unknown backend id REFUSES rather than failing open', async () => {
        // backendOf() deliberately degrades an unknown id to the default backend (claude), which would
        // hand a typo'd or future id claude's "enforced" answer. The gate must guard the id first.
        const v = await resolveVisibilityGate(
            'not-a-backend',
            'chat',
            vaultWithHidden(),
        )
        expect(v.allowed).toBe(false)
    })

    test('an unreadable vault REFUSES — a gate that opens when it malfunctions is not a gate', async () => {
        const v = await resolveVisibilityGate('claude', 'chat', '\0not-a-path')
        expect(v.allowed).toBe(false)
    })

    test('chat-only restricts the DAEMON channel but not chat', async () => {
        // The middle tier's whole purpose: chat may read it, the daemon may not. A gate that collapsed
        // the two channels would either leak to the daemon or needlessly refuse chat.
        const root = vaultWithChatOnly()
        expect(
            (await resolveVisibilityGate('openclaw', 'chat', root)).allowed,
        ).toBe(true)
        expect(
            (await resolveVisibilityGate('openclaw', 'daemon', root)).allowed,
        ).toBe(false)
    })
})

describe('enforcesFor', () => {
    test('reads the per-channel capability, not a single boolean', () => {
        // opencode is the case a boolean could not express: a per-turn subprocess can be sandbox-wrapped
        // for chat, but the daemon's process model cannot be.
        expect(enforcesFor(BACKENDS.claude, 'chat')).toBe(true)
        expect(enforcesFor(BACKENDS.claude, 'daemon')).toBe(true)
        expect(enforcesFor(BACKENDS.cline, 'chat')).toBe(false)
        expect(enforcesFor(BACKENDS.cline, 'daemon')).toBe(false)
    })
})
