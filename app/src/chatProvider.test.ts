import { describe, expect, test } from 'bun:test'
import {
    CHAT_PROVIDER_OPTIONS,
    modelPriceBadge,
    modelStorageKeys,
    opencodeAuthSummary,
    OPENCODE_LOGIN_COMMAND,
    providerCan,
    providerInstallHint,
    providerLabel,
    providerStorageKey,
    sanitizeChatProvider,
} from './chatProvider'

describe('sanitizeChatProvider', () => {
    test('passes known providers through', () => {
        expect(sanitizeChatProvider('claude')).toBe('claude')
        expect(sanitizeChatProvider('opencode')).toBe('opencode')
    })
    test('coerces garbage / stale / future values to the fallback', () => {
        expect(sanitizeChatProvider(null)).toBe('claude')
        expect(sanitizeChatProvider('gpt-cli')).toBe('claude')
        expect(sanitizeChatProvider(undefined, 'opencode')).toBe('opencode')
        expect(sanitizeChatProvider(42, 'opencode')).toBe('opencode')
    })
})

describe('model persistence keys', () => {
    test("claude keeps the ORIGINAL keys (existing users' choices survive)", () => {
        expect(modelStorageKeys('claude', 'tab1')).toEqual({
            perChat: 'bismuth.chat.model.tab1',
            global: 'bismuth.chat.lastModel',
        })
    })
    test('opencode gets its own namespace (no cross-provider model contamination)', () => {
        const keys = modelStorageKeys('opencode', 'tab1')
        expect(keys.perChat).toBe('bismuth.chat.model.oc.tab1')
        expect(keys.global).toBe('bismuth.chat.lastModel.oc')
        expect(keys.perChat).not.toBe(
            modelStorageKeys('claude', 'tab1').perChat,
        )
    })
})

