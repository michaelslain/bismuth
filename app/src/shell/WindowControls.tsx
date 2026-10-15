// The typed `[-] [+] [x]` titlebar buttons: TextButton `-` / `+` and the shared CloseButton, so they
// draw the button family's brackets and spacing. They are real <button>s inside the drag-region top
// strip; Tauri's drag script never treats a <button> as a drag target, so pressing one does not start
// a window drag (shell/TopStrip.tsx). Each carries an aria-label: the visible text is only the glyph.
//
// WHAT DELIBERATELY STAYED IN App.tsx: the `<Show when={isTauri() && !IS_MAC_PLATFORM}>` gate and
// the three dynamic `@tauri-apps/api/window` calls behind these props, so the component mounts in
// Storybook with no Tauri runtime. macOS runs native traffic lights instead.
import { TextButton } from '../ui/TextButton'
import CloseButton from '../ui/CloseButton'
import styles from './WindowControls.module.css'

export function WindowControls(props: {
    onMinimize: () => void
    onToggleMaximize: () => void
    onClose: () => void
}) {
    return (
        <div class={styles['win-controls']}>
            <TextButton
                title="Minimize"
                aria-label="Minimize"
                onClick={props.onMinimize}
            >
                -
            </TextButton>
            <TextButton
                title="Maximize"
                aria-label="Maximize"
                onClick={props.onToggleMaximize}
            >
                +
            </TextButton>
            <CloseButton label="Close" onClick={props.onClose} />
        </div>
    )
}
