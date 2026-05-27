import { createSignal, onMount, onCleanup, Show } from 'solid-js'
import { CalendarEvent, Category } from '../types'
import { showEventModal, settings } from '../state'
import { formatTime } from '../dates'

interface Props { event: CalendarEvent; masterId?: string; occurrenceDate?: string; categories: Category[] }

export function EventChip(props: Props) {
  const category = () => props.categories.find(c => c.name === props.event.category)
  const color = () => category()?.color ?? 'var(--interactive-accent)'
  const military = () => settings.value.militaryTime

  let chipRef: HTMLDivElement | undefined
  let metaRef: HTMLDivElement | undefined
  const [metaVisible, setMetaVisible] = createSignal(true)

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
        showEventModal.value = { event: props.event, masterId: props.masterId, occurrenceDate: props.occurrenceDate }
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
    </div>
  )
}
