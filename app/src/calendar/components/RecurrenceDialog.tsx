import { recurrenceAction, events } from '../state'
import { EventStore } from '../EventStore'
import { refreshEvents } from '../refresh'
import { prettyDate } from '../dates'
import { Show, For } from 'solid-js'
import { Modal } from '../../ui/Modal'
import { Icon } from '../../icons/Icon'
import { TextButton } from '../../ui/TextButton'

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
        if (master?.recurrence) await props.store.deleteSeries(master.recurrence.seriesId)
      } else {
        await props.store.deleteFollowing(masterId, occurrenceDate)
      }
    } else if (type === 'edit' && updates) {
      if (scope === 'one') {
        await props.store.editOccurrence(masterId, occurrenceDate, updates)
      } else if (scope === 'all') {
        const master = events.value.find(e => e.id === masterId)
        if (master?.recurrence) await props.store.editSeries(master.recurrence.seriesId, updates)
      } else {
        await props.store.editFollowing(masterId, occurrenceDate, updates)
      }
    }

    await props.store.load()
    await refreshEvents(props.store)
    recurrenceAction.value = null
  }

  const close = () => (recurrenceAction.value = null)
  const isDelete = () => recurrenceAction.value!.type === 'delete'
  const verb = () => (isDelete() ? 'Delete' : 'Edit')
  const eventTitle = () => events.value.find(e => e.id === recurrenceAction.value!.masterId)?.title

  // Each option: stored scope, icon, label, and a sub-line describing the span.
  const options = (): { scope: Scope; icon: string; label: string; sub: string }[] => {
    const when = prettyDate(recurrenceAction.value!.occurrenceDate)
    return [
      { scope: 'one', icon: 'calendar-check', label: 'This event', sub: `Only ${when}` },
      { scope: 'following', icon: 'calendar-clock', label: 'This and following events', sub: `${when} onward` },
      { scope: 'all', icon: 'calendar-days', label: 'All events', sub: 'The entire series' },
    ]
  }

  return (
    <Show when={recurrenceAction.value}>
      <Modal onClose={close} class="evm-modal recurrence-dialog">
        <div class="evm-head">
          <div class="evm-mark"><Icon value={isDelete() ? 'trash-2' : 'repeat'} size={18} /></div>
          <div class="evm-htext">
            <div class="evm-title">{verb()} recurring event</div>
            <div class="evm-sub">{eventTitle() ?? 'Choose which occurrences to apply this to'}</div>
          </div>
          <button type="button" class="evm-x" aria-label="Close" onClick={close}><Icon value="x" size={16} /></button>
        </div>

        <div class="evm-body">
          <div class="rec-opts" classList={{ danger: isDelete() }}>
            <For each={options()}>{opt => (
              <button class="rec-opt" onClick={() => handle(opt.scope)}>
                <span class="rec-opt-ic"><Icon value={opt.icon} size={17} /></span>
                <span class="rec-opt-txt">
                  <span class="rec-opt-lab">{opt.label}</span>
                  <span class="rec-opt-sub">{opt.sub}</span>
                </span>
                <span class="rec-opt-chev"><Icon value="chevron-right" size={15} /></span>
              </button>
            )}</For>
          </div>
        </div>

        <div class="evm-foot">
          <span class="hintkey"><b>esc</b> to cancel</span>
          <div class="sp" />
          <TextButton size="sm" onClick={close}>CANCEL</TextButton>
        </div>
      </Modal>
    </Show>
  )
}
