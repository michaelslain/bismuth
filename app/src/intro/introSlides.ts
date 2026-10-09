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
    | 'begin'
export type SlideHero = 'wordmark' | 'daemon' | 'agents'
export type SlideExtra = 'themes' | 'pickagent' | 'powerups' | 'cta'

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

/** All on by default. Re-running their setup is idempotent, so it is safe to leave them checked
 *  even when already installed (CLI+MCP re-syncs on boot, daemon auto-updates on launch). */
export const DEFAULT_POWERUPS: string[] = ['daemon', 'cli']

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
