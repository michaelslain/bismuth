// app/src/chatProvider.ts
// Pure provider-choice helpers for the visual chat (ChatView.tsx), split out like
// chatModelResolution.ts / chatEffort.ts so the rules are unit-testable without Solid/DOM.
//
// Each chat TAB picks its provider (Claude Code or opencode) in the header, persisted per tab
// (a transient localStorage key, like the per-chat model) with the vault's `chat.provider`
// setting as the default for tabs that never chose. The MODEL persistence is provider-scoped:
// a Claude model id ("claude-sonnet-4-5") must never seed an opencode session's `-m` flag
// (opencode ids are `provider/model`), so each provider keeps its own per-chat + global keys.

export type ChatProviderChoice = "claude" | "opencode";

/** The header Select's options — the two providers this build can drive. */
export const CHAT_PROVIDER_OPTIONS: { value: ChatProviderChoice; label: string }[] = [
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "opencode" },
];

/** Coerce a persisted / settings value to a known provider, else the fallback (default claude) —
 *  a stale or future value can never leave the header showing something this build can't run. */
export function sanitizeChatProvider(raw: unknown, fallback: ChatProviderChoice = "claude"): ChatProviderChoice {
  return raw === "claude" || raw === "opencode" ? raw : fallback;
}

/** The per-tab localStorage key holding this chat's explicit provider choice. */
export function providerStorageKey(chatId: string): string {
  return `bismuth.chat.provider.${chatId}`;
}

/**
 * Provider-scoped model persistence keys. Claude keeps the ORIGINAL (unsuffixed) keys so every
 * existing user's persisted model choices survive this feature unchanged; opencode gets its own
 * namespace so the two providers' model ids never cross-contaminate a session spawn.
 */
export function modelStorageKeys(provider: ChatProviderChoice, chatId: string): { perChat: string; global: string } {
  return provider === "opencode"
    ? { perChat: `bismuth.chat.model.oc.${chatId}`, global: "bismuth.chat.lastModel.oc" }
    : { perChat: `bismuth.chat.model.${chatId}`, global: "bismuth.chat.lastModel" };
}

/** Whether a Claude-specific header control (permission mode, effort, --chrome, the Claude session
 *  history picker) should render for this provider. opencode sessions hide them — `opencode run`
 *  has no permission modes / effort levels to drive them. (opencode's own surfaces — its command
 *  registry in the manifest and the auth pill — are additive, not gated here.) */
export function providerSupportsClaudeControls(provider: ChatProviderChoice): boolean {
  return provider === "claude";
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
