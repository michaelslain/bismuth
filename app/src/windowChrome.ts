// app/src/windowChrome.ts
// Pure so it's unit-testable without pulling in appWindow.ts's Toast.tsx import (JSX
// resolution fails under `bun test` — see pickResult.ts for the same split, same reason).
export function windowChromeOptions(
    isMac: boolean,
): { titleBarStyle: 'overlay'; hiddenTitle: true } | { decorations: false } {
    return isMac
        ? { titleBarStyle: 'overlay', hiddenTitle: true }
        : { decorations: false }
}
