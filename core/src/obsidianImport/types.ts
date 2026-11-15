// Shared shapes for the Obsidian importer (`bismuth import obsidian`). Every step is a pure
// function over VaultText; the CLI orchestrator (cli/src/obsidianImport.ts) does all I/O.

/** Vault-relative path → file text, for every `.md` and `.base` file (LF line endings). */
export type VaultText = Map<string, string>

/** Write `text` at `path` (vault-relative), or delete the file when `text` is null. */
export type FileEdit = { path: string; text: string | null }

export type ReportSection =
    | 'converted' // a fixed rewrite was applied
    | 'decide' // left as written; a person or agent must decide
    | 'lossy' // converted, but something Obsidian had is gone
    | 'defaults' // a choice the importer made without asking
    | 'left' // left as written; nothing to do (plugin syntax shown as code, etc.)

export type ReportArea =
    | 'settings'
    | 'tags'
    | 'links'
    | 'bases'
    | 'tasks'
    | 'queries'
    | 'flashcards'
    | 'drawings'
    | 'plugins'
    | 'syntax'
    | 'validation'

export type ReportItem = {
    section: ReportSection
    area: ReportArea
    /** vault-relative path the item is about; '' for vault-wide items */
    path: string
    /** one line, plain words; quotes the exact source text where there is one */
    detail: string
}

export type StepResult = { edits: FileEdit[]; items: ReportItem[] }

/** What `.obsidian/` held, parsed. Every field is null / empty when the file is absent. */
export type ObsidianConfig = {
    /** false when the source has no `.obsidian/` folder at all */
    present: boolean
    /** ids from community-plugins.json */
    plugins: string[]
    app: Record<string, unknown> | null
    dailyNotes: Record<string, unknown> | null
    templates: Record<string, unknown> | null
    appearance: Record<string, unknown> | null
    /** plugin id → parsed `.obsidian/plugins/<id>/data.json`, for the plugins that have one */
    pluginData: Record<string, unknown>
}

/** Context every step may read. */
export type ImportContext = {
    config: ObsidianConfig
    /** every vault-relative file path in the copy, binaries included */
    allPaths: string[]
}
