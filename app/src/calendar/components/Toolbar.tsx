import { For } from 'solid-js'
import { currentView, currentDate, showCategoryPanel, settings } from '../state'
import { ViewType } from '../types'
import { toDateStr, addDays } from '../dates'

const VIEWS: { id: ViewType; label: string }[] = [
  { id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }, { id: '3day', label: '3 Day' }, { id: 'day', label: 'Day' },
]

function navigate(dir: -1 | 1) {
  const d = new Date(currentDate.value)
  const v = currentView.value
  if (v === 'month') d.setMonth(d.getMonth() + dir)
  else if (v === 'week') d.setDate(d.getDate() + dir * 7)
  else if (v === '3day') d.setDate(d.getDate() + dir * 3)
  else d.setDate(d.getDate() + dir)
  currentDate.value = new Date(d)
}

function headerLabel(): string {
  const d = currentDate.value
  const v = currentView.value
  const mondayFirst = settings.value.weekStartsOnMonday
  if (v === 'month') return d.toLocaleString('default', { month: 'long', year: 'numeric' })
  if (v === 'week') { const offset = mondayFirst ? -((d.getDay() + 6) % 7) : -d.getDay(); const start = addDays(d, offset); return `${toDateStr(start)} – ${toDateStr(addDays(start, 6))}` }
  if (v === '3day') return `${toDateStr(d)} – ${toDateStr(addDays(d, 2))}`
  return toDateStr(d)
}

export function Toolbar() {
  return (
    <div class="calendar-toolbar">
      <div class="calendar-toolbar-left">
        <button onClick={() => navigate(-1)}>‹</button>
        <button onClick={() => (currentDate.value = new Date())}>Today</button>
        <button onClick={() => navigate(1)}>›</button>
        <span class="calendar-toolbar-label">{headerLabel()}</span>
      </div>
      <div class="calendar-toolbar-right">
        <For each={VIEWS}>{v => (
          <button class={currentView.value === v.id ? 'active' : ''} onClick={() => (currentView.value = v.id)}>{v.label}</button>
        )}</For>
        <button onClick={() => (showCategoryPanel.value = !showCategoryPanel.value)}>Categories</button>
      </div>
    </div>
  )
}
