import { Show } from 'solid-js'
import Label from '../ui/Label'
import styles from './StatusBar.module.css'

// The status bar field-log line (design/ascii/README.md "App shell", §2), lifted out of App.tsx
// verbatim — pure presentation of signals App.tsx already owns: vault name, the focused pane's
// content, connection health (serverVersion's ConnectionState), and right-aligned mode indicators,
// closed by a blinking `_` caret. No new state; `onCopyVault` is the click-to-copy callback that
// stays in App.tsx because it pushes toasts, which a presentational component must not do.
//
// Classes below are reached through the imported `styles` object — bracket access, not
// `styles.statusBar`, since Vite only exposes camelCase aliases under css.modules.localsConvention,
// which app/vite.config.ts does not set. `.asc-caret` stays a bare global permanently (ui.css,
// alongside its `@keyframes asc-blink`), not chrome owned by this component. `.status-dot` (owned
// by ui/StatusDot.tsx, in ui/ui.css) is unrelated and never appears here despite the shared
// `status-` prefix.
export function StatusBar(props: {
    vaultName: string
    vaultPath: string
    path: string
    connected: boolean
    mode: string
    daemon: 'off' | 'idle' | 'working'
    onCopyVault: () => void
}) {
    return (
        <div class={styles['status-bar']}>
            <span
                class={styles['status-vault']}
                title={props.vaultPath || undefined}
                onClick={props.onCopyVault}
            >
                {props.vaultName || 'vault'}
            </span>
            <span class={styles['status-sep']}>//</span>
            <Label tone="muted">{props.path}</Label>
            {/* The one status in this bar that can cost the user work: while it is showing, edits
                are not reaching the backend. `role="status"` (an implicit polite live region) so a
                screen reader is told the moment it appears — it was previously conveyed by 10.5px
                of colour alone, in the smallest type in the app, which is exactly backwards for
                the highest-stakes message on screen. See StatusBar.module.css for the matching
                visual promotion. */}
            <Show when={!props.connected}>
                <span class={styles['status-conn']} role="status">
                    connection lost — polling
                </span>
            </Show>
            <div class={styles['status-spacer']} />
            <span class={styles['status-mode']}>{props.mode}</span>
            <span class={styles['status-daemon']}>daemon: {props.daemon}</span>
            <span class="asc-caret">_</span>
        </div>
    )
}
