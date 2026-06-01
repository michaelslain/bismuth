import { describe, expect, it } from "bun:test";
import { bindCommands, type CommandHandlers } from "./commands";

function noopHandlers(): { handlers: CommandHandlers; calls: string[] } {
  const calls: string[] = [];
  const handlers: CommandHandlers = {
    openSettings: () => calls.push("settings"),
    openTerminal: () => calls.push("terminal"),
    newNote: () => calls.push("new-note"),
    newFolder: () => calls.push("new-folder"),
    setMode: (m) => calls.push(`mode:${m}`),
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
});
