import { createSignal, onMount, onCleanup, For, Show } from 'solid-js'
import { categories, showCategoryPanel } from '../state'
import { EventStore } from '../EventStore'

export function CategoryPanel(props: { store: EventStore }) {
  const [newName, setNewName] = createSignal('')
  const [newColor, setNewColor] = createSignal('#4a90e2')

  async function handleAdd(): Promise<void> {
    if (!newName().trim()) return
    await props.store.addCategory({ name: newName().trim(), color: newColor() })
    categories.value = props.store.getCategories()
    setNewName('')
    setNewColor('#4a90e2')
  }

  async function handleDelete(name: string): Promise<void> {
    const reassign = categories.value.filter(c => c.name !== name)[0]?.name
    await props.store.deleteCategory(name, reassign)
    categories.value = props.store.getCategories()
  }

  async function handleColorChange(name: string, color: string): Promise<void> {
    await props.store.updateCategory(name, { color })
    categories.value = props.store.getCategories()
  }

  onMount(() => {
    function onKey(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === 'Escape') {
        showCategoryPanel.value = false
      } else if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault()
        handleAdd()
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  return (
    <Show when={showCategoryPanel.value}>
      <div class="modal-overlay" onClick={() => (showCategoryPanel.value = false)}>
        <div class="category-panel" onClick={e => e.stopPropagation()}>
          <h3>Categories</h3>
          <div class="category-list">
            <For each={categories.value}>{c => (
              <div class="category-row">
                <input type="color" value={c.color} onInput={e => handleColorChange(c.name, e.currentTarget.value)} />
                <span>{c.name}</span>
                <button onClick={() => handleDelete(c.name)}>✕</button>
              </div>
            )}</For>
          </div>
          <div class="category-add-row">
            <input type="color" value={newColor()} onInput={e => setNewColor(e.currentTarget.value)} />
            <input placeholder="Category name" value={newName()} onInput={e => setNewName(e.currentTarget.value)} />
            <button onClick={handleAdd}>Add</button>
          </div>
          <div class="modal-actions"><button onClick={() => (showCategoryPanel.value = false)}>Done</button></div>
        </div>
      </div>
    </Show>
  )
}
