// Pure logic behind SourceFields: a `SourceSpec` (what `normalizeSource` in
// core/src/bases/sourceSpec.ts produced from the frontmatter) ⇄ an editable form, and back to
// the canonical OBJECT shape `{ kind, where?, from?, ref? }` — the one form normalizeSource
// reads with no help from sibling top-level keys, and the one YAML always quotes safely (a
// `#` inside a where expression can't be eaten as a comment the way a plain string can).
//
// "own" = no `source:` at all: the base draws its rows from its own body table (or, with no
// table, every vault note — BaseView's fallback).
//
// An untouched form hands back the original spec verbatim, so opening + saving the panel
// never rewrites a source the user didn't change.
import type { SourceSpec } from '../../../core/src/bases/types'
import { formToWhere, whereToForm, type FilterForm } from './filterForm'

export type SourceChoice = 'own' | 'notes' | 'tasks' | 'base'

export const SOURCE_CHOICES: { value: SourceChoice; label: string }[] = [
    { value: 'own', label: "this base's own rows" },
    { value: 'notes', label: 'vault notes' },
    { value: 'tasks', label: 'vault tasks' },
    { value: 'base', label: 'another base' },
]

export interface SourceForm {
    kind: SourceChoice
    /** notes / tasks: the row filter. */
    where: FilterForm
    /** notes / tasks: `[[Base]]` whose notes scope the source ('' = the whole vault). */
    from: string
    /** base: `[[Other Base]]` to render. */
    ref: string
    orig?: SourceSpec
    touched: boolean
}

export function sourceToForm(spec: SourceSpec | undefined): SourceForm {
    return {
        kind: spec?.kind ?? 'own',
        where: whereToForm(
            spec && spec.kind !== 'base' ? spec.where : undefined,
        ),
        from: spec && spec.kind !== 'base' ? (spec.from ?? '') : '',
        ref: spec?.kind === 'base' ? (spec.ref ?? '') : '',
        orig: spec,
        touched: false,
    }
}

export function patchSource(
    form: SourceForm,
    patch: Partial<Omit<SourceForm, 'orig' | 'touched'>>,
): SourceForm {
    return { ...form, ...patch, touched: true }
}

/** The form → a `source:` value (undefined = remove the key: the base owns its rows). */
export function formToSource(form: SourceForm): SourceSpec | undefined {
    if (!form.touched && !form.where.touched) return form.orig
    if (form.kind === 'own') return undefined
    if (form.kind === 'base') {
        const ref = form.ref.trim()
        return ref ? { kind: 'base', ref } : { kind: 'base' }
    }
    const out: { kind: 'notes' | 'tasks'; where?: string; from?: string } = {
        kind: form.kind,
    }
    const where = formToWhere(form.where)
    if (where) out.where = where
    const from = form.from.trim()
    if (from) out.from = from
    return out
}

/** `[[Name]]` for a picker value; accepts a bare name, a path, or an existing wikilink. */
export function toWikilink(nameOrPath: string): string {
    const s = nameOrPath.trim()
    if (!s) return ''
    if (/^\[\[.*\]\]$/.test(s)) return s
    const base = s.split('/').pop()!.replace(/\.md$/, '')
    return `[[${base}]]`
}
