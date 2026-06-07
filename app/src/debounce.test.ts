// app/src/debounce.test.ts
import { test, expect } from "bun:test";
import { debounce } from "./debounce";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("coalesces rapid successive calls into a single invocation", async () => {
  let calls = 0;
  const d = debounce(() => { calls++; }, 20);
  d(); d(); d();
  expect(calls).toBe(0); // nothing fires synchronously
  await sleep(40);
  expect(calls).toBe(1);
});

test("invokes with the arguments from the most recent call", async () => {
  const seen: number[] = [];
  const d = debounce((n: number) => { seen.push(n); }, 20);
  d(1); d(2); d(3);
  await sleep(40);
  expect(seen).toEqual([3]);
});

test("fires again for a fresh burst after the wait elapses", async () => {
  let calls = 0;
  const d = debounce(() => { calls++; }, 20);
  d();
  await sleep(40);
  d();
  await sleep(40);
  expect(calls).toBe(2);
});

test("cancel() prevents a pending invocation", async () => {
  let calls = 0;
  const d = debounce(() => { calls++; }, 20);
  d();
  d.cancel();
  await sleep(40);
  expect(calls).toBe(0);
});
