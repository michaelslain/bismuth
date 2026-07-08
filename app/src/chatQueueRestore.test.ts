import { describe, expect, test } from "bun:test";
import { restoreQueuedComposerState } from "./chatQueueRestore";

describe("restoreQueuedComposerState", () => {
  test("no queued turns: passes the current draft/attachments through unchanged", () => {
    const result = restoreQueuedComposerState([], { text: "hello", images: ["a"] });
    expect(result).toEqual({ text: "hello", images: ["a"] });
  });

  test("one queued turn, empty draft: the queued text becomes the draft", () => {
    const result = restoreQueuedComposerState([{ text: "follow-up", images: [] }], { text: "", images: [] });
    expect(result.text).toBe("follow-up");
  });

  test("multiple queued turns join oldest-first, separated by a blank line", () => {
    const result = restoreQueuedComposerState(
      [
        { text: "first queued", images: [] },
        { text: "second queued", images: [] },
      ],
      { text: "", images: [] },
    );
    expect(result.text).toBe("first queued\n\nsecond queued");
  });

  test("an in-progress draft is preserved, with restored text prepended above it", () => {
    const result = restoreQueuedComposerState([{ text: "queued one", images: [] }], { text: "still typing this", images: [] });
    expect(result.text).toBe("queued one\n\nstill typing this");
  });

  test("image attachments from queued turns are prepended ahead of the current attachments, oldest first", () => {
    const result = restoreQueuedComposerState(
      [
        { text: "a", images: ["q1a", "q1b"] },
        { text: "b", images: ["q2a"] },
      ],
      { text: "", images: ["draft-img"] },
    );
    expect(result.images).toEqual(["q1a", "q1b", "q2a", "draft-img"]);
  });

  test("an image-only queued turn (blank text) still restores its images without polluting the draft text", () => {
    const result = restoreQueuedComposerState([{ text: "", images: ["only-image"] }], { text: "typing…", images: [] });
    expect(result.text).toBe("typing…");
    expect(result.images).toEqual(["only-image"]);
  });

  test("whitespace-only queued text is dropped, not turned into a stray blank line", () => {
    const result = restoreQueuedComposerState(
      [
        { text: "   ", images: [] },
        { text: "real text", images: [] },
      ],
      { text: "", images: [] },
    );
    expect(result.text).toBe("real text");
  });
});
