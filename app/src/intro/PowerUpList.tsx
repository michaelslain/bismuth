import type { Component } from 'solid-js'
import { For } from 'solid-js'
import Card from '../ui/Card'
import Text from '../ui/Text'
import ToggleRow from '../ui/ToggleRow'
import styles from './PowerUpList.module.css'

/** Structural — introSlides' `PowerUp` (which also carries `cmd`) is assignable to it. */
export type PowerUpItem = { id: string; icon: string; name: string; desc: string }

export type PowerUpListProps = {
    items: PowerUpItem[]
    /** Selected ids. */
    selected: string[]
    onToggle: (id: string) => void
    /** Single choice: exactly one card is selected, and clicking another moves the selection
     *  (`onToggle` then means "pick this one"). The cards keep the same look and [x]/[ ] marks. */
    single?: boolean
    class?: string
}

/** The intro's card list: one Card per option, each holding a ToggleRow (icon, name, [x]/[ ]
 *  switch) over the wrapping description. Power-ups toggle independently; `single` makes it a
 *  pick-one (the pick-an-agent slide). */
const PowerUpList: Component<PowerUpListProps> = props => {
    return (
        <div class={[styles.list, props.class ?? ''].filter(Boolean).join(' ')}>
            <For each={props.items}>
                {p => (
                    <Card variant="quiet" class={styles.powerup}>
                        <ToggleRow
                            icon={p.icon}
                            label={p.name}
                            description={
                                <Text size="body" tone="muted" register="prose">
                                    {p.desc}
                                </Text>
                            }
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
