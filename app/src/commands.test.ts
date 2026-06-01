import { describe, expect, it } from "bun:test";
import { bindCommands, resolveButtonCommands, type CommandHandlers } from "./commands";

function noopHandlers(): { handlers: CommandHandlers; calls: string[] } {
  const calls: string[] = [];
  const handlers: CommandHandlers = {
    openSettings: () => calls.push("settings"),
    openTerminal: () => calls.push("terminal"),
    newNote: () => calls.push("new-note"),
    newFolder: () => calls.push("new-folder"),
    setMode: (m) => calls.push(`mode:${m}`),
    openDailyNote: (id) => calls.push(`daily:${id}`),
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

  it("registers a daily-note:<id> command per config", () => {
    const { handlers, calls } = noopHandlers();
    const map = bindCommands(handlers, [
      { id: "journal", label: "Journal", icon: "BookOpen", folder: "Journal", fileName: "{{date}} journal", template: "" },
    ]);
    const cmd = map.get("daily-note:journal");
    expect(cmd?.label).toBe("Journal");
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
