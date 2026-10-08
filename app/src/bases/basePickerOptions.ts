import { isBasePath, baseNameOf } from '../../../core/src/bases/baseFile'

export type BasePickerOption = { value: string; label: string }

const isNotePath = (path: string): boolean => path.endsWith('.md')

/** The from/ref picker's options: every note and every base, as a `[[wikilink]]` value.
 *  A name carried by one file is `[[Name]]`. A name carried by several (`Foo.md` and
 *  `Foo.base.jsonl` in different folders) gets a path-qualified value and label for each, so
 *  no two options share a value. The base being edited (`self`) is left out of the options but still counts toward
 *  name sharing, so a note named like it gets a path-qualified value. */
export function basePickerOptions(
    entries: { path: string }[],
    self?: string,
): BasePickerOption[] {
    const paths = entries
        .map(e => e.path)
        .filter(p => isNotePath(p) || isBasePath(p))
    const count = new Map<string, number>()
    for (const p of paths)
        count.set(baseNameOf(p), (count.get(baseNameOf(p)) ?? 0) + 1)
    return paths
        .filter(p => p !== self)
        .map(p => {
            const name = baseNameOf(p)
            if (count.get(name) === 1)
                return { value: `[[${name}]]`, label: name }
            // A root note is `[[Foo.md]]` (the bare name would be the base's), a nested note is
            // its extensionless path, a base is its full path so `pickRefPath` takes it exactly.
            const ref = isBasePath(p) ? p : p.includes('/') ? p.slice(0, -3) : p
            return { value: `[[${ref}]]`, label: ref }
        })
        .sort((a, b) => a.label.localeCompare(b.label))
}
