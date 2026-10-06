// The merged `bismuth` command registry, split out of index.ts so the binary and the skill drift
// test (cli/test/skillCommands.test.ts) share ONE registry and ONE matcher. `resolveCommand` is the
// longest-match rule the dispatcher uses: a three-word phrase ("daemon cron toggle") first, then a
// two-word phrase ("task toggle"), then a one-word command ("graph").
import type { CommandMap } from './types'
import { commands as fileCmds } from './commands/file'
import { commands as noteCmds } from './commands/note'
import { commands as searchCmds } from './commands/search'
import { commands as graphCmds } from './commands/graph'
import { commands as taskCmds } from './commands/task'
import { commands as baseCmds } from './commands/base'
import { commands as calendarCmds } from './commands/calendar'
import { commands as cardCmds } from './commands/card'
import { commands as propCmds } from './commands/prop'
import { commands as settingsCmds } from './commands/settings'
import { commands as daemonCmds } from './commands/daemon'
import { commands as drawCmds } from './commands/draw'
import { commands as serveCmds } from './commands/serve'
import { commands as exportCmds } from './commands/export'
import { commands as apiCmds } from './commands/api'
import { commands as appCmds } from './commands/app'
import { commands as pageCmds } from './commands/page'
import { commands as installCmds } from './commands/install'
import { commands as backendsCmds } from './commands/backends'
import { commands as doctorCmds } from './commands/doctor'
import { commands as checkpointCmds } from './commands/checkpoint'
import { commands as updateCmds } from './commands/update'
import { commands as gcalCmds } from './commands/gcal'
import { commands as relayCmds } from './commands/relay'
import { commands as chatCmds } from './commands/chat'
import { commands as docsCmds } from './commands/docs'
import { commands as memoryCmds } from './commands/memory'
import { commands as themeCmds } from './commands/theme'
export const registry: CommandMap = {
    ...fileCmds,
    ...noteCmds,
    ...searchCmds,
    ...graphCmds,
    ...taskCmds,
    ...baseCmds,
    ...calendarCmds,
    ...cardCmds,
    ...propCmds,
    ...settingsCmds,
    ...daemonCmds,
    ...drawCmds,
    ...serveCmds,
    ...exportCmds,
    ...apiCmds,
    ...appCmds,
    ...pageCmds,
    ...installCmds,
    ...backendsCmds,
    ...doctorCmds,
    ...checkpointCmds,
    ...updateCmds,
    ...gcalCmds,
    ...relayCmds,
    ...chatCmds,
    ...docsCmds,
    ...memoryCmds,
    ...themeCmds,
}

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
