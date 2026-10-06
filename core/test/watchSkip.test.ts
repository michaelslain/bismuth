import { test, expect } from 'bun:test'
import {
    isHidden,
    isWatchIgnored,
    isSystemFolderPath,
    isDaemonMemoryPath,
    isDaemonMemoryNoise,
    skipWatchWalk,
} from '../src/watchSkip'

test('isHidden: a dot-prefixed first or inner segment', () => {
    expect(isHidden('.git')).toBe(true)
    expect(isHidden('notes/.trash')).toBe(true)
    expect(isHidden('notes/a.md')).toBe(false)
})

test('isWatchIgnored: hidden paths and the DAEMON.md heartbeat, nothing else', () => {
    expect(isWatchIgnored('.git/HEAD')).toBe(true)
    expect(isWatchIgnored('DAEMON.md')).toBe(true)
    expect(isWatchIgnored('sub/DAEMON.md')).toBe(true)
    expect(isWatchIgnored('NOT-DAEMON.md')).toBe(false)
    expect(isWatchIgnored('a.md')).toBe(false)
})

test('daemon memory: the brain and its subfolders are meaningful, dot-segments below it are noise', () => {
    expect(isSystemFolderPath('.daemon/crons/x.md')).toBe(true)
    expect(isSystemFolderPath('.themes/a.yaml')).toBe(false)
    expect(isDaemonMemoryPath('.daemon/memory')).toBe(true)
    expect(isDaemonMemoryPath('.daemon/memory/a.md')).toBe(true)
    expect(isDaemonMemoryPath('.daemon/memoryx')).toBe(false)
    expect(isDaemonMemoryNoise('.daemon/memory')).toBe(false)
    expect(isDaemonMemoryNoise('.daemon/memory/topic/a.md')).toBe(false)
    expect(isDaemonMemoryNoise('.daemon/memory/.git')).toBe(true)
    expect(isDaemonMemoryNoise('.daemon/memory/topic/.DS_Store')).toBe(true)
})

test('skipWatchWalk: hidden dirs are skipped except .daemon, .themes and their ordinary children', () => {
    // skipped
    expect(skipWatchWalk('.git')).toBe(true)
    expect(skipWatchWalk('.trash')).toBe(true)
    expect(skipWatchWalk('notes/.hidden')).toBe(true)
    expect(skipWatchWalk('.daemon/memory/.git')).toBe(true)
    // walked: the .themes catch-up, the system folder, plain folders
    expect(skipWatchWalk('.themes')).toBe(false)
    expect(skipWatchWalk('.daemon')).toBe(false)
    expect(skipWatchWalk('.daemon/crons')).toBe(false)
    expect(skipWatchWalk('.daemon/memory')).toBe(false)
    expect(skipWatchWalk('notes')).toBe(false)
    expect(skipWatchWalk('notes/sub')).toBe(false)
})
