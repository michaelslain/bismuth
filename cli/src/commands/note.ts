// Note creation + templates + daily note commands for the `bismuth` CLI.
// All mutations call core functions directly (no HTTP server); the app's file
// watcher picks up the change live.
import type { CommandMap } from '../types'
import { flag, bool, positionals, requireVault, out, fail } from '../args'
import {
    createEntry,
    listTemplates,
    readNote,
    writeNote,
} from '../../../core/src/files'
import { noteStem } from '../../../core/src/pathUtils'
import { expandTemplate } from '../../../core/src/templates'
import {
    dailyNotePath,
    dailyNoteContent,
    type DailyNoteConfig,
} from '../../../core/src/dailyNote'
import { readDailyNotes, loadAppConfig } from '../../../core/src/settings'
import {
    agentChannel,
    agentDenyEntries,
    filterByPath,
    folderRestricted,
    isDeniedPath,
} from '../../../core/src/visibilityFilter'
import { dirname } from 'node:path'

/** Read `templatePath`, expand it (now + title derived from `rel`), and write the result to
 *  `rel`. Shared by `note new`'s explicit `--template` branch and its vault-default
 *  (settings.templates.newNote) branch — both do exactly this once they've picked a template. */
async function writeFromTemplate(
    vault: string,
    templatePath: string,
    rel: string,
): Promise<void> {
    const raw = await readNote(vault, templatePath)
    const { text } = expandTemplate(raw, {
        now: new Date(),
        title: noteStem(rel),
    })
    await writeNote(vault, rel, text)
}

/** `--template-folder`, else the vault's `.settings` `templates.folder` (schema default `Templates`). */
async function templateFolder(vault: string, args: string[]): Promise<string> {
    return (
        flag(args, 'template-folder') ??
        (await loadAppConfig(vault)).templates?.folder ??
        'Templates'
    )
}

export const commands: CommandMap = {
    'note new': {
        summary: 'Create a new note, optionally from a template',
        usage: '<path> [--template NAME] [--no-template]',
        async run(args) {
            const vault = requireVault(args)
            const [path] = positionals(args)
            if (!path) fail('note new: <path> required')
            const rel = path.endsWith('.md') ? path : `${path}.md`

            // Fail closed: throws when visibility is undeterminable ([] = the owner).
            const entries = await agentDenyEntries(vault)

            // An agent may not create inside a hidden folder or at a hidden path. Checked BEFORE the
            // exists check so `already exists` can never answer for a note the agent cannot see.
            const channel = agentChannel()
            if (
                channel &&
                (isDeniedPath(entries, rel) ||
                    (await folderRestricted(vault, channel))(dirname(rel)))
            )
                fail('refused: that path is not visible to this agent')

            // Resolve which template (if any) this note is made from BEFORE creating anything, so a
            // refusal leaves no empty note behind.
            let templatePath: string | undefined
            const templateName = flag(args, 'template')
            if (templateName) {
                const folder = await templateFolder(vault, args)
                const templates = await listTemplates(vault, folder)
                const match = templates.find(
                    t => t.name === templateName || t.path === templateName,
                )
                // For an agent a missing template and a hidden one answer identically, so the error
                // is not an oracle for which template names exist.
                if (!match && !agentChannel())
                    fail(`note new: template not found: ${templateName}`)
                if (!match || isDeniedPath(entries, match.path))
                    fail('refused: that template is not visible to this agent')
                templatePath = match.path
            } else if (!bool(args, 'no-template')) {
                // No explicit --template: fall back to the vault's configured default
                // (settings.templates.newNote), mirroring the app's FileTree "New File" action.
                const templatesCfg:
                    { folder?: string; newNote?: string } | undefined = (
                    await loadAppConfig(vault)
                ).templates
                const def = templatesCfg?.newNote
                if (def && isDeniedPath(entries, def)) {
                    // Not an error: the agent asked for a plain note. Never name the template.
                    console.error(
                        'warning: the default new-note template is not visible to this agent; created a blank note',
                    )
                } else if (
                    def &&
                    (await Bun.file(`${vault}/${def}`).exists())
                ) {
                    templatePath = def
                }
            }

            createEntry(vault, rel, 'file')
            if (templatePath) await writeFromTemplate(vault, templatePath, rel)

            out({ path: rel, created: true }, args)
        },
    },

    templates: {
        summary: 'List available note templates',
        async run(args) {
            const vault = requireVault(args)
            const folder = await templateFolder(vault, args)
            const entries = await agentDenyEntries(vault)
            out(
                filterByPath(
                    await listTemplates(vault, folder),
                    entries,
                    t => t.path,
                ),
                args,
            )
        },
    },

    daily: {
        summary: "Open (creating if needed) today's daily note",
        usage: '[--id <id|n>]',
        async run(args) {
            const vault = requireVault(args)
            const configs = await readDailyNotes(vault)
            const idFlag = flag(args, 'id')
            // An integer is the index into the configured list; anything else is a config `id`.
            const isIndex =
                idFlag === undefined || /^-?\d+$/.test(idFlag.trim())
            const index = idFlag === undefined ? 0 : Number(idFlag)

            const fallback: DailyNoteConfig = {
                id: 'daily',
                label: 'Daily',
                icon: 'CalendarDays',
                folder: '',
                fileName: '{{date}}',
                template: '',
            }

            let config: DailyNoteConfig
            if (!isIndex) {
                const known = configs.length ? configs : [fallback]
                const match = known.find(c => c.id === idFlag)
                if (!match)
                    fail(
                        `daily: no daily-note type with id "${idFlag}" — configured ids: ${known.map(c => c.id).join(', ')}`,
                    )
                config = match
            } else if (configs.length === 0) {
                if (index !== 0)
                    fail(
                        `daily: --id ${index} out of range — this vault configures 0 daily-note types`,
                    )
                config = fallback
            } else {
                if (index < 0 || index >= configs.length) {
                    fail(
                        `daily: --id ${index} out of range — this vault configures ${configs.length} daily-note type(s) (valid range: 0-${configs.length - 1})`,
                    )
                }
                config = configs[index]
            }

            const now = new Date()
            const path = dailyNotePath(config, now)

            // An agent may not touch, or learn the state of, a daily note it cannot see. Also
            // covers a not-yet-existing file in a hidden folder (the deny list names existing files).
            const entries = await agentDenyEntries(vault)
            const channel = agentChannel()
            if (
                isDeniedPath(entries, path) ||
                (channel &&
                    (await folderRestricted(vault, channel))(dirname(path)))
            )
                fail('refused: that daily note is not visible to this agent')

            if (await Bun.file(`${vault}/${path}`).exists()) {
                out({ path, created: false }, args)
                return
            }

            let templateRaw: string | null = null
            if (config.template && isDeniedPath(entries, config.template)) {
                console.error(
                    'warning: the template for this daily note is not visible to this agent; created without it',
                )
            } else if (
                config.template &&
                (await Bun.file(`${vault}/${config.template}`).exists())
            ) {
                templateRaw = await readNote(vault, config.template)
            }
            await writeNote(
                vault,
                path,
                dailyNoteContent(config, now, templateRaw),
            )
            out({ path, created: true }, args)
        },
    },
}
