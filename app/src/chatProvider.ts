// app/src/chatProvider.ts
// Pure provider-choice helpers for the visual chat (chat/chatSession.ts), split out like
// chatModelResolution.ts / chatEffort.ts so the rules are unit-testable without Solid/DOM.
//
// Each chat TAB picks its backend in the header, persisted per tab (a transient localStorage key,
// like the per-chat model) with the vault's `chat.provider` setting as the default for tabs that
// never chose. Everything about WHICH backends exist and WHAT each one can do comes from the shared
// catalog (core/src/agentBackends/catalog.ts) — the same source the server's router and the
// `.settings` schema read — so adding a backend never means editing this file.
//
// The MODEL persistence is backend-scoped: a Claude model id ("claude-sonnet-4-5") must never seed
// an opencode session's `-m` flag (opencode ids are `provider/model`), so each backend keeps its own
// per-chat + global keys.
import {
    BACKEND_LIST,
    DEFAULT_BACKEND,
    backendOf,
    isBackendId,
    resolveAutoProvider,
    resolveBackendId,
    type BackendCapabilities,
    type BackendId,
} from '../../core/src/agentBackends/catalog'

/** The id of the backend a chat runs on. Alias of the shared BackendId so the two can't drift. */
export type ChatProviderChoice = BackendId

/**
 * The header Select's options — every backend this build can drive, in catalog order, minus the
 * ones the catalog marks `hidden`.
 *
 * Hidden backends are still fully selectable by id (a hand-edited `.settings`, or a per-tab key that
 * already names one); they are only kept out of the list. Today that means the two ACP adapter
 * entries whose underlying agent has a native driver: offering "Claude Code (ACP)" as a peer of
 * "Claude Code" is a trap, since it is strictly worse — a third-party bridge fetched by npx with
 * fewer capabilities — while reading in a list as though it were newer.
 */
export const CHAT_PROVIDER_OPTIONS: {
    value: ChatProviderChoice
    label: string
}[] = BACKEND_LIST.filter(b => !b.hidden).map(b => ({
    value: b.id,
    label: b.label,
}))

/** Coerce a persisted / settings value to a known backend, else the fallback (default claude) —
 *  a stale or future value can never leave the header showing something this build can't run. */
export function sanitizeChatProvider(
    raw: unknown,
    fallback: ChatProviderChoice = 'claude',
): ChatProviderChoice {
    return resolveBackendId(raw, fallback)
}

/** What the agent-availability read knows: the installed backend ids, `null` while the read is
 *  still in flight, or `'failed'` when it can't answer (mobile has no such route, or a transient
 *  network error). */
export type InstalledBackends = readonly string[] | null | 'failed'

/** The provider a chat runs on, and how it was reached. `auto` = neither the tab nor the vault named
 *  a backend, so the first INSTALLED one was picked; `pending` = auto, but availability isn't known
 *  yet (the session must not spawn); `none` = auto and nothing is installed (show the setup screen,
 *  never spawn). While pending or none, `provider` is the default backend as a placeholder. */
export type ChatProviderResolution = {
    provider: ChatProviderChoice
    auto: boolean
    pending: boolean
    none: boolean
}

/**
 * Pure: which backend a chat runs on. A per-tab explicit `choice` wins, then a vault `setting` that
 * names a backend; anything else (`auto`, absent, garbage) is auto — the first installed backend in
 * the catalog's AUTO_ORDER. A failed availability read falls back to the default backend (the old
 * behaviour) rather than waiting forever.
 */
export function resolveChatProvider(
    choice: string | null,
    setting: unknown,
    installed: InstalledBackends,
): ChatProviderResolution {
    const explicit = isBackendId(choice)
        ? choice
        : isBackendId(setting)
          ? setting
          : null
    if (explicit)
        return { provider: explicit, auto: false, pending: false, none: false }
    if (installed === null)
        return {
            provider: DEFAULT_BACKEND,
            auto: true,
            pending: true,
            none: false,
        }
    if (installed === 'failed')
        return {
            provider: DEFAULT_BACKEND,
            auto: true,
            pending: false,
            none: false,
        }
    const picked = resolveAutoProvider(installed)
    return {
        provider: picked ?? DEFAULT_BACKEND,
        auto: true,
        pending: false,
        none: picked === null,
    }
}

/** The per-tab localStorage key holding this chat's explicit provider choice. */
export function providerStorageKey(chatId: string): string {
    return `bismuth.chat.provider.${chatId}`
}

/**
 * The localStorage namespace suffix for a backend's model keys.
 *
 * Claude is "" — it keeps the ORIGINAL unsuffixed keys so every existing user's persisted model
 * choices survive unchanged — and opencode is the historical "oc". Anything else defaults to its
 * backend id, so a new backend gets a private namespace for free. These strings are persisted user
 * state: never change an existing one.
 */
const MODEL_KEY_NAMESPACE: Partial<Record<BackendId, string>> = {
    claude: '',
    opencode: 'oc',
}

/** Backend-scoped model persistence keys, so two backends' model ids can never cross-contaminate
 *  a session spawn. */
export function modelStorageKeys(
    provider: ChatProviderChoice,
    chatId: string,
): { perChat: string; global: string } {
    const ns = MODEL_KEY_NAMESPACE[provider] ?? provider
    return ns
        ? {
              perChat: `bismuth.chat.model.${ns}.${chatId}`,
              global: `bismuth.chat.lastModel.${ns}`,
          }
        : {
              perChat: `bismuth.chat.model.${chatId}`,
              global: 'bismuth.chat.lastModel',
          }
}

/**
 * Whether a backend supports a given capability — the generic replacement for the old
 * `providerSupportsClaudeControls(provider) => provider === "claude"`.
 *
 * That check gave EVERY non-Claude backend Claude's exact degradation profile (hide permission
 * modes, effort, --chrome, and the history picker) whether or not it was true, so a backend with
 * real approval modes or thinking levels would have had them hidden for no reason. Each header
 * control now asks for the capability it actually needs:
 *   - permission-mode picker + set_permission_mode/set_effort push → "permissionModes" / "effort"
 *   - the --chrome toggle and its /chrome slash command             → "computerUse"
 *   - the cross-session history picker                              → "sessionPicker"
 */
export function providerCan<K extends keyof BackendCapabilities>(
    provider: ChatProviderChoice,
    cap: K,
): BackendCapabilities[K] {
    return backendOf(provider).capabilities[cap]
}

/** A backend's display label (header, setup screen, toasts). */
export function providerLabel(provider: ChatProviderChoice): string {
    return backendOf(provider).label
}

/** What to tell the user when a backend's binary isn't installed (the chat setup screen). */
export function providerInstallHint(provider: ChatProviderChoice): string {
    return backendOf(provider).installHint
}

/** The model picker row's price badge (card #90: "show which one free and which one isnt").
 *  Tri-state: opencode models carry `free` off their cost metadata (`opencode models --verbose`);
 *  Claude models (and an opencode list fetched without metadata) carry none → no badge. */
export function modelPriceBadge(free: boolean | undefined): string | undefined {
    if (free === undefined) return undefined
    return free ? 'Free' : 'Paid'
}

/** The shell command the provider manager tells the user to run (and copies) — opencode's own
 *  interactive login wizard (providers, API keys, opencode Zen). Kept in one place so the popover
 *  text, the copy button, and the tests can never drift apart. */
export const OPENCODE_LOGIN_COMMAND = 'opencode auth login'
