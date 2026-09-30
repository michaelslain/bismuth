import type { Component } from 'solid-js'
import { TextButton } from '../ui/TextButton'
import Kbd from '../ui/ascii/Kbd'
import styles from './GradeButton.module.css'

export type GradeButtonProps = {
    /** The grade word, lowercase: "hard" | "good" | "easy". */
    label: string
    /** The grade's live keybinding in the app's syntax ("1", "Mod+1"), drawn as caps under the
     *  label — pass `settings.keybindings[id]`, so a rebind changes the caps too. */
    combo?: string
    /** Tooltip on the button, e.g. "good (2)". */
    title?: string
    onClick: () => void
    class?: string
}

/**
 * One flashcard grade: the `[ label ]` button with its keybinding caps set quietly underneath, so
 * the row teaches its own shortcuts. The caps are a hint, not a second control — hidden from
 * assistive tech, since the button's title already names the key.
 */
const GradeButton: Component<GradeButtonProps> = props => (
    <div class={`${styles.grade} ${props.class ?? ''}`}>
        <TextButton title={props.title} onClick={() => props.onClick()}>
            {props.label}
        </TextButton>
        <div class={styles.key} aria-hidden="true">
            <Kbd combo={props.combo} muted />
        </div>
    </div>
)

export default GradeButton
