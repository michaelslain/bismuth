import { recurrenceAction, events } from '../state'
import { EventStore } from '../EventStore'
import { refreshEvents } from '../refresh'
import { Show } from 'solid-js'
import { Modal } from '../../ui/Modal'

export function RecurrenceDialog(props: { store: EventStore }) {
  async function handle(scope: 'one' | 'all' | 'following'): Promise<void> {
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

  return (
    <Show when={recurrenceAction.value}>
      <Modal onClose={() => (recurrenceAction.value = null)} class="recurrence-dialog">
        <h3>{recurrenceAction.value!.type === 'delete' ? 'Delete recurring event' : 'Edit recurring event'}</h3>
        <p>Which occurrences do you want to {recurrenceAction.value!.type}?</p>
        <div class="recurrence-dialog-actions">
          <button onClick={() => handle('one')}>Just this one</button>
          <button onClick={() => handle('following')}>This and following</button>
          <button onClick={() => handle('all')}>All</button>
          <button onClick={() => (recurrenceAction.value = null)}>Cancel</button>
        </div>
      </Modal>
    </Show>
  )
}
