// app/src/intro/introEnterVault.ts
// The intro's CTA, with every effect injected so each branch is testable: open the native folder
// picker, write the vault with the chosen theme, relaunch into it. The Rust command does the work
// and app.restart().
import type { ThemeName } from '../themes'
import {
    FIRST_RUN_AGENT_KEY,
    FIRST_RUN_CONVERT_KEY,
    FIRST_RUN_DAEMON_NAME_KEY,
    FIRST_RUN_POWERUPS_KEY,
    THEME_VARS_KEY,
} from '../storageKeys'
import {
    DEFAULT_DAEMON_NAME,
    convertedVaultPath,
    daemonName,
    powerUpCommands,
} from './introSlides'
import { introThemeVars } from './introTheme'

export type EnterVaultChoice = {
    theme: ThemeName
    icon: string
    powerups: string[]
    /** 'free-agent' or an installed backend id. */
    agent: string
    /** Typed on the name slide; kept only when the daemon power-up is on. */
    daemonName?: string
    /** The Obsidian vault picked on the obsidian slide; kept only when the cli + mcp power-up is
     *  on. Set, the CTA opens `<source>-bismuth` instead of the folder picker. */
    obsidianSource?: string
}

/** What the post-restart chat converts: the picked Obsidian vault into the vault that opened. */
export type ConvertJob = { source: string; target: string }

/** The conversion this choice asks for, or null: a non-blank source with cli + mcp on. */
export function convertJob(choice: EnterVaultChoice): ConvertJob | null {
    if (!choice.powerups.includes('cli')) return null
    const target = convertedVaultPath(choice.obsidianSource ?? '')
    if (!target) return null
    return { source: choice.obsidianSource!.trim().replace(/[\\/]+$/, ''), target }
}

/** `from obsidian` is picked (with cli + mcp on) but no vault to convert is set yet: the CTA waits
 *  for one instead of falling back to the folder picker, which would ask for a second folder. */
export const convertSourceMissing = (
    powerups: string[],
    start: 'new' | 'obsidian',
    source: string,
): boolean => powerups.includes('cli') && start === 'obsidian' && !source.trim()

export type EnterVaultDeps = {
    dev: boolean
    tauri: boolean
    invoke: (
        cmd: 'choose_first_vault',
        args: {
            theme: ThemeName
            icon: string
            /** The hand-off below as a JSON object, written to disk by Rust before the relaunch. */
            handoff?: string
            /** The Obsidian vault to convert; Rust resolves it and opens `<source>-bismuth`. */
            convertFrom?: string
        },
    ) => Promise<boolean>
    storage?: Pick<Storage, 'setItem' | 'removeItem'>
    navigate: (href: string) => void
    log: Pick<Console, 'error' | 'info'>
    /** Why entering failed, in words the intro can show (Rust's refusal of a bad source path). */
    onError?: (message: string) => void
}

/** opened = the vault was chosen (dev navigates in, prod restarts); cancelled = the picker was
 *  dismissed, stay on the intro; failed = invoke threw; browser = no native picker here. */
export type EnterVaultResult = 'opened' | 'cancelled' | 'failed' | 'browser'

export async function enterVault(
    choice: EnterVaultChoice,
    deps: EnterVaultDeps,
): Promise<EnterVaultResult> {
    const { theme, icon, powerups, agent } = choice
    const { dev, tauri, invoke, storage, navigate, log } = deps
    const job = convertJob(choice)
    if (!tauri) {
        // Browser preview (?intro=1): no native picker / backend.
        log.info(
            '[intro] Enter your vault — native folder picker is available in the desktop app.',
        )
        return 'browser'
    }
    // Dev still opens the native picker to test it, but choose_first_vault skips app.restart() in
    // debug (it would kill the tauri-dev backend → white screen), so navigate into the app
    // ourselves. Nothing is persisted and nothing converts: the dev vault comes from BISMUTH_VAULT,
    // so a conversion target would never be the vault that opens.
    if (dev) {
        if (job) log.info('[intro] dev build: the Obsidian conversion runs in release only.')
        return choose(invoke, { theme, icon }, deps, navigate)
    }
    // The first launch after the relaunch reads these (firstRunHandoff.ts): the chosen agent and
    // power-ups (command-palette ids), the daemon name, and the theme vars for its first paint.
    // The name slide only shows with the daemon power-up on, so a name orphaned by clearing it is
    // dropped. The conversion job is not here: Rust resolves the source and adds it.
    const handoff: Record<string, string> = {
        [FIRST_RUN_POWERUPS_KEY]: JSON.stringify(powerUpCommands(powerups)),
        [FIRST_RUN_AGENT_KEY]: agent,
        [THEME_VARS_KEY]: JSON.stringify(introThemeVars(theme)),
    }
    const name = daemonName(choice.daemonName ?? '')
    if (powerups.includes('daemon') && name !== DEFAULT_DAEMON_NAME)
        handoff[FIRST_RUN_DAEMON_NAME_KEY] = name
    // localStorage too, for the theme's first paint; it reaches disk lazily, so the copy Rust
    // writes is the one the hand-off relies on. A key from an earlier, abandoned attempt is cleared
    // so it cannot ride along.
    // Each write is best-effort (private mode) and independent of the others; the Rust copy still
    // carries the hand-off.
    const attempt = (write: () => void) => {
        try {
            write()
        } catch {
            /* non-fatal */
        }
    }
    attempt(() => storage?.removeItem(FIRST_RUN_DAEMON_NAME_KEY))
    attempt(() => storage?.removeItem(FIRST_RUN_CONVERT_KEY))
    for (const [k, v] of Object.entries(handoff))
        attempt(() => storage?.setItem(k, v))
    return choose(
        invoke,
        {
            theme,
            icon,
            handoff: JSON.stringify(handoff),
            ...(job ? { convertFrom: job.source } : {}),
        },
        deps,
        navigate,
    )
}

async function choose(
    invoke: EnterVaultDeps['invoke'],
    args: Parameters<EnterVaultDeps['invoke']>[1],
    deps: EnterVaultDeps,
    navigate: (href: string) => void,
): Promise<EnterVaultResult> {
    try {
        const ok = await invoke('choose_first_vault', args)
        if (!ok) return 'cancelled'
        if (deps.dev) navigate('/')
        return 'opened'
    } catch (e) {
        deps.log.error('enter vault failed', e)
        deps.onError?.(typeof e === 'string' ? e : (e as Error).message)
        return 'failed'
    }
}
