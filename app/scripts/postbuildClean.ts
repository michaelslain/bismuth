// app/scripts/postbuildClean.ts
//
// `tauri build` leaves TWO installable Bismuths on disk: the staged bundle at
// bundle/macos/Bismuth.app and the bundle/dmg/*.dmg built from it. macOS indexes both,
// so anyone who builds from source sees Bismuth twice in Spotlight and the Applications
// list (github issue #4). The staged .app has no purpose once the dmg exists — the dmg IS
// the install vehicle — so we delete it after bundling.
//
// Pure, so the rule is unit-testable without running a release build.

export interface StagedAppQuery {
    /** Did the bundler produce a .dmg? If not, the staged .app is the only installable output. */
    dmgExists: boolean
    /** Absolute path to bundle/macos/Bismuth.app. */
    appPath: string
    /** Does that path exist on disk? */
    appExists: boolean
}

/** The staged .app to delete, or null when deleting it would leave nothing installable. */
export function stagedAppToRemove(q: StagedAppQuery): string | null {
    if (!q.appExists) return null
    if (!q.dmgExists) return null
    return q.appPath
}
