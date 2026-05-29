import { test, expect } from "bun:test";
import { createSseRegistry, formatEvent } from "../src/sse";

test("formatEvent produces a valid SSE data frame", () => {
  expect(formatEvent({ version: 7 })).toBe(`data: {"version":7}\n\n`);
});

test("publish enqueues the formatted frame to every subscriber", () => {
  const reg = createSseRegistry();
  const enqueued: string[] = [];
  const ctrl = {
    enqueue: (chunk: Uint8Array) => enqueued.push(new TextDecoder().decode(chunk)),
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  reg.subscribe(ctrl);
  reg.publish({ version: 3 });
  reg.publish({ version: 4 });
  expect(enqueued).toEqual([`data: {"version":3}\n\n`, `data: {"version":4}\n\n`]);
});

test("unsubscribe stops further deliveries to that controller", () => {
  const reg = createSseRegistry();
  const enqueued: string[] = [];
  const ctrl = {
    enqueue: (chunk: Uint8Array) => enqueued.push(new TextDecoder().decode(chunk)),
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  reg.subscribe(ctrl);
  reg.unsubscribe(ctrl);
  reg.publish({ version: 9 });
  expect(enqueued).toEqual([]);
});

test("publish swallows errors from a single broken controller", () => {
  const reg = createSseRegistry();
  const good: string[] = [];
  const broken = {
    enqueue: () => { throw new Error("boom"); },
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  const goodCtrl = {
    enqueue: (chunk: Uint8Array) => good.push(new TextDecoder().decode(chunk)),
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  reg.subscribe(broken);
  reg.subscribe(goodCtrl);
  reg.publish({ version: 5 });
  expect(reg.size()).toBe(1);
  expect(good).toEqual([`data: {"version":5}\n\n`]);
});
