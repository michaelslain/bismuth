// core/src/daemon.ts
// Bismuth's read/write window onto the claude-bot daemon's shared state files.
// Bismuth runs on the SAME machine as the claude-bot daemon, so it reads and
// writes the same on-disk files under the claude-bot home dir (default
// ~/.claude-bot, overridable via OA_CLAUDEBOT_HOME). The files are authored by
// claude-bot; Bismuth only writes owner.json (the owner-device selection).
//
// Shared integration contract (kept byte-compatible with what claude-bot reads):
//   <home>/device-id   — a stable UUID for THIS machine.
//   <home>/devices.json = { "<deviceId>": { "label", "lastSeenISO" }, ... }
//   <home>/owner.json   = { ownerDeviceId, ownerLabel, updatedAt }  (ABSENT = unclaimed)
//   <home>/daemon.pid   — the running daemon's pid (presence + liveness => running).
//
// Every function tolerates missing/malformed files and NEVER throws (a daemon
// that has never run yet, or a partially-written file, degrades to empty/null).
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

// Optional home override fed from settings.yaml (daemon.home) by server.ts. The
// OA_CLAUDEBOT_HOME env var still wins (ops/dev override), per the integration
// contract; this fills in when the env var is absent.
let homeOverride = "";

/** Set the settings-driven home override (empty/whitespace clears it). */
export function setClaudeBotHomeOverride(home: string | null | undefined): void {
  homeOverride = (home ?? "").trim();
}

/** Resolved claude-bot home dir: OA_CLAUDEBOT_HOME env, else the settings override, else ~/.claude-bot. */
export function claudeBotHome(): string {
  return process.env.OA_CLAUDEBOT_HOME || homeOverride || join(homedir(), ".claude-bot");
}

export interface Owner {
  ownerDeviceId: string;
  ownerLabel: string;
  updatedAt: string;
}

export interface DeviceEntry {
  deviceId: string;
  label: string;
  lastSeenISO: string;
  isOwner: boolean;
  isThis: boolean;
}

export interface DeviceList {
  devices: DeviceEntry[];
  ownerDeviceId: string | null;
}

export interface DaemonStatus {
  running: boolean;
  thisDeviceId: string | null;
  owner: Owner | null;
}

/** Read + JSON-parse a file under <home>, returning null on any failure. */
function readJson<T>(name: string): T | null {
  try {
    const raw = readFileSync(join(claudeBotHome(), name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** This machine's stable device id (from <home>/device-id), or null if absent. */
export function thisDeviceId(): string | null {
  try {
    const raw = readFileSync(join(claudeBotHome(), "device-id"), "utf8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** The current owner (owner.json), or null when unclaimed / unreadable. */
export function getOwner(): Owner | null {
  const o = readJson<Partial<Owner>>("owner.json");
  if (!o || typeof o.ownerDeviceId !== "string" || o.ownerDeviceId.length === 0) return null;
  return {
    ownerDeviceId: o.ownerDeviceId,
    ownerLabel: typeof o.ownerLabel === "string" ? o.ownerLabel : "",
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "",
  };
}

/** True when an integer pid is alive (process.kill(pid, 0) doesn't throw). */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Daemon liveness: <home>/daemon.pid exists AND that pid is alive. */
export function daemonStatus(): DaemonStatus {
  let running = false;
  try {
    const raw = readFileSync(join(claudeBotHome(), "daemon.pid"), "utf8").trim();
    running = pidAlive(Number(raw));
  } catch {
    running = false;
  }
  return { running, thisDeviceId: thisDeviceId(), owner: getOwner() };
}

/** All heartbeating devices (devices.json), each flagged owner/this. */
export function listDevices(): DeviceList {
  const owner = getOwner();
  const ownerDeviceId = owner?.ownerDeviceId ?? null;
  const me = thisDeviceId();
  const raw = readJson<Record<string, { label?: unknown; lastSeenISO?: unknown }>>("devices.json");
  const devices: DeviceEntry[] = [];
  if (raw && typeof raw === "object") {
    for (const [deviceId, info] of Object.entries(raw)) {
      if (!info || typeof info !== "object") continue;
      devices.push({
        deviceId,
        label: typeof info.label === "string" ? info.label : "",
        lastSeenISO: typeof info.lastSeenISO === "string" ? info.lastSeenISO : "",
        isOwner: deviceId === ownerDeviceId,
        isThis: deviceId === me,
      });
    }
  }
  return { devices, ownerDeviceId };
}

/**
 * Claim a device as the owner: write owner.json with that device's label (looked
 * up in devices.json). Byte-compatible with what claude-bot reads — a plain object
 * with exactly { ownerDeviceId, ownerLabel, updatedAt }. Throws (via the caller's
 * mutating handler) if the deviceId isn't a known, heartbeating device.
 */
export function setOwner(deviceId: string): Owner {
  const { devices } = listDevices();
  const match = devices.find((d) => d.deviceId === deviceId);
  if (!match) {
    throw new Error(`unknown device: ${deviceId}`);
  }
  const owner: Owner = {
    ownerDeviceId: deviceId,
    ownerLabel: match.label,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(claudeBotHome(), "owner.json"), JSON.stringify(owner, null, 2));
  return owner;
}
