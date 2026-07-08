// app/src/export/download.test.ts
// The delivery routing + verify-after-write logic, with the Tauri seam stubbed. The real
// plugin calls only run inside a webview; what's tested here is the part that was broken
// in the packaged app: success was reported without ever checking a file landed.
import { test, expect, describe } from "bun:test";
import { deliverFile, writeToFolder, splitExtension, type TauriDelivery } from "./download";

const BYTES = new Uint8Array([1, 2, 3]);

/** A stub seam over an in-memory "disk". */
function makeSeam(over: Partial<TauriDelivery> & { disk?: Set<string> } = {}) {
  const disk = over.disk ?? new Set<string>();
  const calls: string[] = [];
  const revealed: string[] = [];
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
    reveal: async (p) => {
      calls.push(`reveal:${p}`);
      revealed.push(p);
    },
    ...over,
  };
  return { seam, disk, calls, revealed };
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
    const { seam, calls, revealed } = makeSeam();
    let browserCalls = 0;
    const r = await deliverFile("homework 2.pdf", BYTES, "application/pdf", seam, () => {
      browserCalls++;
    });
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Downloads/homework 2.pdf", verified: true });
    expect(browserCalls).toBe(0); // never falls through to the anchor path under Tauri
    expect(calls).toContain("write:/Users/u/Downloads/homework 2.pdf");
    expect(calls).toContain("exists:/Users/u/Downloads/homework 2.pdf"); // verified, not assumed
    expect(revealed).toEqual(["/Users/u/Downloads/homework 2.pdf"]); // taken straight to the file in Finder
  });
});

describe("deliverFile reveal-in-Finder (best-effort, at the delivery seam)", () => {
  test("reveals the delivered Downloads path by default", async () => {
    const { seam, revealed } = makeSeam();
    await deliverFile("a.pdf", BYTES, "application/pdf", seam);
    expect(revealed).toEqual(["/Users/u/Downloads/a.pdf"]);
  });

  test("reveals the Save-dialog-chosen path when Downloads fails", async () => {
    const disk = new Set<string>();
    const { seam, revealed } = makeSeam({
      writeFile: async (p) => {
        if (p.includes("/Downloads/")) throw new Error("EPERM");
        disk.add(p);
      },
      exists: async (p) => disk.has(p),
      saveDialog: async () => "/Users/u/Desktop/picked.pdf",
      disk,
    });
    await deliverFile("a.pdf", BYTES, "application/pdf", seam);
    expect(revealed).toEqual(["/Users/u/Desktop/picked.pdf"]); // reveal follows the file to wherever it landed
  });

  test("reveal=false suppresses the Finder reveal (multi-file loop reveals only the first)", async () => {
    const { seam, revealed } = makeSeam();
    const r = await deliverFile("a-2.png", BYTES, "image/png", seam, undefined, false);
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Downloads/a-2.png", verified: true });
    expect(revealed).toEqual([]); // no reveal for the non-first file
  });

  test("a THROWING reveal never fails the export — the file is already written", async () => {
    const { seam } = makeSeam({
      reveal: async () => {
        throw new Error("opener not available");
      },
    });
    const r = await deliverFile("a.pdf", BYTES, "application/pdf", seam);
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Downloads/a.pdf", verified: true });
  });
});

