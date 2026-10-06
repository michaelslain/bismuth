import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { MACHINE_DIR } from './config.ts'
import { atomicWriteJson } from './atomicJson.ts'
import { getDeviceId, getDeviceLabel } from './device.ts'

/**
 * Multi-device ownership coordination (SHARED INTEGRATION CONTRACT v1).
 *
 * State files under <home> (default ~/.bismuth/daemon):
 *  - devices.json: { "<deviceId>": { label, lastSeenISO }, ... }
 *      Every daemon UPSERTS its own entry each tick (heartbeat), even when idle.
 *  - owner.json:   { ownerDeviceId, ownerLabel, updatedAt }
 *      ABSENT file = UNCLAIMED => legacy behavior (daemon runs normally).
 *
 * isOwner(): owner.json absent => true; else ownerDeviceId === thisDeviceId.
 *
 * All functions accept an optional `home` dir for test injection; production
 * callers omit it and use MACHINE_DIR.
 */

export interface DeviceEntry {
    label: string
    lastSeenISO: string
}

export type DevicesFile = Record<string, DeviceEntry>

export interface Owner {
    ownerDeviceId: string
    ownerLabel: string
    updatedAt: string
}

function devicesPath(home: string): string {
    return join(home, 'devices.json')
}

function ownerPath(home: string): string {
    return join(home, 'owner.json')
}

async function readDevices(home: string): Promise<DevicesFile> {
    try {
        const raw = await readFile(devicesPath(home), 'utf-8')
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object'
            ? (parsed as DevicesFile)
            : {}
    } catch {
        return {}
    }
}

/**
 * Read owner.json. Returns null when the file is absent (UNCLAIMED) or
 * unreadable/malformed — both cases mean "no explicit owner".
 */
export async function getOwner(
    home: string = MACHINE_DIR,
): Promise<Owner | null> {
    try {
        const raw = await readFile(ownerPath(home), 'utf-8')
        const parsed = JSON.parse(raw)
        if (
            parsed &&
            typeof parsed === 'object' &&
            typeof parsed.ownerDeviceId === 'string'
        ) {
            return parsed as Owner
        }
        return null
    } catch {
        return null
    }
}

/**
 * Upsert this device's entry into devices.json with a fresh lastSeenISO.
 * Called every tick — the device stays selectable even when idle / not owner.
 */
export async function heartbeatDevice(
    home: string = MACHINE_DIR,
): Promise<void> {
    const [deviceId, devices] = await Promise.all([
        getDeviceId(home),
        readDevices(home),
    ])
    devices[deviceId] = {
        label: getDeviceLabel(),
        lastSeenISO: new Date().toISOString(),
    }
    await atomicWriteJson(devicesPath(home), devices, { ensureDir: true })
}

/**
 * True when this device may run normally:
 *  - owner.json absent (UNCLAIMED) => true (legacy / single-device behavior)
 *  - else ownerDeviceId === thisDeviceId
 */
export async function isOwner(home: string = MACHINE_DIR): Promise<boolean> {
    const owner = await getOwner(home)
    if (!owner) return true
    const thisId = await getDeviceId(home)
    return owner.ownerDeviceId === thisId
}
