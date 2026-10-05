import { describe, test, expect } from 'bun:test'
import {
    existsSync,
    lstatSync,
    mkdirSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { legacySection } from '../../src/doctor/sections/legacy'
import type { DoctorContext, Finding } from '../../src/doctor/types'
import { CLAUDE_BOT_UNIT, serviceUnitPath } from '../../src/serviceUnit'
import { fakeCtx } from './fakeCtx'

const check = (ctx: DoctorContext) => legacySection.check(ctx)
const find = async (ctx: DoctorContext, id: string): Promise<Finding> => {
    const f = (await check(ctx)).find(x => x.id === id)
    if (!f) throw new Error(`no finding ${id}`)
    return f
}
const skills = (ctx: DoctorContext) => join(ctx.claudeDir, 'skills')
const touch = (path: string, text = 'x') => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
}

describe('legacy section', () => {
    test('an empty home yields nothing', async () => {
        expect(await check(fakeCtx())).toEqual([])
    })

    test('a dangling old-home skill link yields legacy.skill-link:<id>, applied twice', async () => {
        const ctx = fakeCtx()
        mkdirSync(skills(ctx), { recursive: true })
        const link = join(skills(ctx), 'authoring-bismuth-bases')
        symlinkSync('/Users/old/.bismuth/skills/authoring-bismuth-bases', link)
        const f = await find(ctx, 'legacy.skill-link:authoring-bismuth-bases')
        expect(f.severity).toBe('warn')
        expect(f.repair?.risk).toBe('safe')
        expect(await f.repair!.apply()).toEqual([])
        expect(lstatSync(link, { throwIfNoEntry: false })).toBeUndefined()
        expect(await f.repair!.apply()).toEqual([])
        expect(await check(ctx)).toEqual([])
    })

    test('a foreign link or a real directory with a legacy id is left alone', async () => {
        const ctx = fakeCtx()
        mkdirSync(skills(ctx), { recursive: true })
        symlinkSync(
            '/Users/x/proj/.bismuth-notes/skills/authoring-bismuth-bases',
            join(skills(ctx), 'authoring-bismuth-bases'),
        )
        mkdirSync(join(skills(ctx), 'converting-bismuth-to-obsidian'))
        expect(await check(ctx)).toEqual([])
    })

    test('a relative skill link resolving to an old-home path elsewhere is legacy, shown resolved', async () => {
        const ctx = fakeCtx()
        mkdirSync(skills(ctx), { recursive: true })
        const link = join(skills(ctx), 'authoring-bismuth-bases')
        // <home>/.claude/skills/../../../old/... = <tmp>/old/.bismuth/skills/<id>, outside ctx.home.
        symlinkSync(
            '../../../old/.bismuth/skills/authoring-bismuth-bases',
            link,
        )
        const f = await find(ctx, 'legacy.skill-link:authoring-bismuth-bases')
        expect(f.detail).toContain(
            resolve(ctx.home, '../old/.bismuth/skills/authoring-bismuth-bases'),
        )
        expect(f.detail).not.toContain('../')
        expect(await f.repair!.apply()).toEqual([])
        expect(lstatSync(link, { throwIfNoEntry: false })).toBeUndefined()
    })

    test('<bismuthHome>/skills yields legacy.skills-dir, applied', async () => {
        const ctx = fakeCtx()
        touch(join(ctx.bismuthHome, 'skills', 'a', 'SKILL.md'))
        const f = await find(ctx, 'legacy.skills-dir')
        expect(f.repair?.risk).toBe('safe')
        expect(await f.repair!.apply()).toEqual([])
        expect(existsSync(join(ctx.bismuthHome, 'skills'))).toBe(false)
        expect(await f.repair!.apply()).toEqual([])
        expect(await check(ctx)).toEqual([])
    })

    test('a claude-bot plist yields legacy.claude-bot-service, destructive; apply removes it', async () => {
        const calls: string[][] = []
        const ctx = fakeCtx({
            exec: async argv => {
                calls.push(argv)
                return { code: 0, stdout: '', stderr: '' }
            },
        })
        const plist = serviceUnitPath('darwin', ctx.home, CLAUDE_BOT_UNIT)!
        touch(plist)
        const f = await find(ctx, 'legacy.claude-bot-service')
        expect(f.severity).toBe('warn')
        expect(f.repair?.risk).toBe('destructive')
        expect(await f.repair!.apply()).toEqual([])
        expect(existsSync(plist)).toBe(false)
        expect(calls[0].slice(0, 2)).toEqual(['launchctl', 'unload'])
        expect(await f.repair!.apply()).toEqual([])
        expect(await check(ctx)).toEqual([])
    })

    test('a linux claude-bot unit is found at the systemd path', async () => {
        const ctx = fakeCtx({ platform: 'linux' })
        touch(serviceUnitPath('linux', ctx.home, CLAUDE_BOT_UNIT)!)
        const f = await find(ctx, 'legacy.claude-bot-service')
        expect(await f.repair!.apply()).toEqual([])
        expect(await check(ctx)).toEqual([])
    })

    test('<bismuthHome>/claude-bot yields legacy.claude-bot-clone, destructive; apply', async () => {
        const ctx = fakeCtx()
        touch(join(ctx.bismuthHome, 'claude-bot', '.git', 'HEAD'))
        const f = await find(ctx, 'legacy.claude-bot-clone')
        expect(f.severity).toBe('info')
        expect(f.repair?.risk).toBe('destructive')
        expect(await f.repair!.apply()).toEqual([])
        expect(await f.repair!.apply()).toEqual([])
        expect(await check(ctx)).toEqual([])
    })

    test('~/.claude-bot without a marker is a warn with no repair', async () => {
        const ctx = fakeCtx()
        touch(join(ctx.home, '.claude-bot', 'memory', 'a.md'))
        const f = await find(ctx, 'legacy.claude-bot-home')
        expect(f.severity).toBe('warn')
        expect(f.repair).toBeUndefined()
    })

    test('~/.claude-bot with the marker is info + destructive; apply', async () => {
        const ctx = fakeCtx()
        touch(join(ctx.home, '.claude-bot', 'memory', 'a.md'))
        const vault = join(ctx.home, 'vault')
        mkdirSync(join(vault, '.daemon', 'memory'), { recursive: true })
        touch(join(ctx.bismuthHome, 'daemon', '.claude-bot-migrated'), vault)
        const f = await find(ctx, 'legacy.claude-bot-home')
        expect(f.severity).toBe('info')
        expect(f.repair?.risk).toBe('destructive')
        expect(await f.repair!.apply()).toEqual([])
        expect(existsSync(join(ctx.home, '.claude-bot'))).toBe(false)
        expect(await f.repair!.apply()).toEqual([])
        expect(await check(ctx)).toEqual([])
    })

    test('a marker naming a missing vault warns and offers no delete', async () => {
        const ctx = fakeCtx()
        touch(join(ctx.home, '.claude-bot', 'memory', 'a.md'))
        touch(
            join(ctx.bismuthHome, 'daemon', '.claude-bot-migrated'),
            join(ctx.home, 'gone-vault'),
        )
        const f = await find(ctx, 'legacy.claude-bot-home')
        expect(f.severity).toBe('warn')
        expect(f.title).toBe('claude-bot memory not found in a migrated vault')
        expect(f.detail).toContain(join(ctx.home, 'gone-vault', '.daemon'))
        expect(f.repair).toBeUndefined()
    })

    test('a marker naming a vault with no .daemon warns and offers no delete', async () => {
        const ctx = fakeCtx()
        touch(join(ctx.home, '.claude-bot', 'memory', 'a.md'))
        const vault = join(ctx.home, 'vault')
        mkdirSync(vault)
        touch(join(ctx.bismuthHome, 'daemon', '.claude-bot-migrated'), vault)
        const f = await find(ctx, 'legacy.claude-bot-home')
        expect(f.severity).toBe('warn')
        expect(f.repair).toBeUndefined()
    })

    test('a marker naming a vault whose .daemon lacks memory warns and offers no delete', async () => {
        const ctx = fakeCtx()
        touch(join(ctx.home, '.claude-bot', 'memory', 'a.md'))
        const vault = join(ctx.home, 'vault')
        mkdirSync(join(vault, '.daemon'), { recursive: true })
        touch(join(ctx.bismuthHome, 'daemon', '.claude-bot-migrated'), vault)
        const f = await find(ctx, 'legacy.claude-bot-home')
        expect(f.severity).toBe('warn')
        expect(f.repair).toBeUndefined()
        expect(existsSync(join(ctx.home, '.claude-bot', 'memory'))).toBe(true)
    })

    test('a marker with an old home whose rewrite onto ctx.home holds .daemon offers the delete', async () => {
        const ctx = fakeCtx()
        touch(join(ctx.home, '.claude-bot', 'memory', 'a.md'))
        mkdirSync(join(ctx.home, 'vault', '.daemon', 'memory'), {
            recursive: true,
        })
        touch(
            join(ctx.bismuthHome, 'daemon', '.claude-bot-migrated'),
            '/Users/old/vault\n',
        )
        const f = await find(ctx, 'legacy.claude-bot-home')
        expect(f.severity).toBe('info')
        expect(f.repair?.risk).toBe('destructive')
        expect(await f.repair!.apply()).toEqual([])
        expect(existsSync(join(ctx.home, '.claude-bot'))).toBe(false)
    })

    test('a marker whose path does not exist yields legacy.claude-bot-marker-old-home', async () => {
        const ctx = fakeCtx()
        touch(
            join(ctx.bismuthHome, 'daemon', '.claude-bot-migrated'),
            '/Users/old/vault\n',
        )
        const f = await find(ctx, 'legacy.claude-bot-marker-old-home')
        expect(f.severity).toBe('info')
        expect(f.repair).toBeUndefined()
        expect(f.detail).toContain('/Users/old/vault')
    })

    test('a marker whose path exists reports nothing', async () => {
        const ctx = fakeCtx()
        touch(join(ctx.bismuthHome, 'daemon', '.claude-bot-migrated'), ctx.home)
        expect(await check(ctx)).toEqual([])
    })

    test('com.michael.obsidian dirs yield legacy.obsidian-bundle-dirs, destructive; apply', async () => {
        const ctx = fakeCtx()
        const caches = join(
            ctx.home,
            'Library',
            'Caches',
            'com.michael.obsidian',
        )
        const pref = join(
            ctx.home,
            'Library',
            'Preferences',
            'com.michael.obsidian.plist',
        )
        touch(join(caches, 'blob'))
        touch(pref)
        touch(join(ctx.home, 'Library', 'Caches', 'com.other.app', 'keep'))
        const f = await find(ctx, 'legacy.obsidian-bundle-dirs')
        expect(f.severity).toBe('info')
        expect(f.repair?.risk).toBe('destructive')
        expect(await f.repair!.apply()).toEqual([])
        expect(existsSync(caches)).toBe(false)
        expect(existsSync(pref)).toBe(false)
        expect(
            existsSync(join(ctx.home, 'Library', 'Caches', 'com.other.app')),
        ).toBe(true)
        expect(await f.repair!.apply()).toEqual([])
        expect(await check(ctx)).toEqual([])
    })

    test('<bismuthHome>/sandboxes yields legacy.sandboxes info and no repair', async () => {
        const ctx = fakeCtx()
        touch(join(ctx.bismuthHome, 'sandboxes', 's1', 'f'))
        const f = await find(ctx, 'legacy.sandboxes')
        expect(f.severity).toBe('info')
        expect(f.repair).toBeUndefined()
    })
})
