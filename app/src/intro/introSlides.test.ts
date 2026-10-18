import { describe, expect, it } from 'bun:test'
import {
    DEFAULT_DAEMON_NAME,
    DEFAULT_POWERUPS,
    POWER_UPS,
    SLIDES,
    convertedVaultPath,
    daemonName,
    powerUpCommands,
    slideBody,
    togglePowerUp,
    visibleSlides,
} from './introSlides'

describe('SLIDES', () => {
    it('has the thirteen slides in order', () => {
        expect(SLIDES.map(s => s.key)).toEqual([
            'welcome',
            'theme',
            'graph',
            'daemon',
            'agents',
            'pickagent',
            'powerups',
            'name',
            'privacy',
            'obsidian',
            'chat',
            'settings',
            'begin',
        ])
    })
    it('carries no layout, graph or corner key: every slide shares one window geometry', () => {
        for (const s of SLIDES) {
            expect('layout' in s).toBe(false)
            expect('graph' in s).toBe(false)
            expect('corner' in s).toBe(false)
        }
    })
    it('carries today heroes and extras', () => {
        const by = Object.fromEntries(SLIDES.map(s => [s.key, s]))
        expect(by.welcome.hero).toBe('wordmark')
        expect(by.daemon.hero).toBe('daemon')
        expect(by.agents.hero).toBe('agents')
        expect(by.begin.hero).toBe('wordmark')
        expect(by.theme.extra).toBe('themes')
        expect(by.powerups.extra).toBe('powerups')
        expect(by.begin.extra).toBe('cta')
        expect(by.name.extra).toBe('name')
        expect(by.privacy.extra).toBe('privacy')
        expect(by.privacy.requires).toBe('daemon')
        expect(by.obsidian.extra).toBe('obsidian')
        expect(by.chat.hero).toBe('agents')
        expect(by.settings.extra).toBe('samples')
    })
    it('pins every title and body', () => {
        expect(SLIDES.map(s => [s.key, s.title, s.body])).toEqual([
            [
                'welcome',
                'Notes that think',
                'Write notes and connect them with [[wikilinks]]. Bismuth links them into a graph you can explore and search.',
            ],
            [
                'theme',
                'Pick your palette',
                'Choose a theme for your vault. You can change it anytime from settings.',
            ],
            [
                'graph',
                'Three brains, one mind',
                "(1) You, (2) your notes, and (3) Bismuth's memory ",
            ],
            [
                'daemon',
                'An agent that never sleeps',
                'A background daemon runs on a schedule: consolidating memory, forging connections, and executing tasks.',
            ],
            [
                'agents',
                'Bring your own agent',
                'Daemon runs on whatever service you are already using: Claude Code, Codex, Gemini, opencode, Cline, Goose.',
            ],
            [
                'pickagent',
                'Pick an agent',
                'Pick one you already have, or set up a free one.',
            ],
            [
                'powerups',
                'Optional power-ups',
                'Pick what to set up. Bismuth turns them on once you open your vault, or you can do it anytime from the command palette.',
            ],
            [
                'name',
                'Name your daemon',
                'It answers to this name in chat. Rename it anytime in .daemon/identity.md.',
            ],
            [
                'privacy',
                'Pick your privacy',
                'Everything starts off. Slide toward full to let your agents and the daemon do more, or flip each switch yourself. Change any of them later in .settings.',
            ],
            [
                'obsidian',
                'Coming from Obsidian?',
                'Pick your Obsidian vault and Bismuth opens a converted copy beside it. Chat does the conversion through the Bismuth MCP and never touches the original.',
            ],
            [
                'chat',
                'Ask chat anything',
                'Chat searches the Bismuth docs through the MCP, so ask it how anything works, or have it do the thing for you.',
            ],
            [
                'settings',
                'Settings are a file',
                "There is no settings screen: .settings opens in the editor like any note. A note's own properties live in its frontmatter, the YAML block at its top.",
            ],
            [
                'begin',
                'Open your vault',
                '',
            ],
        ])
    })
    it('labels every slide for the footer readout', () => {
        expect(SLIDES.map(s => s.label)).toEqual([
            'welcome',
            'palette',
            'three brains',
            'daemon',
            'agents',
            'agent',
            'power-ups',
            'name',
            'privacy',
            'obsidian',
            'chat',
            'settings',
            'open vault',
        ])
    })
    it('sets sentence-case titles without a trailing period', () => {
        expect(SLIDES.map(s => s.title)).toEqual([
            'Notes that think',
            'Pick your palette',
            'Three brains, one mind',
            'An agent that never sleeps',
            'Bring your own agent',
            'Pick an agent',
            'Optional power-ups',
            'Name your daemon',
            'Pick your privacy',
            'Coming from Obsidian?',
            'Ask chat anything',
            'Settings are a file',
            'Open your vault',
        ])
        for (const s of SLIDES) expect(s.title.endsWith('.')).toBe(false)
    })
    it('has no all-caps run in a title, label or power-up name', () => {
        const texts = [
            ...SLIDES.flatMap(s => [s.title, s.label]),
            ...POWER_UPS.map(p => p.name),
        ]
        for (const t of texts) expect(/[A-Z]{2,}/.test(t)).toBe(false)
    })
    it('keeps the authored copy', () => {
        expect(SLIDES[0].title).toBe('Notes that think')
        expect(SLIDES[SLIDES.length - 1].title).toBe('Open your vault')
        expect(SLIDES.every(s => s.title)).toBe(true)
    })
})

