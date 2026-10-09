import { describe, expect, it } from 'bun:test'
import {
    DEFAULT_POWERUPS,
    POWER_UPS,
    SLIDES,
    powerUpCommands,
    slideBody,
    togglePowerUp,
} from './introSlides'

describe('SLIDES', () => {
    it('has the eight slides in order', () => {
        expect(SLIDES.map(s => s.key)).toEqual([
            'welcome',
            'theme',
            'graph',
            'daemon',
            'agents',
            'pickagent',
            'powerups',
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
        expect(SLIDES[7].title).toBe('Open your vault')
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
    it('defaults to both on', () => {
        expect(DEFAULT_POWERUPS).toEqual(['daemon', 'cli'])
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
