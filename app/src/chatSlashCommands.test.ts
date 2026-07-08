// app/src/chatSlashCommands.test.ts
import { describe, it, expect } from "bun:test";
import { parseChatSlashCommand } from "./chatSlashCommands";

describe("parseChatSlashCommand", () => {
  it("parses `/rename <name>`", () => {
    expect(parseChatSlashCommand("/rename Planning")).toEqual({ kind: "rename", name: "Planning" });
  });
  it("keeps a multi-word rename name", () => {
    expect(parseChatSlashCommand("/rename Q3 Planning Sync")).toEqual({ kind: "rename", name: "Q3 Planning Sync" });
  });
  it("`/rename` with no arg → empty name (caller reverts to auto label)", () => {
    expect(parseChatSlashCommand("/rename")).toEqual({ kind: "rename", name: "" });
  });
  it("parses `/color <token>` keeping the raw arg (caller resolves it)", () => {
    expect(parseChatSlashCommand("/color blue")).toEqual({ kind: "color", arg: "blue" });
    expect(parseChatSlashCommand("/color #ffcc00")).toEqual({ kind: "color", arg: "#ffcc00" });
  });
  it("`/colour` (British spelling) also parses as color", () => {
    expect(parseChatSlashCommand("/colour green")).toEqual({ kind: "color", arg: "green" });
  });
  it("is case-insensitive on the command word", () => {
    expect(parseChatSlashCommand("/RENAME Foo")).toEqual({ kind: "rename", name: "Foo" });
  });
  it("trims surrounding whitespace", () => {
    expect(parseChatSlashCommand("  /rename  Foo  ")).toEqual({ kind: "rename", name: "Foo" });
  });
  it("returns null for a non-local command (falls through to the model)", () => {
    expect(parseChatSlashCommand("/compact")).toBeNull();
    expect(parseChatSlashCommand("/mcp")).toBeNull();
  });
  it("returns null for plain prose", () => {
    expect(parseChatSlashCommand("rename this chat please")).toBeNull();
    expect(parseChatSlashCommand("")).toBeNull();
  });
});
