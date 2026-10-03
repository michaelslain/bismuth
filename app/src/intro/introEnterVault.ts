// app/src/intro/introEnterVault.ts
// The intro's CTA, with every effect injected so each branch is testable: open the native folder
// picker, write the vault with the chosen theme, relaunch into it. The Rust command does the work
// and app.restart().
import type { ThemeName } from '../themes'
import { FIRST_RUN_POWERUPS_KEY, THEME_VARS_KEY } from '../storageKeys'
import { powerUpCommands } from './introSlides'
import { introThemeVars } from './introTheme'

export type EnterVaultChoice = { theme: ThemeName; icon: string; powerups: string[] }

export type EnterVaultDeps = {
    dev: boolean
    tauri: boolean
    invoke: (
        cmd: 'choose_first_vault',
        args: { theme: ThemeName; icon: string },
    ) => Promise<boolean>
    storage?: Pick<Storage, 'setItem'>
    navigate: (href: string) => void
    log: Pick<Console, 'error' | 'info'>
}

/** opened = the vault was chosen (dev navigates in, prod restarts); cancelled = the picker was
 *  dismissed, stay on the intro; failed = invoke threw; browser = no native picker here. */
export type EnterVaultResult = 'opened' | 'cancelled' | 'failed' | 'browser'

export async function enterVault(
    choice: EnterVaultChoice,
    deps: EnterVaultDeps,
): Promise<EnterVaultResult> {
    const { theme, icon, powerups } = choice
    const { dev, tauri, invoke, storage, navigate, log } = deps
    if (!tauri) {
        // Browser preview (?intro=1): no native picker / backend.
        log.info(
            '[intro] Enter your vault — native folder picker is available in the desktop app.',
        )
        return 'browser'
    }
    // Dev still opens the native picker to test it, but choose_first_vault skips app.restart() in
    // debug (it would kill the tauri-dev backend → white screen), so navigate into the app
    // ourselves. Nothing is persisted: the dev vault comes from BISMUTH_VAULT regardless.
    if (!dev) {
        // Persist the chosen power-ups (command-palette ids) for the post-restart app to run
        // against the real backend, and the theme vars for its first paint. Each write is
        // best-effort (private mode) and independent of the other.
        try {
            storage?.setItem(
                FIRST_RUN_POWERUPS_KEY,
                JSON.stringify(powerUpCommands(powerups)),
            )
        } catch {
            /* non-fatal */
        }
        try {
            storage?.setItem(
                THEME_VARS_KEY,
                JSON.stringify(introThemeVars(theme)),
            )
        } catch {
            /* non-fatal */
        }
    }
    try {
        const ok = await invoke('choose_first_vault', { theme, icon })
        if (!ok) return 'cancelled'
        if (dev) navigate('/')
        return 'opened'
    } catch (e) {
        log.error('enter vault failed', e)
        return 'failed'
    }
}
