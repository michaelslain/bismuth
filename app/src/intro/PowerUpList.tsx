import type { Component } from 'solid-js'
import { For } from 'solid-js'
import Card from '../ui/Card'
import ToggleRow from '../ui/ToggleRow'
import styles from './PowerUpList.module.css'

/** Structural — introSlides' `PowerUp` (which also carries `cmd`) is assignable to it. */
export type PowerUpItem = { id: string; icon: string; name: string; desc: string }

export type PowerUpListProps = {
    items: PowerUpItem[]
    /** Selected ids. */
    selected: string[]
    onToggle: (id: string) => void
    class?: string
}

/** The intro's power-ups slide body: one Card per optional power-up, each holding a ToggleRow
 *  (icon, name, [x]/[ ] switch) over the wrapping description. */
const PowerUpList: Component<PowerUpListProps> = props => {
    return (
        <div class={[styles.list, props.class ?? ''].filter(Boolean).join(' ')}>
            <For each={props.items}>
                {p => (
                    <Card class={styles.powerup}>
                        <ToggleRow
                            icon={p.icon}
                            label={p.name}
                            description={p.desc}
                            checked={props.selected.includes(p.id)}
                            onToggle={() => props.onToggle(p.id)}
                        />
                    </Card>
                )}
            </For>
        </div>
    )
}

export default PowerUpList
