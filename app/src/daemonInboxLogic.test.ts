import { test, expect } from "bun:test";
import { isDue, dueSorted, scheduledSorted, resolvedSorted, sharedPrimaryAction } from "./daemonInboxLogic";
import type { DaemonPage } from "../../core/src/daemonPages";

const NOW = Date.parse("2026-07-06T12:00:00.000Z");

// Minimal stub factory — only the fields the pure logic reads.
const page = (overrides: Partial<DaemonPage> & { slug: string }): DaemonPage => ({
  path: `.daemon/pages/${overrides.slug}.md`,
  title: overrides.slug,
  createdAt: "2026-07-06T08:00:00.000Z",
  actions: [],
  body: "",
  status: "pending",
  ...overrides,
});

test("isDue: pending with no deliverAt is due immediately (deliver on next open)", () => {
  expect(isDue(page({ slug: "a", createdAt: "2026-07-06T08:00:00.000Z" }), NOW)).toBe(true);
});

test("isDue: pending with a future deliverAt is not due yet", () => {
  expect(isDue(page({ slug: "a", deliverAt: "2026-07-06T17:00:00.000Z" }), NOW)).toBe(false);
});

test("isDue: pending with a past deliverAt is due", () => {
  expect(isDue(page({ slug: "a", deliverAt: "2026-07-06T00:00:00.000Z" }), NOW)).toBe(true);
});

test("isDue: an unparseable deliverAt is treated as already due", () => {
  expect(isDue(page({ slug: "a", deliverAt: "not-a-date" }), NOW)).toBe(true);
});

test("isDue: non-pending statuses are never due", () => {
  for (const status of ["working", "done", "failed", "dismissed"] as const) {
    expect(isDue(page({ slug: "a", status }), NOW)).toBe(false);
  }
});

test("dueSorted: due pages only, oldest-created first (FIFO)", () => {
  const pages = [
    page({ slug: "newer", createdAt: "2026-07-06T10:00:00.000Z" }),
    page({ slug: "older", createdAt: "2026-07-06T06:00:00.000Z" }),
    page({ slug: "not-due", deliverAt: "2026-07-07T00:00:00.000Z" }),
    page({ slug: "resolved", status: "done" }),
  ];
  expect(dueSorted(pages, NOW).map((p) => p.slug)).toEqual(["older", "newer"]);
});

test("scheduledSorted: pending + future deliverAt only, soonest first", () => {
  const pages = [
    page({ slug: "far", deliverAt: "2026-07-10T00:00:00.000Z" }),
    page({ slug: "near", deliverAt: "2026-07-06T13:00:00.000Z" }),
    page({ slug: "due-now", deliverAt: "2026-07-06T00:00:00.000Z" }), // already due — excluded
    page({ slug: "resolved", status: "dismissed" }),
  ];
  expect(scheduledSorted(pages, NOW).map((p) => p.slug)).toEqual(["near", "far"]);
});

test("resolvedSorted: terminal pages only, most-recently-settled first", () => {
  const pages = [
    page({ slug: "old-done", status: "done", completedAt: "2026-07-05T00:00:00.000Z" }),
    page({ slug: "new-failed", status: "failed", completedAt: "2026-07-06T11:00:00.000Z" }),
    page({ slug: "dismissed-no-completedAt", status: "dismissed", pressedAt: "2026-07-06T09:00:00.000Z" }),
    page({ slug: "still-pending" }),
  ];
  expect(resolvedSorted(pages).map((p) => p.slug)).toEqual([
    "new-failed",
    "dismissed-no-completedAt",
    "old-done",
  ]);
});

test("sharedPrimaryAction: 2+ pages with the identical single primary action id", () => {
  const pages = [
    page({ slug: "a", actions: [{ id: "send", label: "Send", kind: "primary" }, { id: "discard", label: "Discard", kind: "danger" }] }),
    page({ slug: "b", actions: [{ id: "send", label: "Send", kind: "primary" }] }),
  ];
  expect(sharedPrimaryAction(pages)).toBe("send");
});

test("sharedPrimaryAction: null when fewer than 2 pages", () => {
  const pages = [page({ slug: "a", actions: [{ id: "send", label: "Send", kind: "primary" }] })];
  expect(sharedPrimaryAction(pages)).toBeNull();
});

test("sharedPrimaryAction: null when primary action ids disagree", () => {
  const pages = [
    page({ slug: "a", actions: [{ id: "send", label: "Send", kind: "primary" }] }),
    page({ slug: "b", actions: [{ id: "approve", label: "Approve", kind: "primary" }] }),
  ];
  expect(sharedPrimaryAction(pages)).toBeNull();
});

test("sharedPrimaryAction: null when a page has zero or multiple primary actions", () => {
  const noPrimary = [
    page({ slug: "a", actions: [{ id: "send", label: "Send", kind: "default" }] }),
    page({ slug: "b", actions: [{ id: "send", label: "Send", kind: "default" }] }),
  ];
  expect(sharedPrimaryAction(noPrimary)).toBeNull();

  const twoPrimary = [
    page({
      slug: "a",
      actions: [
        { id: "send", label: "Send", kind: "primary" },
        { id: "send2", label: "Send other", kind: "primary" },
      ],
    }),
    page({ slug: "b", actions: [{ id: "send", label: "Send", kind: "primary" }] }),
  ];
  expect(sharedPrimaryAction(twoPrimary)).toBeNull();
});