describe('slideBody', () => {
    const pick = SLIDES.find(s => s.key === 'pickagent')!
    it('says none is installed only when the slide has that wording and nothing was found', () => {
        expect(slideBody(pick, true)).toBe(
            'Chat runs on an agent on your machine. None is installed yet, so start with a free one.',
        )
        expect(slideBody(pick, false)).toBe(pick.body)
        const theme = SLIDES.find(s => s.key === 'theme')!
        expect(slideBody(theme, true)).toBe(theme.body)
    })
    it('the pick-an-agent slide renders the agent picker', () => {
        expect(pick.extra).toBe('pickagent')
    })
})

describe('power-ups', () => {
    it('defaults to cli + mcp on only', () => {
        expect(DEFAULT_POWERUPS).toEqual(['cli'])
        expect(POWER_UPS.map(p => p.id)).toEqual(['daemon', 'cli'])
        expect(POWER_UPS.map(p => p.name)).toEqual(['daemon', 'cli + mcp'])
    })
    it('maps ids to commands in POWER_UPS order, dropping unknowns', () => {
        expect(powerUpCommands(['cli', 'daemon', 'free-agent', 'x'])).toEqual([
            'daemon-setup',
            'bismuth-install',
        ])
        expect(powerUpCommands([])).toEqual([])
    })
    it('toggles an id on and off', () => {
        expect(togglePowerUp(['daemon'], 'cli')).toEqual(['daemon', 'cli'])
        expect(togglePowerUp(['daemon', 'cli'], 'daemon')).toEqual(['cli'])
    })
})

describe('visibleSlides', () => {
    const keys = (selected: string[]) => visibleSlides(selected).map(s => s.key)
    it('shows every slide with both power-ups on', () => {
        expect(keys(['daemon', 'cli'])).toEqual(SLIDES.map(s => s.key))
    })
    it('drops the name slide without the daemon', () => {
        expect(keys(['cli'])).not.toContain('name')
        expect(keys(['cli'])).toContain('obsidian')
    })
    it('places privacy right after name, and drops it without the daemon', () => {
        const k = keys(['daemon', 'cli'])
        expect(k[k.indexOf('name') + 1]).toBe('privacy')
        expect(keys(['cli'])).not.toContain('privacy')
        expect(keys(['daemon'])).toContain('privacy')
    })
    it('drops the obsidian and chat slides without cli + mcp', () => {
        const k = keys(['daemon'])
        expect(k).not.toContain('obsidian')
        expect(k).not.toContain('chat')
        expect(k).toContain('name')
    })
    it('always keeps the slides that require nothing, in table order', () => {
        expect(keys([])).toEqual([
            'welcome',
            'theme',
            'graph',
            'daemon',
            'agents',
            'pickagent',
            'powerups',
            'settings',
            'begin',
        ])
    })
    it('every requires names a real power-up', () => {
        const ids = POWER_UPS.map(p => p.id)
        for (const s of SLIDES) if (s.requires) expect(ids).toContain(s.requires)
    })
})

describe('daemonName', () => {
    it('trims and collapses whitespace to one line', () => {
        expect(daemonName('  ada\n lovelace ')).toBe('ada lovelace')
    })
    it('falls back to the seeded default when blank', () => {
        expect(daemonName('   ')).toBe(DEFAULT_DAEMON_NAME)
        expect(DEFAULT_DAEMON_NAME).toBe('daemon')
    })
})

describe('convertedVaultPath', () => {
    it('is the sibling `<source>-bismuth`, trailing slashes dropped', () => {
        expect(convertedVaultPath('/a/Notes')).toBe('/a/Notes-bismuth')
        expect(convertedVaultPath(' /a/Notes/ ')).toBe('/a/Notes-bismuth')
        expect(convertedVaultPath('~/vault')).toBe('~/vault-bismuth')
    })
    it('is empty for a blank source', () => {
        expect(convertedVaultPath('  ')).toBe('')
    })
})
