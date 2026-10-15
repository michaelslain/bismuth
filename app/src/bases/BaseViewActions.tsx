import { Show, type Component } from 'solid-js'
import { IconButton } from '../ui/IconButton'

/** The four bar actions BaseView used to hand-roll as separate inline components. They differ
 *  only by icon, label and whether they toggle, so they are ONE component with an `action`. */
export type BaseViewAction = 'add-task' | 'settings' | 'edit-query' | 'source'

export type BaseViewActionsProps = {
    action: BaseViewAction
    /** Whether the action applies right now — the caller owns the gating (mode, edit path,
     *  embedded source …); the component only renders. */
    when: boolean
    /** For the two toggles (`settings`, `source`): whether their panel is open. */
    active?: boolean
    /** Overrides whether the action is a toggle (default: per action). A `source` button that only
     *  reveals the embedded fence is a one-shot command, not a toggle. */
    toggle?: boolean
    onAct: () => void
}

const ACTIONS: Record<
    BaseViewAction,
    { icon: string; label: string; toggles: boolean }
> = {
    'add-task': { icon: 'Plus', label: 'New task', toggles: false },
    settings: { icon: 'Settings', label: 'Settings', toggles: true },
    'edit-query': { icon: 'Pencil', label: 'Edit query', toggles: false },
    source: { icon: 'Code', label: 'Source', toggles: true },
}

const BaseViewActions: Component<BaseViewActionsProps> = props => {
    const def = () => ACTIONS[props.action]
    const toggles = () => props.toggle ?? def().toggles
    return (
        <Show when={props.when}>
            <IconButton
                icon={def().icon}
                label={def().label}
                variant={
                    toggles()
                        ? props.active
                            ? 'selected'
                            : 'unselected'
                        : undefined
                }
                onClick={() => props.onAct()}
            />
        </Show>
    )
}

export default BaseViewActions
