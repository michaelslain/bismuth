// Header label for a column id. Pure + dependency-free (no JSX/Icon UI) so both the
// live BaseView (renderValue.tsx) and the export path (export/baseTable.ts) can share
// it — the export path can't import the JSX/Icon module under the test runner / worker.
import type { BaseConfig } from '../../../core/src/bases/types'

export function columnLabel(id: string, config: BaseConfig): string {
    // A property may be declared bare (`price:`) or namespaced (`note.price:`) for the column
    // `note.price`, the same match `propertyType` makes.
    const props = config.properties
    const bare = id.startsWith('note.') ? id.slice(5) : id
    const customLabel = (props?.[id] ?? props?.[bare] ?? props?.[`note.${bare}`])
        ?.displayName
    if (customLabel) return customLabel
    if (id.startsWith('file.')) return id.slice(5)
    if (id.startsWith('note.')) return id.slice(5)
    if (id.startsWith('this.')) return id.slice(5)
    if (id.startsWith('formula.')) return id.slice(8)
    return id
}
