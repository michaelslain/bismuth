// app/src/api.settings.test.ts
import { describe, expect, it, afterEach } from "bun:test";
import { api } from "./api";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe("api.settings", () => {
  it("GETs /settings and returns the parsed JSON object", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string) => {
      calledUrl = url;
      return new Response(JSON.stringify({ appearance: { accent: "#abc" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const out = await api.settings();
    expect(calledUrl).toBe("http://localhost:4321/settings");
    expect((out.appearance as Record<string, unknown>).accent).toBe("#abc");
  });
});
