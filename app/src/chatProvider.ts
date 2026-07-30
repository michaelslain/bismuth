// app/src/chatProvider.ts
// Pure provider-choice helpers for the visual chat (ChatView.tsx), split out like
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
  backendOf,
  resolveBackendId,
  type BackendCapabilities,
  type BackendId,
} from "../../core/src/agentBackends/catalog";

/** The id of the backend a chat runs on. Alias of the shared BackendId so the two can't drift. */
export type ChatProviderChoice = BackendId;

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
export const CHAT_PROVIDER_OPTIONS: { value: ChatProviderChoice; label: string }[] = BACKEND_LIST.filter(
  (b) => !b.hidden,
).map((b) => ({ value: b.id, label: b.label }));

/** Coerce a persisted / settings value to a known backend, else the fallback (default claude) —
 *  a stale or future value can never leave the header showing something this build can't run. */
export function sanitizeChatProvider(raw: unknown, fallback: ChatProviderChoice = "claude"): ChatProviderChoice {
  return resolveBackendId(raw, fallback);
}

/** The per-tab localStorage key holding this chat's explicit provider choice. */
export function providerStorageKey(chatId: string): string {
  return `bismuth.chat.provider.${chatId}`;
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
  claude: "",
  opencode: "oc",
};

/** Backend-scoped model persistence keys, so two backends' model ids can never cross-contaminate
 *  a session spawn. */
export function modelStorageKeys(provider: ChatProviderChoice, chatId: string): { perChat: string; global: string } {
  const ns = MODEL_KEY_NAMESPACE[provider] ?? provider;
  return ns
    ? { perChat: `bismuth.chat.model.${ns}.${chatId}`, global: `bismuth.chat.lastModel.${ns}` }
    : { perChat: `bismuth.chat.model.${chatId}`, global: "bismuth.chat.lastModel" };
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
  return backendOf(provider).capabilities[cap];
}

/** A backend's display label (header, setup screen, toasts). */
export function providerLabel(provider: ChatProviderChoice): string {
  return backendOf(provider).label;
}

/** What to tell the user when a backend's binary isn't installed (the chat setup screen). */
export function providerInstallHint(provider: ChatProviderChoice): string {
  return backendOf(provider).installHint;
}

/** The backend's own interactive login command, when it has one worth surfacing. */
export function providerLoginCommand(provider: ChatProviderChoice): string | undefined {
  return backendOf(provider).loginCommand;
}

/** The model picker row's price badge (card #90: "show which one free and which one isnt").
 *  Tri-state: opencode models carry `free` off their cost metadata (`opencode models --verbose`);
 *  Claude models (and an opencode list fetched without metadata) carry none → no badge. */
export function modelPriceBadge(free: boolean | undefined): string | undefined {
  if (free === undefined) return undefined;
  return free ? "Free" : "Paid";
}

/** The header auth pill's state (RE-FIX #90: "i dont see a way to do auth"), off the `auth` frame
 *  (`opencode auth list`). Tri-state input: null = the frame hasn't landed (unknown — show a
 *  neutral label, never a false "not signed in" flash), [] = no stored credentials, else the
 *  count. Pure so the wording is unit-testable. */
export function opencodeAuthSummary(providers: { name: string }[] | null): { label: string; signedIn: boolean | null } {
  if (providers === null) return { label: "Auth", signedIn: null };
  if (!providers.length) return { label: "Not signed in", signedIn: false };
  return { label: providers.length === 1 ? "1 provider" : `${providers.length} providers`, signedIn: true };
}

/** The shell command the auth popover tells the user to run (and copies) — opencode's own
 *  interactive login wizard (providers, API keys, opencode Zen). Kept in one place so the popover
 *  text, the copy button, and the tests can never drift apart. */
export const OPENCODE_LOGIN_COMMAND = "opencode auth login";
