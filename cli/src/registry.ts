// The merged `bismuth` command registry, split out of index.ts so the binary and the parity
// test (cli/test/mcpParity.test.ts) share ONE registry and ONE matcher. `resolveCommand` is the
// longest-match rule the dispatcher uses: a three-word phrase ("daemon cron toggle") first, then a
// two-word phrase ("task toggle"), then a one-word command ("graph").
import type { CommandMap } from './types'
import * as file from './commands/file'
import * as note from './commands/note'
import * as search from './commands/search'
import * as graph from './commands/graph'
import * as task from './commands/task'
import * as base from './commands/base'
import * as calendar from './commands/calendar'
import * as card from './commands/card'
import * as prop from './commands/prop'
import * as settings from './commands/settings'
import * as daemon from './commands/daemon'
import * as draw from './commands/draw'
import * as serve from './commands/serve'
import * as exportCmd from './commands/export'
import * as api from './commands/api'
import * as app from './commands/app'
import * as page from './commands/page'
import * as install from './commands/install'
import * as backends from './commands/backends'
import * as doctor from './commands/doctor'
import * as checkpoint from './commands/checkpoint'
import * as update from './commands/update'
import * as gcal from './commands/gcal'
import * as relay from './commands/relay'
import * as chat from './commands/chat'
import * as docs from './commands/docs'
import * as memory from './commands/memory'
import * as theme from './commands/theme'
import * as feedback from './commands/feedback'

/** Merge order is load-bearing: a later group's key overwrites an earlier one. */
const GROUPS: { commands: CommandMap }[] = [
    file,
    note,
    search,
    graph,
    task,
    base,
    calendar,
    card,
    prop,
    settings,
    daemon,
    draw,
    serve,
    exportCmd,
    api,
    app,
    page,
    install,
    backends,
    doctor,
    checkpoint,
    update,
    gcal,
    relay,
    chat,
    docs,
    memory,
    theme,
    feedback,
]

export const registry: CommandMap = Object.assign(
    {},
    ...GROUPS.map(g => g.commands),
)

/** Longest-match a command phrase against the registry. Returns the matching registry key (three
 *  words, then two, then one), or null when the first words name no registered command. */
export function resolveCommand(words: string[]): string | null {
    if (words.length >= 3) {
        const three = `${words[0]} ${words[1]} ${words[2]}`
        if (registry[three]) return three
    }
    if (words.length >= 2) {
        const two = `${words[0]} ${words[1]}`
        if (registry[two]) return two
    }
    if (words.length >= 1 && registry[words[0]]) return words[0]
    return null
}
