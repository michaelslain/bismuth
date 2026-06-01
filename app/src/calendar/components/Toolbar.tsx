import { For } from 'solid-js'
import { currentView, currentDate, showCategoryPanel, settings } from '../state'
import { TextButton } from '../../ui/TextButton'
import { IconButton } from '../../ui/IconButton'
import { ViewType } from '../types'
import { toDateStr, addDays, weekRange } from '../dates'

const VIEWS: { id: ViewType; label: string }[] = [
  { id: 'month', label: 'MONTH' }, { id: 'week', label: 'WEEK' }, { id: '3day', label: '3 DAY' }, { id: 'day', label: 'DAY' },
]

function navigate(dir: -1 | 1): void {
  const d = new Date(currentDate.value)
  const v = currentView.value
  switch (v) {
    case 'month':
      d.setMonth(d.getMonth() + dir)
      break
    case 'week':
      d.setDate(d.getDate() + dir * 7)
      break
    case '3day':
      d.setDate(d.getDate() + dir * 3)
      break
    case 'day':
      d.setDate(d.getDate() + dir)
  }
  currentDate.value = new Date(d)
}

function headerLabel(): string {
  const d = currentDate.value
  const v = currentView.value
  const mondayFirst = settings.value.weekStartsOnMonday

  if (v === 'month') return d.toLocaleString('default', { month: 'long', year: 'numeric' })

  if (v === 'week') {
    const [ws, we] = weekRange(d, mondayFirst)
    return `${ws} – ${we}`
  }

  if (v === '3day') return `${toDateStr(d)} – ${toDateStr(addDays(d, 2))}`

  return toDateStr(d)
}

export function Toolbar() {
  return (
    <div class="calendar-toolbar">
      <div class="calendar-toolbar-left">
        <IconButton icon="ChevronLeft" label="Previous" variant="plain" onClick={() => navigate(-1)} />
        <TextButton variant="plain" onClick={() => (currentDate.value = new Date())}>TODAY</TextButton>
        <IconButton icon="ChevronRight" label="Next" variant="plain" onClick={() => navigate(1)} />
        <span class="calendar-toolbar-label">{headerLabel()}</span>
      </div>
      <div class="calendar-toolbar-right">
        <For each={VIEWS}>{v => (
          <TextButton variant="plain" class={currentView.value === v.id ? 'active' : ''} onClick={() => (currentView.value = v.id)}>{v.label}</TextButton>
        )}</For>
        <TextButton variant="plain" onClick={() => (showCategoryPanel.value = !showCategoryPanel.value)}>CATEGORIES</TextButton>
      </div>
    </div>
  )
}