describe('header gating + options', () => {
    // Each header control asks for the capability it actually needs, so the degradation profile is
    // per-capability data (core/src/agentBackends/catalog.ts) rather than a `provider === "claude"`
    // check that would give every future backend Claude's exact profile whether or not it applied.
    test('Claude declares the interactive capabilities its header controls need', () => {
        expect(providerCan('claude', 'permissionModes')).toBe(true)
        expect(providerCan('claude', 'computerUse')).toBe(true)
        expect(providerCan('claude', 'sessionPicker')).toBe(true)
        expect(providerCan('claude', 'effort')).toBe(true)
    })
    test('opencode hides exactly the controls neither server nor run mode can drive', () => {
        // permissionModes/computerUse/sessionPicker/effort stay hidden either way (no drivable mode
        // switch, no --chrome equivalent, no cross-session list, no effort levels reported). images
        // flipped to true once server mode's real FilePartInput attachment path was verified live —
        // see catalog.ts's OPENCODE descriptor.
        expect(providerCan('opencode', 'permissionModes')).toBe(false)
        expect(providerCan('opencode', 'computerUse')).toBe(false)
        expect(providerCan('opencode', 'sessionPicker')).toBe(false)
        expect(providerCan('opencode', 'effort')).toBe(false)
        expect(providerCan('opencode', 'images')).toBe(true)
    })
    test('resume and sessionPicker are distinct: opencode resumes per tab with no cross-session list', () => {
        expect(providerCan('opencode', 'resume')).toBe(true)
        expect(providerCan('opencode', 'historyReplay')).toBe(true)
        expect(providerCan('opencode', 'sessionPicker')).toBe(false)
    })
    test('permission PROMPTS and permission MODES are separate capabilities', () => {
        // These were one flag. An ACP backend can park a session/request_permission as a live
        // `permission` frame but has no mode picker, so the single flag rendered a picker whose
        // selections silently went nowhere — a capability claiming something the backend cannot do.
        // Claude has both. opencode's server mode raises a real `permission` ask/respond cycle
        // (verified live for both allow and deny) but still has no MODE-switch equivalent, so it now
        // matches ACP's split exactly: prompts true, modes false.
        expect(providerCan('claude', 'permissionPrompts')).toBe(true)
        expect(providerCan('claude', 'permissionModes')).toBe(true)
        expect(providerCan('opencode', 'permissionPrompts')).toBe(true)
        expect(providerCan('opencode', 'permissionModes')).toBe(false)
        expect(providerCan('cline', 'permissionPrompts')).toBe(true)
        expect(providerCan('cline', 'permissionModes')).toBe(false)
    })
    test("an unknown backend id degrades to the default's capabilities instead of throwing", () => {
        expect(providerCan('gpt-cli' as never, 'permissionModes')).toBe(true)
    })
    test('every known backend is offered, claude first (the default)', () => {
        // Grew from ["claude","opencode"] once the ACP agents (chatProviders/acp/) landed, then grew
        // again with the native "codex" backend (chatProviders/codex/) — core/src/agentBackends/
        // catalog.ts BACKEND_IDS is the single source of truth this list mirrors.
        expect(CHAT_PROVIDER_OPTIONS.map(o => o.value)).toEqual([
            'claude',
            'opencode',
            'codex',
            'cline',
            'gemini',
            'goose',
            'openclaw',
        ])
        expect(CHAT_PROVIDER_OPTIONS[0]?.label).toBe('Claude Code')
    })
    test('the ACP adapters are hidden from the picker but still selectable by id', () => {
        // "Claude Code (ACP)" beside "Claude Code" is a trap: strictly worse (a third-party bridge
        // fetched by npx, fewer capabilities) while reading as though it were newer. Same for
        // "Codex (ACP)" now that a native codex driver exists. They stay resolvable so a hand-edited
        // .settings or an existing per-tab key keeps working.
        const offered = CHAT_PROVIDER_OPTIONS.map(o => o.value)
        expect(offered).not.toContain('claude-code-acp')
        expect(offered).not.toContain('codex-acp')
        expect(sanitizeChatProvider('claude-code-acp')).toBe('claude-code-acp')
        expect(sanitizeChatProvider('codex-acp')).toBe('codex-acp')
    })
    test('native codex is offered, and it is NOT the ACP bridge', () => {
        expect(
            CHAT_PROVIDER_OPTIONS.find(o => o.value === 'codex')?.label,
        ).toBe('OpenAI Codex')
    })
    test('labels + install hints come from the catalog', () => {
        expect(providerLabel('opencode')).toBe('opencode')
        expect(providerInstallHint('opencode')).toContain('opencode.ai')
        expect(providerInstallHint('claude')).toContain('claude')
    })
    test('provider key is per-tab', () => {
        expect(providerStorageKey('a')).not.toBe(providerStorageKey('b'))
    })
})

describe('modelPriceBadge', () => {
    test('free/paid off cost metadata; NO badge when the provider reported none (Claude models)', () => {
        expect(modelPriceBadge(true)).toBe('Free')
        expect(modelPriceBadge(false)).toBe('Paid')
        expect(modelPriceBadge(undefined)).toBeUndefined()
    })
})

describe('opencodeAuthSummary (RE-FIX #90)', () => {
    test("null (frame not landed) is unknown — a neutral label, never a false 'not signed in'", () => {
        expect(opencodeAuthSummary(null)).toEqual({
            label: 'Auth',
            signedIn: null,
        })
    })
    test('no stored credentials reads as not signed in', () => {
        expect(opencodeAuthSummary([])).toEqual({
            label: 'Not signed in',
            signedIn: false,
        })
    })
    test('counts providers, singular/plural', () => {
        expect(opencodeAuthSummary([{ name: 'OpenCode Zen' }])).toEqual({
            label: '1 provider',
            signedIn: true,
        })
        expect(
            opencodeAuthSummary([
                { name: 'OpenCode Zen' },
                { name: 'Moonshot AI' },
            ]),
        ).toEqual({ label: '2 providers', signedIn: true })
    })
    test("the popover's login command is opencode's own auth wizard", () => {
        expect(OPENCODE_LOGIN_COMMAND).toBe('opencode auth login')
    })
})
