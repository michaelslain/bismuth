import { recurrenceAction, events } from '../state'
import { EventStore } from '../EventStore'
import { refreshEvents } from '../refresh'
import { prettyDate } from '../dates'
import { Show, For } from 'solid-js'
import { Modal } from '../../ui/Modal'
import { Icon } from '../../icons/Icon'
import { TextButton } from '../../ui/TextButton'
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
            <Modal onClose={close} class={`${styles['evm-modal']} ${styles['recurrence-dialog']}`}>
                <div class={styles['evm-head']}>
                    <div class={styles['evm-mark']}>
                        <Icon
                            value={isDelete() ? 'trash-2' : 'repeat'}
                            size={18}
                        />
                    </div>
                    <div class={styles['evm-htext']}>
                        <div class={styles['evm-title']}>{verb()} recurring event</div>
                        <div class={styles['evm-sub']}>
                            {eventTitle() ??
                                'Choose which occurrences to apply this to'}
                        </div>
                    </div>
                    <button
                        type="button"
                        class={styles['evm-x']}
                        aria-label="Close"
                        onClick={close}
                    >
                        <Icon value="x" size={16} />
                    </button>
                </div>

                <div class={styles['evm-body']}>
                    <div class={styles['rec-opts']} classList={{ [styles['danger']]: isDelete() }}>
                        <For each={options()}>
                            {opt => (
                                <button
                                    class={styles['rec-opt']}
                                    onClick={() => handle(opt.scope)}
                                >
                                    <span class={styles['rec-opt-ic']}>
                                        <Icon value={opt.icon} size={17} />
                                    </span>
                                    <span class={styles['rec-opt-txt']}>
                                        <span class={styles['rec-opt-lab']}>
                                            {opt.label}
                                        </span>
                                        <span class={styles['rec-opt-sub']}>
                                            {opt.sub}
                                        </span>
                                    </span>
                                    <span class={styles['rec-opt-chev']}>
                                        <Icon value="chevron-right" size={15} />
                                    </span>
                                </button>
                            )}
                        </For>
                    </div>
                </div>

                <div class={styles['evm-foot']}>
                    <span class={styles['hintkey']}>
                        <b>esc</b> to cancel
                    </span>
                    <div class={styles['sp']} />
                    <TextButton size="sm" onClick={close}>
                        CANCEL
                    </TextButton>
                </div>
            </Modal>
        </Show>
    )
}
