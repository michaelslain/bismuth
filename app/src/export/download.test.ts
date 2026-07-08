// app/src/export/download.test.ts
// The delivery routing + verify-after-write logic, with the Tauri seam stubbed. The real
// plugin calls only run inside a webview; what's tested here is the part that was broken
// in the packaged app: success was reported without ever checking a file landed.
import { test, expect, describe } from "bun:test";
import { deliverFile, writeToFolder, type TauriDelivery } from "./download";

const BYTES = new Uint8Array([1, 2, 3]);

/** A stub seam over an in-memory "disk". */
function makeSeam(over: Partial<TauriDelivery> & { disk?: Set<string> } = {}) {
  const disk = over.disk ?? new Set<string>();
  const calls: string[] = [];
  const seam: TauriDelivery = {
    downloadDir: async () => "/Users/u/Downloads",
    join: async (dir, name) => `${dir}/${name}`,
    writeFile: async (p) => {
      calls.push(`write:${p}`);
      disk.add(p);
    },
    exists: async (p) => {
      calls.push(`exists:${p}`);
      return disk.has(p);
    },
    saveDialog: async () => {
      calls.push("saveDialog");
      return null;
    },
    ...over,
  };
  return { seam, disk, calls };
}

describe("deliverFile routing", () => {
  test("browser path (tauri: null) uses the injected browser download, never the fs seam", async () => {
    let browserCalls = 0;
    const r = await deliverFile("a.pdf", BYTES, "application/pdf", null, () => {
      browserCalls++;
    });
    expect(r).toEqual({ via: "browser" });
    expect(browserCalls).toBe(1);
  });

  test("tauri path writes to the Downloads dir, verifies existence, and returns the REAL path", async () => {
    const { seam, calls } = makeSeam();
    let browserCalls = 0;
    const r = await deliverFile("homework 2.pdf", BYTES, "application/pdf", seam, () => {
      browserCalls++;
    });
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Downloads/homework 2.pdf" });
    expect(browserCalls).toBe(0); // never falls through to the anchor path under Tauri
    expect(calls).toContain("write:/Users/u/Downloads/homework 2.pdf");
    expect(calls).toContain("exists:/Users/u/Downloads/homework 2.pdf"); // verified, not assumed
  });
});

describe("deliverFile verify-after-write (success only when the file provably exists)", () => {
  test("a write that RESOLVES but leaves no file is a failure -> falls back to the save dialog", async () => {
    // The packaged-app bug: writeFile resolved, nothing landed, toast lied. Simulate by
    // writing to nowhere (disk never updated) for the Downloads path only.
    const disk = new Set<string>();
    const { seam } = makeSeam({
      writeFile: async (p) => {
        if (p.startsWith("/Users/u/Downloads/")) return; // resolves, writes NOTHING
        disk.add(p); // the dialog-chosen path really writes
      },
      exists: async (p) => disk.has(p),
      saveDialog: async () => "/Users/u/Desktop/picked.pdf",
      disk,
    });
    const r = await deliverFile("a.pdf", BYTES, "application/pdf", seam);
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Desktop/picked.pdf" });
    expect(disk.has("/Users/u/Desktop/picked.pdf")).toBe(true);
  });

  test("a THROWING Downloads write falls back to the save dialog", async () => {
    const disk = new Set<string>();
    const { seam } = makeSeam({
      writeFile: async (p) => {
        if (p.includes("/Downloads/")) throw new Error("EPERM: operation not permitted");
        disk.add(p);
      },
      exists: async (p) => disk.has(p),
      saveDialog: async () => "/Users/u/Documents/a.pdf",
      disk,
    });
    const r = await deliverFile("a.pdf", BYTES, "application/pdf", seam);
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Documents/a.pdf" });
  });

  test("cancelled save dialog after a failed write THROWS (no silent success)", async () => {
    const { seam } = makeSeam({
      writeFile: async () => {
        throw new Error("EPERM");
      },
      saveDialog: async () => null, // user cancels
    });
    await expect(deliverFile("a.pdf", BYTES, "application/pdf", seam)).rejects.toThrow(/nothing was exported/);
  });

  test("fallback write that also fails verification THROWS with the attempted path", async () => {
    const { seam } = makeSeam({
      writeFile: async () => {}, // resolves but never lands anywhere
      exists: async () => false,
      saveDialog: async () => "/Users/u/Desktop/picked.pdf",
    });
    await expect(deliverFile("a.pdf", BYTES, "application/pdf", seam)).rejects.toThrow(
      /couldn't write \/Users\/u\/Desktop\/picked\.pdf/,
    );
  });
});

describe("writeToFolder verify-after-write", () => {
  test("returns the verified path on success", async () => {
    const { seam, disk } = makeSeam();
    const p = await writeToFolder("/Users/u/exports", "n.md", BYTES, seam);
    expect(p).toBe("/Users/u/exports/n.md");
    expect(disk.has(p)).toBe(true);
  });

  test("a resolved-but-missing write throws instead of returning a path", async () => {
    const { seam } = makeSeam({ writeFile: async () => {}, exists: async () => false });
    await expect(writeToFolder("/Users/u/exports", "n.md", BYTES, seam)).rejects.toThrow(
      /write reported success but no file exists/,
    );
  });

  test("a throwing write surfaces the target path in the error", async () => {
    const { seam } = makeSeam({
      writeFile: async () => {
        throw new Error("forbidden path");
      },
    });
    await expect(writeToFolder("/Users/u/exports", "n.md", BYTES, seam)).rejects.toThrow(
      /couldn't write \/Users\/u\/exports\/n\.md: forbidden path/,
    );
  });
});
