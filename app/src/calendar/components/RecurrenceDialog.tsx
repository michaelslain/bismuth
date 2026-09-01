import { recurrenceAction, events } from '../state'
import { EventStore } from '../EventStore'
import { refreshEvents } from '../refresh'
import { prettyDate } from '../dates'
import { Show, For } from 'solid-js'
import { Modal } from '../../ui/Modal'
import { TextButton } from '../../ui/TextButton'
import ModalHeader from '../../ui/ModalHeader'
import ModalFooter from '../../ui/ModalFooter'
import OptionRow from '../../ui/OptionRow'
import styles from '../Calendar.module.css'

type Scope = 'one' | 'all' | 'following'

export function RecurrenceDialog(props: { store: EventStore }) {
    async function handle(scope: Scope): Promise<void> {
        const action = recurrenceAction.value
        if (!action) return
        const { type, masterId, occurrenceDate, updates } = action

        if (type === 'delete') {
            if (scope === 'one') {
                await props.store.deleteOccurrence(masterId, occurrenceDate)
            } else if (scope === 'all') {
                const master = events.value.find(e => e.id === masterId)
                if (master?.recurrence)
                    await props.store.deleteSeries(master.recurrence.seriesId)
            } else {
                await props.store.deleteFollowing(masterId, occurrenceDate)
            }
        } else if (type === 'edit' && updates) {
            if (scope === 'one') {
                await props.store.editOccurrence(
                    masterId,
                    occurrenceDate,
                    updates,
                )
            } else if (scope === 'all') {
                const master = events.value.find(e => e.id === masterId)
                if (master?.recurrence)
                    await props.store.editSeries(
                        master.recurrence.seriesId,
                        updates,
                    )
            } else {
                await props.store.editFollowing(
                    masterId,
                    occurrenceDate,
                    updates,
                )
            }
        }

        await props.store.load()
        await refreshEvents(props.store)
        recurrenceAction.value = null
    }

    const close = () => (recurrenceAction.value = null)
    const isDelete = () => recurrenceAction.value!.type === 'delete'
    const verb = () => (isDelete() ? 'Delete' : 'Edit')
    const eventTitle = () =>
        events.value.find(e => e.id === recurrenceAction.value!.masterId)?.title

    // Each option: stored scope, icon, label, and a sub-line describing the span.
    const options = (): {
        scope: Scope
        icon: string
        label: string
        sub: string
    }[] => {
        const when = prettyDate(recurrenceAction.value!.occurrenceDate)
        return [
            {
                scope: 'one',
                icon: 'CircleCheck',
                label: 'This event',
                sub: `Only ${when}`,
            },
            {
                scope: 'following',
                icon: 'ArrowRight',
                label: 'This and following events',
                sub: `${when} onward`,
            },
            {
                scope: 'all',
                icon: 'Calendar',
                label: 'All events',
                sub: 'The entire series',
            },
        ]
    }

    return (
        <Show when={recurrenceAction.value}>
            <Modal
                onClose={close}
                label={`${verb()} recurring event`}
                class={`${styles['evm-modal']} ${styles['recurrence-dialog']}`}
            >
                <ModalHeader
                    icon={isDelete() ? 'trash-2' : 'repeat'}
                    title={`${verb()} recurring event`}
                    subtitle={
                        eventTitle() ?? 'Choose which occurrences to apply this to'
                    }
                    compact
                    onClose={close}
                />

                <div class={styles['evm-body']}>
                    <div class={styles['rec-opts']}>
                        <For each={options()}>
                            {opt => (
                                <OptionRow
                                    icon={opt.icon}
                                    label={opt.label}
                                    sublabel={opt.sub}
                                    danger={isDelete()}
                                    onClick={() => handle(opt.scope)}
                                />
                            )}
                        </For>
                    </div>
                </div>

                <ModalFooter hint="to cancel">
                    <TextButton size="sm" onClick={close}>
                        CANCEL
                    </TextButton>
                </ModalFooter>
            </Modal>
        </Show>
    )
}
