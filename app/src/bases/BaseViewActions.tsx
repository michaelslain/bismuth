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
    onAct: () => void
}

const ACTIONS: Record<
    BaseViewAction,
    { icon: string; activeIcon?: string; label: string; toggles: boolean }
> = {
    'add-task': { icon: 'Plus', label: 'New task', toggles: false },
    settings: { icon: 'Settings', label: 'Settings', toggles: true },
    'edit-query': { icon: 'Pencil', label: 'Edit query', toggles: false },
    source: { icon: 'Code', activeIcon: 'X', label: 'Source', toggles: true },
}

const BaseViewActions: Component<BaseViewActionsProps> = props => {
    const def = () => ACTIONS[props.action]
    return (
        <Show when={props.when}>
            <IconButton
                icon={props.active && def().activeIcon ? def().activeIcon! : def().icon}
                label={def().label}
                variant={
                    def().toggles ? (props.active ? 'selected' : 'unselected') : undefined
                }
                onClick={() => props.onAct()}
            />
        </Show>
    )
}

export default BaseViewActions
