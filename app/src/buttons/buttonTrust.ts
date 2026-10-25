// Per-device memory of which button texts the user already approved ("run this?" / "send this?").
// Keyed by the full action key (type + model + timeout + text); storage failures read as untrusted and never throw.
import { readArray, writeCache } from '../viewCache'

const KEY = 'bismuth.buttonTrust.v2'
export const TRUST_CAP = 500

const isKey = (x: unknown): x is string => typeof x === 'string'

export function isTrusted(key: string): boolean {
    try {
        return readArray(KEY, isKey).includes(key)
    } catch {
        return false
    }
}

export function trust(key: string): void {
    try {
        
        const next = readArray(KEY, isKey).filter(x => x !== key)
        next.push(key)
        writeCache(KEY, next.slice(-TRUST_CAP))
    } catch {
        // storage unavailable — the text simply asks again next time
    }
}
