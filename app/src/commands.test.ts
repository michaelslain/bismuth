import { describe, expect, it } from "bun:test";
import { bindCommands, resolveButtonCommands, ensureEmojiLibrary, type CommandHandlers, type ToolbarButton } from "./commands";

function noopHandlers(): { handlers: CommandHandlers; calls: string[] } {
  const calls: string[] = [];
  const handlers: CommandHandlers = {
    openSettings: () => calls.push("settings"),
    openTerminal: () => calls.push("terminal"),
    newNote: () => calls.push("new-note"),
    newFolder: () => calls.push("new-folder"),
    newBase: () => calls.push("new-base"),
    openCreateMenu: () => calls.push("create-menu"),
    setMode: (m) => calls.push(`mode:${m}`),
    openDailyNote: (id) => calls.push(`daily:${id}`),
    openFolder: () => calls.push("open-folder"),
    newWindow: () => calls.push("new-window"),
    exportActive: () => calls.push("export"),
  };
  return { handlers, calls };
}

describe("bindCommands", () => {
  it("binds every catalog id to a runnable action", () => {
    const { handlers } = noopHandlers();
    const map = bindCommands(handlers);
    expect(map.get("terminal")?.label).toBe("Open Terminal");
    expect(map.get("graph-both")?.icon).toBe("Network");
    expect(map.get("nope")).toBeUndefined();
  });

  it("runs the matching handler for each command", () => {
    const { handlers, calls } = noopHandlers();
    const map = bindCommands(handlers);
    map.get("new-note")!.action();
    map.get("graph-2nd")!.action();
    map.get("settings")!.action();
    expect(calls).toEqual(["new-note", "mode:2nd", "settings"]);
  });

  it("binds the create commands (new-base + create-menu '+')", () => {
    const { handlers, calls } = noopHandlers();
    const map = bindCommands(handlers);
    expect(map.get("new-base")?.label).toBe("New base");
    expect(map.get("new-base")?.icon).toBe("Database");
    expect(map.get("create-menu")?.icon).toBe("Plus");
    map.get("new-base")!.action();
    map.get("create-menu")!.action();
    expect(calls).toEqual(["new-base", "create-menu"]);
  });

  it("binds the file-menu commands (open-folder / new-window / export)", () => {
    const { handlers, calls } = noopHandlers();
    const map = bindCommands(handlers);
    expect(map.get("open-folder")?.label).toBe("Open folder…");
    expect(map.get("new-window")?.icon).toBe("AppWindow");
    map.get("open-folder")!.action();
    map.get("new-window")!.action();
    map.get("export")!.action();
    expect(calls).toEqual(["open-folder", "new-window", "export"]);
  });

  it("registers a daily-note:<id> command per config", () => {
    const { handlers, calls } = noopHandlers();
    const map = bindCommands(handlers, [
      { id: "journal", label: "Journal", icon: "BookOpen", folder: "Journal", fileName: "{{date}} journal", template: "" },
    ]);
    const cmd = map.get("daily-note:journal");
    expect(cmd?.label).toBe("Create Daily Note: Journal");
    expect(cmd?.icon).toBe("BookOpen");
    cmd!.action();
    expect(calls).toEqual(["daily:journal"]);
  });
});

describe("resolveButtonCommands", () => {
  const { handlers } = noopHandlers();
  const map = bindCommands(handlers);

  it("resolves a single `command` to one bound command", () => {
    const out = resolveButtonCommands({ command: "new-note" }, map);
    expect(out.map((c) => c.id)).toEqual(["new-note"]);
  });

  it("resolves a `commands` list in order", () => {
    const out = resolveButtonCommands({ commands: ["new-note", "terminal"] }, map);
    expect(out.map((c) => c.id)).toEqual(["new-note", "terminal"]);
  });

  it("lets `commands` win when both keys are present", () => {
    const out = resolveButtonCommands(
      { command: "settings", commands: ["new-note", "terminal"] },
      map,
    );
    expect(out.map((c) => c.id)).toEqual(["new-note", "terminal"]);
  });

  it("silently skips unknown ids, keeping the resolvable subset in order", () => {
    const out = resolveButtonCommands({ commands: ["new-note", "nope", "terminal"] }, map);
    expect(out.map((c) => c.id)).toEqual(["new-note", "terminal"]);
  });

  it("returns [] for an unknown single command", () => {
    expect(resolveButtonCommands({ command: "nope" }, map)).toEqual([]);
  });

  it("returns [] for an empty commands list", () => {
    expect(resolveButtonCommands({ commands: [] }, map)).toEqual([]);
  });

  it("falls back to `command` when `commands` is present but empty", () => {
    // Precedence is "non-empty commands wins, else command" — an empty list is not a win.
    const out = resolveButtonCommands({ command: "new-note", commands: [] }, map);
    expect(out.map((c) => c.id)).toEqual(["new-note"]);
  });

  it("returns [] when neither key is present", () => {
    expect(resolveButtonCommands({}, map)).toEqual([]);
  });
});

describe("ensureEmojiLibrary", () => {
  const ids = (bar: ToolbarButton[]) => bar.map((b) => b.command ?? b.commands?.join("+"));

  it("inserts emoji-library immediately to the LEFT of create-menu when absent (custom toolbar)", () => {
    // A custom toolbar with NO emoji-library — the exact case that made the icon "not even visible".
    const custom: ToolbarButton[] = [
      { command: "create-menu", icon: "Plus" },
      { command: "search", icon: "Search" },
      { command: "settings", icon: "Settings" },
    ];
    const out = ensureEmojiLibrary(custom);
    expect(ids(out)).toEqual(["emoji-library", "create-menu", "search", "settings"]);
    // The emoji button carries the Smile icon.
    expect(out[0]).toEqual({ command: "emoji-library", icon: "Smile" });
  });

  it("prepends emoji-library to the front when there is no create-menu", () => {
    const custom: ToolbarButton[] = [
      { command: "search", icon: "Search" },
      { command: "graph-2nd", icon: "Circle" },
    ];
    expect(ids(ensureEmojiLibrary(custom))).toEqual(["emoji-library", "search", "graph-2nd"]);
  });

  it("leaves the toolbar untouched when it already has emoji-library (respects user position)", () => {
    const custom: ToolbarButton[] = [
      { command: "search", icon: "Search" },
      { command: "emoji-library", icon: "Smile" },
      { command: "create-menu", icon: "Plus" },
    ];
    const out = ensureEmojiLibrary(custom);
    expect(out).toBe(custom); // same reference — no copy/insert
  });

  it("detects emoji-library referenced inside a `commands` list too (no duplicate)", () => {
    const custom: ToolbarButton[] = [
      { commands: ["emoji-library", "settings"], icon: "Smile" },
      { command: "create-menu", icon: "Plus" },
    ];
    expect(ensureEmojiLibrary(custom)).toBe(custom);
  });

  it("does not mutate the input array", () => {
    const custom: ToolbarButton[] = [{ command: "create-menu", icon: "Plus" }];
    const copy = [...custom];
    ensureEmojiLibrary(custom);
    expect(custom).toEqual(copy);
  });
});