describe("deliverFile verify-edge hardening (write-threw vs exists-threw)", () => {
  test("exists() THROWING after a resolved Downloads write reports UNVERIFIED success, not a Save dialog", async () => {
    // The old-binary edge: fs.writeFile lands the file but fs.exists throws because the
    // fs:allow-exists capability is missing. The write succeeded — we must NOT fall back to
    // the Save dialog just because we couldn't confirm.
    let saveDialogCalls = 0;
    const { seam } = makeSeam({
      writeFile: async () => {}, // resolves (file really landed in the real OS)
      exists: async () => {
        throw new Error("fs.exists not permitted (no fs:allow-exists)");
      },
      saveDialog: async () => {
        saveDialogCalls++;
        return "/Users/u/Desktop/should-not-be-used.pdf";
      },
    });
    const r = await deliverFile("a.pdf", BYTES, "application/pdf", seam);
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Downloads/a.pdf", verified: false });
    expect(saveDialogCalls).toBe(0); // a resolved write is NOT downgraded to the fallback
  });

  test("a write that RESOLVES but exists() proves absent STILL falls back (the packaged-app lie)", async () => {
    // Distinct from the throw case: exists() RETURNS false, so the file provably isn't there.
    let saveDialogCalls = 0;
    const disk = new Set<string>();
    const { seam } = makeSeam({
      writeFile: async (p) => {
        if (p.startsWith("/Users/u/Downloads/")) return; // resolves, writes NOTHING
        disk.add(p);
      },
      exists: async (p) => disk.has(p),
      saveDialog: async () => {
        saveDialogCalls++;
        return "/Users/u/Desktop/picked.pdf";
      },
      disk,
    });
    const r = await deliverFile("a.pdf", BYTES, "application/pdf", seam);
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Desktop/picked.pdf", verified: true });
    expect(saveDialogCalls).toBe(1); // a provably-missing write DOES fall back
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
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Desktop/picked.pdf", verified: true });
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
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Documents/a.pdf", verified: true });
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

describe("splitExtension (Finder-style base/ext split)", () => {
  test("splits a normal extension", () => {
    expect(splitExtension("homework 2.pdf")).toEqual({ base: "homework 2", ext: ".pdf" });
  });
  test("no extension → empty ext", () => {
    expect(splitExtension("myfile")).toEqual({ base: "myfile", ext: "" });
  });
  test("dotted name splits only on the LAST dot", () => {
    expect(splitExtension("my.note.md")).toEqual({ base: "my.note", ext: ".md" });
  });
  test("a leading-dot hidden file is not treated as an extension", () => {
    expect(splitExtension(".gitignore")).toEqual({ base: ".gitignore", ext: "" });
  });
});

describe("deliverFile Downloads de-dup (Finder-style collision rename)", () => {
  test("free target → writes the base name (no rename)", async () => {
    const { seam, revealed } = makeSeam(); // empty disk
    const r = await deliverFile("homework 2.pdf", BYTES, "application/pdf", seam);
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Downloads/homework 2.pdf", verified: true });
    expect(revealed).toEqual(["/Users/u/Downloads/homework 2.pdf"]);
  });

  test("target exists → renames to '(1)' and reveals the (1) path", async () => {
    const disk = new Set(["/Users/u/Downloads/homework 2.pdf"]);
    const { seam, revealed } = makeSeam({ disk });
    const r = await deliverFile("homework 2.pdf", BYTES, "application/pdf", seam);
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Downloads/homework 2 (1).pdf", verified: true });
    expect(revealed).toEqual(["/Users/u/Downloads/homework 2 (1).pdf"]); // reveal follows the final name
    expect(disk.has("/Users/u/Downloads/homework 2.pdf")).toBe(true); // the original was NOT overwritten
    expect(disk.has("/Users/u/Downloads/homework 2 (1).pdf")).toBe(true); // the new file landed
  });

  test("base and '(1)' both exist → renames to '(2)'", async () => {
    const disk = new Set([
      "/Users/u/Downloads/homework 2.pdf",
      "/Users/u/Downloads/homework 2 (1).pdf",
    ]);
    const { seam } = makeSeam({ disk });
    const r = await deliverFile("homework 2.pdf", BYTES, "application/pdf", seam);
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Downloads/homework 2 (2).pdf", verified: true });
  });

  test("no-extension name de-dups as 'name (1)' (ext stays empty)", async () => {
    const disk = new Set(["/Users/u/Downloads/myfile"]);
    const { seam } = makeSeam({ disk });
    const r = await deliverFile("myfile", BYTES, "text/plain", seam);
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Downloads/myfile (1)", verified: true });
  });

  test("dotted name de-dups on the LAST dot: 'my.note.md' → 'my.note (1).md'", async () => {
    const disk = new Set(["/Users/u/Downloads/my.note.md"]);
    const { seam } = makeSeam({ disk });
    const r = await deliverFile("my.note.md", BYTES, "text/markdown", seam);
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Downloads/my.note (1).md", verified: true });
  });

  test("exists() throwing during the collision probe falls back to the base name (old binary, no dedup)", async () => {
    // An old binary lacking fs:allow-exists can't probe collisions. We must NOT loop or crash —
    // just write the base name (the pre-dedup behavior), which the verified write reports UNVERIFIED.
    let saveDialogCalls = 0;
    const { seam } = makeSeam({
      writeFile: async () => {}, // resolves; the file really lands in the real OS
      exists: async () => {
        throw new Error("no fs:allow-exists");
      },
      saveDialog: async () => {
        saveDialogCalls++;
        return null;
      },
    });
    const r = await deliverFile("homework 2.pdf", BYTES, "application/pdf", seam);
    expect(r).toEqual({ via: "tauri", path: "/Users/u/Downloads/homework 2.pdf", verified: false });
    expect(saveDialogCalls).toBe(0); // never downgraded to the Save dialog
  });
});

describe("writeToFolder de-dup (Finder-style collision rename)", () => {
  test("collision in the output folder renames to '(1)' and reveals the final path", async () => {
    const disk = new Set(["/Users/u/exports/n.md"]);
    const { seam, revealed } = makeSeam({ disk });
    const p = await writeToFolder("/Users/u/exports", "n.md", BYTES, seam);
    expect(p).toBe("/Users/u/exports/n (1).md");
    expect(revealed).toEqual(["/Users/u/exports/n (1).md"]);
    expect(disk.has("/Users/u/exports/n.md")).toBe(true); // original preserved, not overwritten
  });
});

describe("writeToFolder verify-after-write", () => {
  test("returns the verified path on success and reveals it", async () => {
    const { seam, disk, revealed } = makeSeam();
    const p = await writeToFolder("/Users/u/exports", "n.md", BYTES, seam);
    expect(p).toBe("/Users/u/exports/n.md");
    expect(disk.has(p)).toBe(true);
    expect(revealed).toEqual(["/Users/u/exports/n.md"]);
  });

  test("reveal=false suppresses the Finder reveal", async () => {
    const { seam, revealed } = makeSeam();
    await writeToFolder("/Users/u/exports", "n.md", BYTES, seam, false);
    expect(revealed).toEqual([]);
  });

  test("a resolved-but-missing write throws instead of returning a path", async () => {
    const { seam } = makeSeam({ writeFile: async () => {}, exists: async () => false });
    await expect(writeToFolder("/Users/u/exports", "n.md", BYTES, seam)).rejects.toThrow(
      /write reported success but no file exists/,
    );
  });

  test("exists() THROWING (missing capability) still returns the path — write resolved", async () => {
    const { seam } = makeSeam({
      writeFile: async () => {},
      exists: async () => {
        throw new Error("fs.exists not permitted");
      },
    });
    const p = await writeToFolder("/Users/u/exports", "n.md", BYTES, seam);
    expect(p).toBe("/Users/u/exports/n.md"); // couldn't verify, but the write didn't fail
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
