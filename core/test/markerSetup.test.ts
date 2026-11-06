import { afterEach, beforeEach, expect, test } from 'bun:test'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './helpers'
import { markerStatus, setMarkerSetupSteps, startMarkerSetup, toolsDir, type MarkerSetupSteps } from '../src/markerSetup'
import { findTool } from '../src/marker'

// A machine with nothing installed: HOME and the tools dir are empty temp dirs and PATH holds no
// engine. (The fixed Homebrew dirs are still searched, so llama-server may be found there.)
const saved = { HOME: process.env.HOME, PATH: process.env.PATH, TOOLS: process.env.BISMUTH_TOOLS_DIR }
beforeEach(() => {
    process.env.HOME = tempDir('marker-home-')
    process.env.PATH = '/usr/bin:/bin'
    process.env.BISMUTH_TOOLS_DIR = tempDir('marker-tools-')
})
afterEach(() => {
    setMarkerSetupSteps(null)
    process.env.HOME = saved.HOME
    process.env.PATH = saved.PATH
    if (saved.TOOLS === undefined) delete process.env.BISMUTH_TOOLS_DIR
    else process.env.BISMUTH_TOOLS_DIR = saved.TOOLS
})

const fakeBin = (dir: string, name: string) => {
    const p = join(dir, name)
    writeFileSync(p, '#!/bin/sh\n')
    chmodSync(p, 0o755)
}

const settle = async () => {
    for (let i = 0; i < 50 && markerStatus().job.state === 'running'; i++) await new Promise(r => setTimeout(r, 10))
}

test('an install runs, in order, the steps whose program is missing, into the tools dir, and Marker is then found', async () => {
    const order: string[] = []
    const steps: MarkerSetupSteps = {
        uv: async dirs => (order.push('uv'), join(dirs.bin, 'uv')),
        marker: async (uv, dirs) => {
            order.push(`marker with ${uv.split('/').pop()}`)
            fakeBin(dirs.bin, 'marker_single')
        },
        llama: async dirs => {
            order.push('llama')
            fakeBin(dirs.bin, 'llama-server')
        },
    }
    setMarkerSetupSteps(steps)
    expect(markerStatus().missing).toContain('marker_single')
    // uv and llama-server may already be on this machine (Homebrew); a found program is not installed again
    const want = [...(findTool('uv') ? [] : ['uv']), 'marker with uv', ...(findTool('llama-server') ? [] : ['llama'])]
    expect(startMarkerSetup('darwin')).toMatchObject({ state: 'running' })
    await settle()
    expect(order).toEqual(want)
    expect(markerStatus()).toMatchObject({ installed: true, missing: [], job: { state: 'done' } })
    expect(toolsDir()).toBe(process.env.BISMUTH_TOOLS_DIR!)
})

test('a failed step stops the install and names the step and why', async () => {
    setMarkerSetupSteps({
        uv: async () => 'uv',
        marker: async () => {
            throw new Error('no network')
        },
        llama: async () => {
            throw new Error('never reached')
        },
    })
    startMarkerSetup('darwin')
    await settle()
    expect(markerStatus().job).toEqual({ state: 'failed', step: 'marker', error: 'no network' })
})

test('a second start while installing answers the running job; an installed Marker answers done', async () => {
    let release = () => {}
    setMarkerSetupSteps({
        uv: async dirs => join(dirs.bin, 'uv'),
        marker: (_uv, dirs) =>
            new Promise<void>(r => {
                release = () => {
                    fakeBin(dirs.bin, 'marker_single')
                    r()
                }
            }),
        llama: async dirs => fakeBin(dirs.bin, 'llama-server'),
    })
    const first = startMarkerSetup('darwin')
    expect(startMarkerSetup('darwin')).toBe(first)
    for (let i = 0; i < 50 && markerStatus().job.state === 'running' && (markerStatus().job as { step: string }).step !== 'marker'; i++)
        await new Promise(r => setTimeout(r, 10))
    expect(startMarkerSetup('darwin').state).toBe('running')
    release()
    await settle()
    expect(startMarkerSetup('darwin').state).toBe('done')
})

test('off a Mac the install fails at once with what to install by hand', () => {
    setMarkerSetupSteps({ uv: async () => 'uv', marker: async () => {}, llama: async () => {} })
    const s = startMarkerSetup('linux')
    expect(s).toMatchObject({ state: 'failed' })
    expect((s as { error: string }).error).toContain('marker-pdf')
})
