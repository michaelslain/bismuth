// The staged bundle/macos/Bismuth.app is what Spotlight indexes as a SECOND Bismuth
// (github issue #4). It is only safe to delete once the dmg — built FROM it — exists.
import { describe, expect, it } from "bun:test";
import { stagedAppToRemove } from "./postbuildClean";

const APP = "/repo/app/src-tauri/target/release/bundle/macos/Bismuth.app";

describe("stagedAppToRemove", () => {
  it("removes the staged app once a dmg exists", () => {
    expect(stagedAppToRemove({ dmgExists: true, appPath: APP, appExists: true })).toBe(APP);
  });

  it("keeps the staged app when no dmg was produced — it is the only installable artifact", () => {
    expect(stagedAppToRemove({ dmgExists: false, appPath: APP, appExists: true })).toBeNull();
  });

  it("returns null when there is no staged app to remove", () => {
    expect(stagedAppToRemove({ dmgExists: true, appPath: APP, appExists: false })).toBeNull();
  });

  it("returns null when the build produced nothing at all", () => {
    expect(stagedAppToRemove({ dmgExists: false, appPath: APP, appExists: false })).toBeNull();
  });
});
