// app/src/intro/introSlides.ts
// The first-run intro's slide content + the power-ups it offers. Plain data and pure helpers,
// no framework imports, so a test can load them (Solid components cannot mount under bun test).

export type SlideKey =
    | 'welcome'
    | 'theme'
    | 'graph'
    | 'daemon'
    | 'agents'
    | 'pickagent'
    | 'powerups'
    | 'name'
    | 'privacy'
    | 'obsidian'
    | 'chat'
    | 'settings'
    | 'begin'
export type SlideHero = 'wordmark' | 'daemon' | 'agents'
export type SlideExtra =
    | 'themes'
    | 'pickagent'
    | 'powerups'
    | 'name'
    | 'privacy'
    | 'obsidian'
    | 'samples'
    | 'cta'

export type Slide = {
    key: SlideKey
    /** Footer readout name. */
    label: string
    title: string
    body: string
    /** The body when the slide's content came back empty (the pick-an-agent slide, when no agent
     *  CLI was found on this machine). Absent: `body` always applies. */
    bodyEmpty?: string
    /** Art drawn in the art box (the graph slide is identified by its key). */
    hero?: SlideHero
    extra?: SlideExtra
    /** A power-up id (POWER_UPS): the slide shows only while that power-up is selected, since it
     *  describes something the power-up sets up. Absent: always shown. */
    requires?: string
}

export const SLIDES: Slide[] = [
    {
        key: 'welcome',
        label: 'welcome',
        title: 'Notes that think',
        body: 'Write notes and connect them with [[wikilinks]]. Bismuth links them into a graph you can explore and search.',
        hero: 'wordmark',
    },
    {
        key: 'theme',
        label: 'palette',
        title: 'Pick your palette',
        body: 'Choose a theme for your vault. You can change it anytime from settings.',
        extra: 'themes',
    },
    {
        key: 'graph',
        label: 'three brains',
        title: 'Three brains, one mind',
        body: "(1) You, (2) your notes, and (3) Bismuth's memory ",
    },
    {
        key: 'daemon',
        label: 'daemon',
        title: 'An agent that never sleeps',
        body: 'A background daemon runs on a schedule: consolidating memory, forging connections, and executing tasks.',
        hero: 'daemon',
    },
    {
        key: 'agents',
        label: 'agents',
        title: 'Bring your own agent',
        body: 'Daemon runs on whatever service you are already using: Claude Code, Codex, Gemini, opencode, Cline, Goose.',
        hero: 'agents',
    },
    {
        key: 'pickagent',
        label: 'agent',
        title: 'Pick an agent',
        body: 'Pick one you already have, or set up a free one.',
        bodyEmpty:
            'Chat runs on an agent on your machine. None is installed yet, so start with a free one.',
        extra: 'pickagent',
    },
    {
        key: 'powerups',
        label: 'power-ups',
        title: 'Optional power-ups',
        body: 'Pick what to set up. Bismuth turns them on once you open your vault, or you can do it anytime from the command palette.',
        extra: 'powerups',
    },
    {
        key: 'name',
        label: 'name',
        title: 'Name your daemon',
        body: 'It answers to this name in chat. Rename it anytime in .daemon/identity.md.',
        extra: 'name',
        requires: 'daemon',
    },
    {
        key: 'privacy',
        label: 'privacy',
        title: 'Pick your privacy',
        body: 'Everything starts off. Slide toward full to let your agents and the daemon do more, or flip each switch yourself. Change any of them later in .settings.',
        extra: 'privacy',
        requires: 'daemon',
    },
    {
        key: 'obsidian',
        label: 'obsidian',
        title: 'Coming from Obsidian?',
        body: 'Pick your Obsidian vault and Bismuth opens a converted copy beside it. Chat does the conversion through the Bismuth MCP and never touches the original.',
        extra: 'obsidian',
        requires: 'cli',
    },
    {
        key: 'chat',
        label: 'chat',
        title: 'Ask chat anything',
        body: 'Chat searches the Bismuth docs through the MCP, so ask it how anything works, or have it do the thing for you.',
        hero: 'agents',
        requires: 'cli',
    },
    {
        key: 'settings',
        label: 'settings',
        title: 'Settings are a file',
        body: "There is no settings screen: .settings opens in the editor like any note. A note's own properties live in its frontmatter, the YAML block at its top.",
        extra: 'samples',
    },
    {
        key: 'begin',
        label: 'open vault',
        title: 'Open your vault',
        body: '',
        hero: 'wordmark',
        extra: 'cta',
    },
]

/** Optional power-ups offered on the power-ups slide. `cmd` is a command-palette id; the chosen
 *  ones run via the SAME api the command palette uses, right after the vault opens (the intro
 *  itself has no backend). */
export type PowerUp = {
    id: string
    cmd: string
    icon: string
    name: string
    desc: string
}

export const POWER_UPS: PowerUp[] = [
    {
        id: 'daemon',
        cmd: 'daemon-setup',
        icon: 'Bot',
        name: 'daemon',
        desc: "A background agent that runs crons and weaves memory while you're away.",
    },
    {
        id: 'cli',
        cmd: 'bismuth-install',
        icon: 'SquareTerminal',
        name: 'cli + mcp',
        desc: 'Operate Bismuth from your terminal and chat.',
    },
]

/** Where a converted Obsidian vault goes: a sibling folder named `<source>-bismuth`, the target
 *  the conversion guide writes to. Trailing slashes are dropped; blank → ''. */
export function convertedVaultPath(source: string): string {
    const src = source.trim().replace(/[\\/]+$/, '')
    return src ? `${src}-bismuth` : ''
}

/** The daemon's name until the user types one; the same default the daemon seeds. */
export const DEFAULT_DAEMON_NAME = 'daemon'

/** The typed name, trimmed to one line; blank → DEFAULT_DAEMON_NAME. */
export function daemonName(typed: string): string {
    const name = typed.replace(/\s+/g, ' ').trim()
    return name || DEFAULT_DAEMON_NAME
}

/** The slides shown for this power-up selection, in table order: a slide whose `requires` names
 *  an unselected power-up is left out of paging and the footer count. */
export function visibleSlides(
    selected: readonly string[],
    slides: readonly Slide[] = SLIDES,
): Slide[] {
    return slides.filter(s => !s.requires || selected.includes(s.requires))
}

/** Only cli + mcp is on by default: the daemon reads and writes memory in the background, so it
 *  starts unchecked and the user opts in. Re-running a setup is idempotent, so leaving cli + mcp
 *  checked when it is already installed is safe. */
export const DEFAULT_POWERUPS: string[] = ['cli']

/** Selected ids → command-palette ids in POWER_UPS order; an unknown id is dropped. */
export function powerUpCommands(selected: string[]): string[] {
    return POWER_UPS.filter(p => selected.includes(p.id)).map(p => p.cmd)
}

export function togglePowerUp(selected: string[], id: string): string[] {
    return selected.includes(id)
        ? selected.filter(x => x !== id)
        : [...selected, id]
}

/** The slide's body: `bodyEmpty` when the slide has one and `empty` says nothing was found. */
export function slideBody(slide: Slide, empty: boolean): string {
    return empty && slide.bodyEmpty ? slide.bodyEmpty : slide.body
}
