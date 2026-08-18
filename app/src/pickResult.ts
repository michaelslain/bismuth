// app/src/pickResult.ts
// Pure result type + classifier for native OS pickers (appWindow.ts's pickFolder/pickFile).
// Deliberately its own module, importing nothing from Solid or Tauri: appWindow.ts has a
// static `import { pushToast } from "./Toast"` for unrelated functions, and Toast.tsx is a real
// Solid component (JSX). Bun's JSX-runtime resolution is cwd-dependent (see
// docs/contributing/testing.md) and breaks under `bun test app/` run from the repo root — which
// is exactly how the pre-commit gate invokes it (scripts/gate.ts). Keeping this classifier in a
// module with zero `.tsx` imports means a plain unit test of it never has to load Toast.tsx at
// all, regardless of cwd.

/**
 * Outcome of a native picker. Deliberately three-valued: a *cancel* is normal and silent,
 * an *error* must be surfaced to the user. Collapsing the two into `null` is what made
 * "Open folder…" fail invisibly (github issue #6) — a packaged app has no visible console.
 */
export type PickResult =
    | { status: 'picked'; path: string }
    | { status: 'cancelled' }
    | { status: 'error'; message: string }

/**
 * Pure core of the picker's outcome decision, so the cancel-vs-error distinction is testable
 * without Tauri. `unavailable` means we are not under Tauri at all (browser) — callers there
 * fall back to their own flow, so it reads as a cancel, not an error.
 */
export function classifyPickResult(r: {
    value?: unknown
    thrown?: unknown
    unavailable?: boolean
}): PickResult {
    if (r.unavailable) return { status: 'cancelled' }
    if (r.thrown !== undefined) {
        const message =
            r.thrown instanceof Error ? r.thrown.message : String(r.thrown)
        return { status: 'error', message }
    }
    return typeof r.value === 'string'
        ? { status: 'picked', path: r.value }
        : { status: 'cancelled' }
}
