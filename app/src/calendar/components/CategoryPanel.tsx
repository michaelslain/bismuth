import { createSignal, onMount, onCleanup, For, Show } from 'solid-js'
import { categories, showCategoryPanel } from '../state'
import { EventStore } from '../EventStore'
import { settings } from '../../settings'
import { Modal } from '../../ui/Modal'
import { TextButton } from '../../ui/TextButton'
import { IconButton } from '../../ui/IconButton'

export function CategoryPanel(props: { store: EventStore }) {
  const [newName, setNewName] = createSignal('')
  const [newColor, setNewColor] = createSignal(settings.calendar.defaultCategoryColor)

  async function handleAdd(): Promise<void> {
    if (!newName().trim()) return
    await props.store.addCategory({ name: newName().trim(), color: newColor() })
    categories.value = props.store.getCategories()
    setNewName('')
    setNewColor(settings.calendar.defaultCategoryColor)
  }

  async function handleDelete(name: string): Promise<void> {
    // Reassign orphaned events to a stable default category if one exists
    // ('Uncategorized' / 'Default'); otherwise clear the category so events
    // become uncategorized rather than silently moved to an arbitrary neighbor.
    const reassign = categories.value.find(
      c => c.name !== name && (c.name === 'Uncategorized' || c.name === 'Default'),
    )?.name
    await props.store.deleteCategory(name, reassign)
    categories.value = props.store.getCategories()
  }

  async function handleColorChange(name: string, color: string): Promise<void> {
    await props.store.updateCategory(name, { color })
    categories.value = props.store.getCategories()
  }

  onMount(() => {
    // Escape-to-close is handled by <Modal>; this keeps Enter-to-add.
    function onKey(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault()
        handleAdd()
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  return (
    <Show when={showCategoryPanel.value}>
      <Modal onClose={() => (showCategoryPanel.value = false)} class="category-panel">
        <h3>Categories</h3>
        <div class="category-list">
          <For each={categories.value}>{c => (
            <div class="category-row">
              <input type="color" value={c.color} onInput={e => handleColorChange(c.name, e.currentTarget.value)} />
              <span>{c.name}</span>
              <IconButton label="Delete category" icon="X" iconSize={12} onClick={() => handleDelete(c.name)} />
            </div>
          )}</For>
        </div>
        <div class="category-add-row">
          <input type="color" value={newColor()} onInput={e => setNewColor(e.currentTarget.value)} />
          <input placeholder="Category name" value={newName()} onInput={e => setNewName(e.currentTarget.value)} />
          <TextButton onClick={handleAdd}>ADD</TextButton>
        </div>
        <div class="modal-actions"><TextButton onClick={() => (showCategoryPanel.value = false)}>DONE</TextButton></div>
      </Modal>
    </Show>
  )
}
