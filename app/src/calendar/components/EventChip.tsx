import { createSignal, onMount, onCleanup, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { CalendarEvent, Category } from '../types'
import { showEventModal, settings, events, recurrenceAction } from '../state'
import { formatTime } from '../dates'
import { EventStore } from '../EventStore'
import { ContextMenu } from '../../ContextMenu'

interface Props { event: CalendarEvent; masterId?: string; occurrenceDate?: string; categories: Category[]; store: EventStore }

export function EventChip(props: Props) {
  const category = () => props.categories.find(c => c.name === props.event.category)
  const color = () => category()?.color ?? 'var(--interactive-accent)'
  const military = () => settings.value.militaryTime

  let chipRef: HTMLDivElement | undefined
  let metaRef: HTMLDivElement | undefined
  const [metaVisible, setMetaVisible] = createSignal(true)
  const [menu, setMenu] = createSignal<{ x: number; y: number } | null>(null)

  function openEdit() {
    showEventModal.value = { event: props.event, masterId: props.masterId, occurrenceDate: props.occurrenceDate }
  }
  async function handleDelete() {
    if (props.event.recurrence && props.masterId && props.occurrenceDate) {
      // Recurring: let the user pick this-one / following / all (same as the modal).
      recurrenceAction.value = { type: 'delete', masterId: props.masterId, occurrenceDate: props.occurrenceDate }
    } else {
      await props.store.deleteEvent(props.event.id)
      events.value = events.value.filter(e => e.id !== props.event.id)
    }
  }

  onMount(() => {
    const chip = chipRef, meta = metaRef
    if (!chip || !meta) return
    let decided = false
    const check = () => {
      if (decided) return
      const metaBottom = meta.offsetTop + meta.offsetHeight
      if (metaBottom > chip.clientHeight + 1) { decided = true; setMetaVisible(false) }
    }
    const obs = new ResizeObserver(check)
    obs.observe(chip); obs.observe(meta)
    const timer = setTimeout(check, 50)
    onCleanup(() => { obs.disconnect(); clearTimeout(timer) })
  })

  return (
    <div
      ref={chipRef}
      class="event-chip"
      style={{ background: color() }}
      onClick={e => {
        e.stopPropagation()
        openEdit()
      }}
      onContextMenu={e => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <Show when={props.event.startTime}>
        <span class="event-chip-time">
          {formatTime(props.event.startTime!, military())}
          {props.event.endTime ? ` — ${formatTime(props.event.endTime, military())}` : ''}
        </span>
      </Show>
      <span class="event-chip-title">{props.event.title}</span>
      <Show when={props.event.location || props.event.link}>
        <div
          ref={metaRef}
          class="event-chip-meta"
          style={{ visibility: metaVisible() ? 'visible' : 'hidden', height: metaVisible() ? undefined : '0', overflow: 'hidden' }}
        >
          <Show when={props.event.location}><span class="event-chip-location">{props.event.location}</span></Show>
          <Show when={props.event.link}>
            <span class="event-chip-link" onClick={e => { e.stopPropagation(); window.open(props.event.link!, '_blank') }}>🔗</span>
          </Show>
        </div>
      </Show>
      <Show when={menu()}>
        {m => {
          // Portal to document.body so the fixed menu escapes the chip's
          // overflow:hidden and :hover filter (which would otherwise clip it).
          return (
            <Portal>
              <ContextMenu
                x={m().x}
                y={m().y}
                items={[
                  { label: 'Edit', onSelect: openEdit },
                  { label: 'Delete', onSelect: handleDelete, danger: true },
                ]}
                onClose={() => setMenu(null)}
              />
            </Portal>
          )
        }}
      </Show>
    </div>
  )
}
