import { createSignal, onMount, onCleanup, For, Show } from 'solid-js'
import { categories, showCategoryPanel } from '../state'
import { EventStore } from '../EventStore'
import { settings } from '../../settings'
import { Modal } from '../../ui/Modal'
import { TextButton } from '../../ui/TextButton'
import { IconButton } from '../../ui/IconButton'
import { TextInput } from '../../ui/TextInput'
import { THEME_SWATCHES, isThemeToken, categoryColorHex } from '../categoryColor'

/** Colour picker: the theme palette swatches (stored as tokens so they track the
 *  theme) plus a custom "any colour" well backed by the native picker. */
function CategorySwatches(props: { value: string; onChange: (c: string) => void }) {
  return (
    <div class="cat-swatches">
      <For each={THEME_SWATCHES}>{tok => (
        <button
          type="button"
          class="cat-swatch"
          classList={{ selected: props.value === tok }}
          style={{ background: `var(--${tok})` }}
          title={tok}
          onClick={() => props.onChange(tok)}
        />
      )}</For>
      <label
        class="cat-swatch cat-swatch-custom"
        classList={{ selected: !isThemeToken(props.value) }}
        style={!isThemeToken(props.value) ? { background: props.value } : undefined}
        title="Custom colour"
      >
        <input type="color" value={categoryColorHex(props.value)} onInput={e => props.onChange(e.currentTarget.value)} />
      </label>
    </div>
  )
}

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
              <div class="cat-row-main">
                <span class="cat-name">{c.name}</span>
                <CategorySwatches value={c.color} onChange={col => handleColorChange(c.name, col)} />
              </div>
              <IconButton label="Delete category" icon="X" iconSize={14} onClick={() => handleDelete(c.name)} />
            </div>
          )}</For>
        </div>
        <div class="cat-divider" />
        <div class="cat-add-label">New category</div>
        <div class="category-add-row">
          <div class="cat-row-head">
            <TextInput placeholder="Category name" value={newName()} onInput={setNewName} />
            <TextButton size="sm" variant="selected" onClick={handleAdd}>ADD</TextButton>
          </div>
          <CategorySwatches value={newColor()} onChange={setNewColor} />
        </div>
        <div class="modal-actions"><TextButton size="sm" variant="selected" onClick={() => (showCategoryPanel.value = false)}>DONE</TextButton></div>
      </Modal>
    </Show>
  )
}
