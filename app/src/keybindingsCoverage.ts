// app/src/keybindingsCoverage.ts
// Compile-time-only: proves Settings['keybindings'] (settings.ts) exposes exactly the ids in
// KEYBINDING_CATALOG (core/src/keybindings.ts) — no more, no fewer.
//
// This lives in its own plain .ts module rather than inline in settings.parity.test.ts because
// app/tsconfig.json excludes `src/**/*.test.ts` from the type-checked program — app is the only
// workspace that does this (core/cli/mcp/relay/memory/daemon all `include` their test dirs). An
// assertion written directly inside a .test.ts file here would typecheck clean no matter what it
// said (verified: `bunx tsc --noEmit` stayed green even with the assertion deliberately made
// false), which is exactly the silent-failure class this guard exists to close. Putting the real
// check in a normal src file makes `bun run typecheck` actually evaluate it; the parity test just
// imports it so the intent stays documented next to the other settings-parity checks.
//
// NOTE: with Settings['keybindings'] declared as Record<KeybindingId, string>, this assertion is
// near-tautological — it now guards only against that declaration being loosened (e.g. to
// Record<string, string>). The id-set invariant itself is enforced at runtime by
// core/test/schema/settingsSchema.test.ts:190.
import type { Settings } from './settings'
import type { KeybindingId } from '../../core/src/keybindings'

type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

export const keybindingsCoverCatalog: AssertEqual<
    keyof Settings['keybindings'],
    KeybindingId
> = true
