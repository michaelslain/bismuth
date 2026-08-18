import { Show } from 'solid-js'

// The status bar field-log line (design/ascii/README.md "App shell", §2), lifted out of App.tsx
// verbatim — pure presentation of signals App.tsx already owns: vault name, the focused pane's
// content, connection health (serverVersion's ConnectionState), and right-aligned mode indicators,
// closed by a blinking `_` caret. No new state; `onCopyVault` is the click-to-copy callback that
// stays in App.tsx because it pushes toasts, which a presentational component must not do.
//
// CLASS NAMES ARE STILL BARE GLOBAL STRING LITERALS — this is the extraction half of the migration
// only. `.asc-caret` stays a bare global permanently (ui.css, alongside its `@keyframes
// asc-blink`), not chrome owned by this component. `.status-dot` (owned by ui/StatusDot.tsx, in
// ui/ui.css) is unrelated and never appears here despite the shared `status-` prefix.
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
        <div class="status-bar">
            <span
                class="status-vault"
                title={props.vaultPath || undefined}
                onClick={props.onCopyVault}
            >
                {props.vaultName || 'vault'}
            </span>
            <span class="status-sep">//</span>
            <span class="status-path">{props.path}</span>
            <Show when={!props.connected}>
                <span class="status-conn">connection lost — polling</span>
            </Show>
            <div class="status-spacer" />
            <span class="status-mode">{props.mode}</span>
            <span class="status-daemon">daemon: {props.daemon}</span>
            <span class="asc-caret">_</span>
        </div>
    )
}
