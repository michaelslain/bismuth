// The first-run intro's small persistent brand lockup — the REAL logo mark shipped in /logos/*.svg,
// with no wordmark beside it.
//
// Split out of intro/marks.tsx (visual-unification audit §6/§9.8). That file was a camelCase module
// exporting FOUR PascalCase components, which broke the naming convention in both directions: a
// component file that did not look like one, and four components that could not be found by their
// own names. Its story file exported only two of the four, so two rendered in no story at all.
import { type Component } from 'solid-js'
import styles from './VaultIntro.module.css'

export type LockupProps = {
    /** Logo mark basename, resolved to /logos/<icon>.svg. */
    icon: string
}

const Lockup: Component<LockupProps> = props => {
    return (
        <div class={styles['vi-lockup']}>
            <span class={styles['vi-lockup-mark']}>
                <img
                    src={`/logos/${props.icon}.svg`}
                    width={30}
                    height={30}
                    alt="Bismuth"
                />
            </span>
        </div>
    )
}

export default Lockup
