// The typed `[-] [+] [x]` titlebar buttons, lifted out of App.tsx verbatim.
//
// THE FOUR RULES BEHIND THESE BUTTONS LIVE IN WindowControls.module.css, which hashes every class
// name — so each one is reached through `styles`, and a bare string literal here would compile,
// render, and match nothing. The close button carries two of those locals on one element, hence the
// template-literal concatenation rather than a space inside a single lookup. Bracket access is the
// repo standard: Vite exposes camelCase aliases only under css.modules.localsConvention, which
// app/vite.config.ts does not set.
//
// The `class` expressions below are build-time CONSTANTS, and must stay that way if a `classList` is
// ever added to these elements: Solid compiles a dynamic `class` into a guarded className write
// followed by a classList diff, so a reactive `class` would reset className and leave unchanged
// classList toggles unrestored. There are no conditional classes here today, so nothing is at risk
// yet — the constraint is recorded because the rest of the shell extraction hits elements that do
// carry both.
//
// WHAT DELIBERATELY STAYED IN App.tsx: the `<Show when={isTauri() && !IS_MAC_PLATFORM}>` gate and
// the three dynamic `@tauri-apps/api/window` calls behind these props. Those are platform
// integration, not chrome — and keeping them out here is what lets the component mount in Storybook
// with no Tauri runtime present. macOS runs a transparent Overlay titlebar with native traffic
// lights instead, so on that platform these buttons never render at all.
//
// These render as `PlainButton` (app/src/ui/PlainButton.tsx), not a bare `<button>` or `ui/Button`:
// PlainButton is a real `<button>` with its native chrome reset to nothing, so `.win-btn`/
// `.win-btn--close` below stay the only thing that paint it — `ui/Button`'s `.btn` family would add
// a border, padding and a size no toolbar-height titlebar control wants. shell/InboxIndicator.tsx
// uses the same primitive for the same reason.
import PlainButton from '../ui/PlainButton'
import styles from './WindowControls.module.css'

export function WindowControls(props: {
    onMinimize: () => void
    onToggleMaximize: () => void
    onClose: () => void
}) {
    return (
        <div class={styles['win-controls']}>
            <PlainButton
                class={styles['win-btn']}
                title="Minimize"
                onClick={props.onMinimize}
            >
                [-]
            </PlainButton>
            <PlainButton
                class={styles['win-btn']}
                title="Maximize"
                onClick={props.onToggleMaximize}
            >
                [+]
            </PlainButton>
            <PlainButton
                class={`${styles['win-btn']} ${styles['win-btn--close']}`}
                title="Close"
                onClick={props.onClose}
            >
                [x]
            </PlainButton>
        </div>
    )
}
