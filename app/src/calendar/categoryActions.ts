// Category writes for the calendar, in one place so the panel, the list and the form all go
// through the same guards. Dedupe lives HERE (not only in the UI): a second add of a name that is
// already present or already in flight is a no-op, so a double Enter can never add two rows.
//
// Final signatures:
//   addCategory(store, category): Promise<boolean>            // false = duplicate / empty, nothing written
//   renameCategory(store, oldName, raw): Promise<boolean>     // false = empty / unchanged / taken
//   recolorCategory(store, name, color): Promise<void>
//   deleteCategoryWithUndo(store, name): Promise<void>        // immediate + `deleted <name>` undo toast
import type { CalendarEvent, Category } from './types'
import { EventStore } from './EventStore'
import { categories } from './state'
import { pushUndoToast } from '../undoToast'
import { pushToast } from '../toastStore'

const inFlight = new Set<string>()

const masterRows = (store: EventStore): CalendarEvent[] =>
    (store as unknown as { data: { events: CalendarEvent[] } }).data.events

const sync = (store: EventStore): void => {
    categories.value = store.getCategories()
}

const taken = (store: EventStore, name: string): boolean =>
    store.getCategories().some(c => c.name === name) || inFlight.has(name)

/** `taken`, and says so: a refused duplicate would otherwise be a silent no-op. */
const refuseTaken = (store: EventStore, name: string): boolean => {
    if (!taken(store, name)) return false
    pushToast(`a category named ${name} already exists`)
    return true
}

export async function addCategory(
    store: EventStore,
    category: Category,
): Promise<boolean> {
    const name = category.name.trim()
    if (!name || refuseTaken(store, name)) return false
    inFlight.add(name)
    try {
        await store.addCategory({ ...category, name })
    } finally {
        inFlight.delete(name)
    }
    sync(store)
    return true
}

export async function renameCategory(
    store: EventStore,
    oldName: string,
    raw: string,
): Promise<boolean> {
    const name = raw.trim()
    if (!name || name === oldName || refuseTaken(store, name)) return false
    await store.updateCategory(oldName, { name })
    sync(store)
    return true
}

export async function recolorCategory(
    store: EventStore,
    name: string,
    color: string,
): Promise<void> {
    await store.updateCategory(name, { color })
    sync(store)
}

/** Deletes a category at once. Events that carried it are reassigned to `Uncategorized` /
 *  `Default` when one exists, else cleared; undo restores the category and every affected event's
 *  `category` + `categories` exactly as they were. */
export async function deleteCategoryWithUndo(
    store: EventStore,
    name: string,
): Promise<void> {
    const before = store.getCategories()
    const removed = before.find(c => c.name === name)
    if (!removed) return
    const at = before.findIndex(c => c.name === name)
    const reassign = before.find(
        c =>
            c.name !== name &&
            (c.name === 'Uncategorized' || c.name === 'Default'),
    )?.name
    const snapshot = structuredClone(
        masterRows(store)
            .filter(e => e.category === name || e.categories?.includes(name))
            .map(e => ({
                id: e.id,
                category: e.category,
                categories: e.categories,
            })),
    )
    await store.deleteCategory(name, reassign)
    sync(store)

    pushUndoToast(`deleted ${name}`, async () => {
        if (!store.getCategories().some(c => c.name === name))
            await store.addCategory(removed, at)
        for (const s of snapshot)
            await store.updateEvent(s.id, {
                category: s.category,
                categories: s.categories,
            })
        sync(store)
    })
}
