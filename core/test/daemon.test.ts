// core/test/daemon.test.ts
// Unit-tests core/src/daemon.ts against a TEMP OA_CLAUDEBOT_HOME. Each test points
// OA_CLAUDEBOT_HOME at a fresh tmp dir and writes fake state files (device-id /
// devices.json / owner.json), then asserts the contract-exact shapes.
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDevices, getOwner, setOwner, thisDeviceId, daemonStatus } from "../src/daemon";

const created: string[] = [];

/** Make a tmp claude-bot home, point OA_CLAUDEBOT_HOME at it, and return the path. */
function makeHome(files: Record<string, string>): string {
  const home = mkdtempSync(join(tmpdir(), "claude-bot-"));
  created.push(home);
  process.env.OA_CLAUDEBOT_HOME = home;
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(home, name), contents);
  }
  return home;
}

afterEach(() => {
  delete process.env.OA_CLAUDEBOT_HOME;
  for (const home of created.splice(0)) {
    try { rmSync(home, { recursive: true, force: true }); } catch { /* */ }
  }
});

test("missing files: everything degrades to empty/null, never throws", () => {
  makeHome({}); // empty home — no device-id, no devices.json, no owner.json
  expect(thisDeviceId()).toBeNull();
  expect(getOwner()).toBeNull();
  expect(listDevices()).toEqual({ devices: [], ownerDeviceId: null });
  const status = daemonStatus();
  expect(status.running).toBe(false);
  expect(status.thisDeviceId).toBeNull();
  expect(status.owner).toBeNull();
});

test("listDevices reads devices.json and flags owner + this device", () => {
  makeHome({
    "device-id": "dev-a\n",
    "devices.json": JSON.stringify({
      "dev-a": { label: "laptop", lastSeenISO: "2026-06-01T00:00:00.000Z" },
      "dev-b": { label: "desktop", lastSeenISO: "2026-06-02T00:00:00.000Z" },
    }),
    "owner.json": JSON.stringify({
      ownerDeviceId: "dev-b",
      ownerLabel: "desktop",
      updatedAt: "2026-06-02T00:00:00.000Z",
    }),
  });

  const { devices, ownerDeviceId } = listDevices();
  expect(ownerDeviceId).toBe("dev-b");
  expect(devices).toContainEqual({
    deviceId: "dev-a",
    label: "laptop",
    lastSeenISO: "2026-06-01T00:00:00.000Z",
    isOwner: false,
    isThis: true,
  });
  expect(devices).toContainEqual({
    deviceId: "dev-b",
    label: "desktop",
    lastSeenISO: "2026-06-02T00:00:00.000Z",
    isOwner: true,
    isThis: false,
  });
});

test("getOwner returns the parsed owner.json, null when absent", () => {
  makeHome({
    "owner.json": JSON.stringify({
      ownerDeviceId: "dev-x",
      ownerLabel: "the-mac",
      updatedAt: "2026-06-03T12:00:00.000Z",
    }),
  });
  expect(getOwner()).toEqual({
    ownerDeviceId: "dev-x",
    ownerLabel: "the-mac",
    updatedAt: "2026-06-03T12:00:00.000Z",
  });
});

test("setOwner round-trips and writes a contract-exact owner.json", () => {
  const home = makeHome({
    "device-id": "dev-a",
    "devices.json": JSON.stringify({
      "dev-a": { label: "laptop", lastSeenISO: "2026-06-01T00:00:00.000Z" },
      "dev-b": { label: "desktop", lastSeenISO: "2026-06-02T00:00:00.000Z" },
    }),
  });

  const owner = setOwner("dev-b");
  // Return value: exactly the contract keys, label looked up from devices.json.
  expect(owner.ownerDeviceId).toBe("dev-b");
  expect(owner.ownerLabel).toBe("desktop");
  expect(typeof owner.updatedAt).toBe("string");
  expect(Number.isNaN(Date.parse(owner.updatedAt))).toBe(false);

  // On disk: owner.json parses back to exactly { ownerDeviceId, ownerLabel, updatedAt }.
  const onDisk = JSON.parse(readFileSync(join(home, "owner.json"), "utf8"));
  expect(Object.keys(onDisk).sort()).toEqual(["ownerDeviceId", "ownerLabel", "updatedAt"]);
  expect(onDisk).toEqual(owner);

  // And the file is now what getOwner / listDevices read.
  expect(getOwner()).toEqual(owner);
  const { ownerDeviceId, devices } = listDevices();
  expect(ownerDeviceId).toBe("dev-b");
  expect(devices.find((d) => d.deviceId === "dev-b")?.isOwner).toBe(true);
});

test("setOwner rejects an unknown device", () => {
  makeHome({
    "devices.json": JSON.stringify({
      "dev-a": { label: "laptop", lastSeenISO: "2026-06-01T00:00:00.000Z" },
    }),
  });
  expect(() => setOwner("nope")).toThrow();
});

test("daemonStatus reports running when daemon.pid holds a live pid", () => {
  makeHome({
    "device-id": "dev-a",
    "daemon.pid": String(process.pid), // this test process is, by definition, alive
  });
  const status = daemonStatus();
  expect(status.running).toBe(true);
  expect(status.thisDeviceId).toBe("dev-a");
});

test("daemonStatus reports not running for a dead pid", () => {
  makeHome({
    // pid 1 exists, but use a very high pid that's almost certainly free instead.
    "daemon.pid": "2147483646",
  });
  expect(daemonStatus().running).toBe(false);
});
