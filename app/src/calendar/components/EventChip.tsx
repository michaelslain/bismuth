import { createSignal, onMount, onCleanup, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { CalendarEvent, Category } from '../types'
import { showEventModal, settings, events, recurrenceAction } from '../state'
import { formatTime } from '../dates'
import { resolveCategoryColor } from '../categoryColor'
import { EventStore } from '../EventStore'
import { ContextMenu } from '../../ContextMenu'
import { IconButton } from '../../ui/IconButton'

interface Props { event: CalendarEvent; masterId?: string; occurrenceDate?: string; categories: Category[]; store: EventStore; compact?: boolean }

export function EventChip(props: Props) {
  // The chip is tinted by its category's colour (a theme token → var(--token), or a
  // custom colour); events with no resolvable category render as an outline-only ghost.
  const category = () => props.categories.find(c => c.name === props.event.category)
  const chipBg = () => {
    const cat = category()
    return cat ? `color-mix(in srgb, ${resolveCategoryColor(cat.color)} 85%, transparent)` : undefined
  }
  const military = () => settings.value.militaryTime

  let chipRef: HTMLDivElement | undefined
  let metaRef: HTMLDivElement | undefined
  const [metaVisible, setMetaVisible] = createSignal(true)
  const [menu, setMenu] = createSignal<{ x: number; y: number } | null>(null)

  function openEdit(): void {
    showEventModal.value = { event: props.event, masterId: props.masterId, occurrenceDate: props.occurrenceDate }
  }

  async function handleDelete(): Promise<void> {
    if (props.event.recurrence && props.masterId && props.occurrenceDate) {
      recurrenceAction.value = { type: 'delete', masterId: props.masterId, occurrenceDate: props.occurrenceDate }
    } else {
      await props.store.deleteEvent(props.event.id)
      events.value = events.value.filter(e => e.id !== props.event.id)
    }
  }

  onMount(() => {
    const chip = chipRef
    const meta = metaRef
    if (!chip || !meta) return
    let decided = false
    const check = (): void => {
      if (decided) return
      const metaBottom = meta.offsetTop + meta.offsetHeight
      if (metaBottom > chip.clientHeight + 1) {
        decided = true
        setMetaVisible(false)
      }
    }
    const obs = new ResizeObserver(check)
    obs.observe(chip)
    obs.observe(meta)
    const timer = setTimeout(check, 50)
    onCleanup(() => {
      obs.disconnect()
      clearTimeout(timer)
    })
  })

  return (
    <div
      ref={chipRef}
      class={`event-chip ev ${category() ? '' : 'ghost'}${props.compact ? ' compact' : ''}`}
      style={chipBg() ? { background: chipBg() } : undefined}
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
          {/* Compact (short) events show only the start time so the title gets the room. */}
          {!props.compact && props.event.endTime ? ` — ${formatTime(props.event.endTime, military())}` : ''}
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
            <IconButton icon="Link" label="Open link" class="event-chip-link" iconSize={12} onClick={e => { e.stopPropagation(); window.open(props.event.link!, '_blank') }} />
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
                  { label: 'Edit', icon: 'Pencil', onSelect: openEdit },
                  { label: 'Delete', icon: 'Trash2', danger: true, separatorBefore: true, onSelect: handleDelete },
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
