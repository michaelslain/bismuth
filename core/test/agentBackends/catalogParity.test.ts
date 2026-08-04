// core/test/agentBackends/catalogParity.test.ts
//
// CAPABILITY <-> IMPLEMENTATION parity guard for agent backends.
//
// core/src/agentBackends/catalog.ts declares what each backend CAN do (permissionPrompts,
// permissionModes, effort, ...). core/src/chatProviders/backends.ts is what actually implements
// it: CHAT_BACKENDS, one ChatBackend per id, whose respondPermission/setPermissionMode/setEffort/
// respondQuestion members are OPTIONAL and — per that file's own doc comments on the ChatBackend
// interface — meant to be present exactly when the matching capability flag is true. Nothing
// asserted the two actually agreed until this file.
//
// This is not a hypothetical gap. catalog.ts:503-508 (ACP_SHARED_CAPABILITIES's doc comment)
// documents the exact defect this guard exists to catch: `permissionModes` was once set `true`
// for the ACP backends while `setPermissionMode` was unimplemented, so the header rendered a
// permission-mode picker whose selections silently did nothing. The flag was believed; the verb
// was never checked. That is the class of bug this file is for.
//
// Every assertion below iterates BACKEND_IDS itself — never a hardcoded id list. A hardcoded
// subset is exactly how this class of guard has failed in this repo before: core/test/support/
// mockLlm.test.ts once carried a test titled "every backend id the catalog knows about" whose
// body iterated a fixed 4-entry array, so BACKEND_IDS growing to its current 9 (or a future 10th)
// could never fail it. Adding a backend and forgetting to wire (or un-wire) one of these verbs, or
// flipping a capability flag true without implementing the matching verb, MUST fail a test here.
//
// Also deliberately NOT catalog-vs-catalog: app/src/chatProvider.test.ts's "permission PROMPTS and
// permission MODES are separate capabilities" test reads `providerCan(id, flag)`, which is a thin
// wrapper over the SAME catalog this file reads — asserting `providerCan("cline",
// "permissionPrompts") === true` against a value copied from the catalog is tautological, and would
// keep passing through the exact defect above (the flag can say anything; the test never looks at
// whether a driver actually implements it). Left as-is rather than "fixed" here: it is still useful
// as a "does the catalog say what I think it says" smoke test and a `providerCan` exercise, it is
// just not a substitute for the real guard below, which is why this file exists alongside it
// instead of replacing it.
import { describe, expect, test } from "bun:test";
import { BACKENDS, BACKEND_IDS, type BackendId } from "../../src/agentBackends/catalog";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";

describe("agent backend catalog <-> CHAT_BACKENDS parity", () => {
  test("CHAT_BACKENDS implements exactly the ids BACKEND_IDS declares — no missing, no orphaned entries", () => {
    // Catches both directions: a new id added to BACKEND_IDS but never given a driver entry in
    // backends.ts, AND a stray CHAT_BACKENDS key for an id the catalog no longer knows about.
    expect(Object.keys(CHAT_BACKENDS).sort()).toEqual([...BACKEND_IDS].sort());
  });

  /** Every id where the catalog's capability flag and the driver's actual verb disagree, for one
   *  flag/verb pair. Returns human-readable strings (not booleans) so a failure names exactly
   *  which backend(s) disagree and how, rather than failing silently on the first mismatch found. */
  function disagreements(
    flag: "permissionPrompts" | "permissionModes" | "effort",
    verb: "respondPermission" | "setPermissionMode" | "setEffort" | "respondQuestion",
  ): string[] {
    const out: string[] = [];
    for (const id of BACKEND_IDS as readonly BackendId[]) {
      const backend = CHAT_BACKENDS[id];
      // Missing entirely is the OTHER test's job (the exact-id-set check above) — don't let a
      // missing CHAT_BACKENDS entry blow up this one with a TypeError instead of a clear message.
      if (!backend) {
        out.push(`${id}: no CHAT_BACKENDS entry at all (see the id-parity test)`);
        continue;
      }
      const claims = BACKENDS[id].capabilities[flag];
      const has = typeof backend[verb] === "function";
      if (claims !== has) {
        out.push(`${id}: capabilities.${flag}=${claims} but ${verb} is ${has ? "IMPLEMENTED" : "NOT implemented"}`);
      }
    }
    return out;
  }

  test("permissionPrompts <-> respondPermission", () => {
    // A backend that can raise a live approval request mid-turn must implement the verb that
    // answers it, and vice versa — claiming the flag without the verb strands a `permission`
    // ChatFrame the user can never resolve; implementing the verb without the flag means the
    // frontend never sends it (a dead capability, harmless but a documentation lie either way).
    expect(disagreements("permissionPrompts", "respondPermission")).toEqual([]);
  });

  test("permissionModes <-> setPermissionMode", () => {
    // The exact pair catalog.ts:503-508 documents as having shipped mismatched once (ACP's
    // permissionModes:true / setPermissionMode unimplemented, before the flag was split and
    // corrected to false). This is the regression guard for that specific incident.
    expect(disagreements("permissionModes", "setPermissionMode")).toEqual([]);
  });

  test("effort <-> setEffort", () => {
    expect(disagreements("effort", "setEffort")).toEqual([]);
  });

  test("permissionModes <-> respondQuestion", () => {
    // respondQuestion has no capability flag of its own (catalog.ts's ACP_SHARED_CAPABILITIES doc
    // comment: "respondQuestion is likewise unimplemented ... but no capability advertises it, so
    // nothing renders for it") — but chatProviders/backends.ts's OWN doc comment on the verb ties
    // it to permissionModes anyway ("Answer a `question` frame (AskUserQuestion). Present iff
    // capabilities.permissionModes."). That makes it a real, code-stated pair to check, not an
    // invented one: today it holds vacuously (claude is the only backend with permissionModes
    // true, and the only one implementing respondQuestion), but a future backend that sets
    // permissionModes:true without wiring respondQuestion — or vice versa — should fail here.
    expect(disagreements("permissionModes", "respondQuestion")).toEqual([]);
  });

  // Deliberately NOT asserted: `mcp` and `memory`. Both are read nowhere outside catalog.ts today
  // — see catalog.ts's OPENCLAW doc comment: "Neither `mcp` nor `memory` is read anywhere outside
  // this file today (checked live)". There is no ChatBackend verb gated by either flag, so any
  // assertion here would have to invent a check against nothing rather than verify real behavior.
  // This is a deliberate omission, not an oversight — if `mcp`/`memory` ever gain a real
  // implementing verb, add a pair above the same way the other four are checked.
  //
  // Also not asserted, for the same reason (no OPTIONAL ChatBackend member gated by the flag):
  // `resume`, `historyReplay`, `models`, `auth`, `cost`, `contextUsage`, `computerUse`,
  // `slashCommands`, `sessionPicker`, `chat`, `streaming`, `terminal`, `relayReporting`, `subagents`,
  // `daemon`, `visibilityGate`, `selfSandboxes`. Several of these have a SIMILARLY named REQUIRED
  // ChatBackend member (`resumeSession`, `sessionHistoryFrames`, `setModel`, ...), but those exist
  // on every backend unconditionally regardless of the flag's value — sessionHistoryFrames is
  // explicitly documented "Tolerant: any failure yields []" — so the method's mere presence carries
  // no capability signal to check the flag against.
});
