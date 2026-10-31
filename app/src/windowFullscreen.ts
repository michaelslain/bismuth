// app/src/windowFullscreen.ts
// Tracks whether the native window is fullscreen. macOS hides the traffic lights in native
// fullscreen, so the top strip's traffic-light gutter (Band `inset="traffic-lights"`) would leave
// the wordmark floating 78px in from an empty corner; App.tsx feeds this into <TopStrip fullscreen>.
// Entering and leaving fullscreen both resize the window, so every resize re-reads the state.
// Pure (the window is passed in) so it is unit-testable without Tauri.

export type FullscreenWindow = {
    isFullscreen(): Promise<boolean>
    onResized(handler: () => void): Promise<() => void>
}

/** Calls `set` with the current state now and after every resize; resolves to the unlisten. */
export async function trackFullscreen(
    win: FullscreenWindow,
    set: (fullscreen: boolean) => void,
): Promise<() => void> {
    const read = () =>
        win.isFullscreen().then(set, e => console.error('isFullscreen failed', e))
    const unlisten = await win.onResized(() => void read())
    await read()
    return unlisten
}
