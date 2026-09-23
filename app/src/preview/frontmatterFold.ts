// app/src/preview/frontmatterFold.ts
// Per-file fold state of a preview's companion frontmatter strip. In-memory, per session — the
// same ruling pdfViewMemory.ts documents: a tab switch keeps it, a full reload does not.
const folded = new Map<string, boolean>()

export function isFrontmatterFolded(key: string): boolean {
    return folded.get(key) ?? false
}

export function setFrontmatterFolded(key: string, value: boolean): void {
    folded.set(key, value)
}
