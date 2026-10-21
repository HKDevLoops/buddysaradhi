// Implements: AGENTS.md §9.2.6 — the `no-orphaned-task` lint's own
// regression test.
//
// A gate that cannot fail is not a gate (AGENTS.md §12). Each of the four
// rules §9.2.6 names has a negative control below: an input that MUST fail,
// asserted to fail, so a regression that silently disables a rule is caught
// here rather than by the first orphaned task that ships.
import { describe, expect, it } from "vitest";
import { lintOrphanedTasks, parseTodos, parseWorklog } from "./no-orphaned-task";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const FRESH = NOW - 5 * 60_000; // 5 minutes old — inside the 30-minute window
const STALE = NOW - 45 * 60_000; // 45 minutes old — outside it

const GOOD_ENTRY = `**Task ID**: TEST-001 **Agent**: tester **Task**: a task

Work Log:
- did the thing.

**Stage Summary**:
- State: COMPLETED
`;

/** A worklog whose every entry is compliant, used as the baseline. */
function goodWorklog(): string {
  return `---
${GOOD_ENTRY}
---
**Task ID**: TEST-002 **Agent**: tester **Task**: a paused task

Work Log:
- stopped halfway.

**Stage Summary**:
- State: PAUSED
- Resume point: open the file and finish the second half
`;
}

describe("parseTodos — the todo state file", () => {
  it("reads the object form and the bare-array form", () => {
    expect(parseTodos('{"todos":[{"id":"A","status":"in_progress"}]}')).toEqual([
      { id: "A", taskId: undefined, content: undefined, status: "in_progress" },
    ]);
    expect(parseTodos('[{"id":"B","status":"pending"}]')).toEqual([
      { id: "B", taskId: undefined, content: undefined, status: "pending" },
    ]);
  });
});

describe("parseWorklog — the four fields of an entry", () => {
  it("reads task id, state, stage summary and resume point", () => {
    const entries = parseWorklog(goodWorklog(), FRESH);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.taskId).toBe("TEST-001");
    expect(entries[0]?.state).toBe("COMPLETED");
    expect(entries[0]?.hasStageSummary).toBe(true);
    expect(entries[1]?.state).toBe("PAUSED");
    expect(entries[1]?.hasResumePoint).toBe(true);
  });
});

describe("the lint — a compliant worklog passes", () => {
  it("passes with no todos at all", () => {
    const result = lintOrphanedTasks(goodWorklog(), FRESH, [], NOW);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("passes with one in_progress todo that has a fresh entry", () => {
    const result = lintOrphanedTasks(goodWorklog(), FRESH, [{ id: "TEST-001", status: "in_progress" }], NOW);
    expect(result.violations).toEqual([]);
  });
});

describe("rule (a) — an in_progress todo needs a recent worklog entry", () => {
  it("FAILS when the todo has no worklog entry at all — the negative control", () => {
    const result = lintOrphanedTasks(goodWorklog(), FRESH, [{ id: "GHOST-999", status: "in_progress" }], NOW);
    expect(result.ok).toBe(false);
    const ruleA = result.violations.filter((v) => v.rule === "a");
    expect(ruleA).toHaveLength(1);
    expect(ruleA[0]?.message).toContain("GHOST-999");
  });

  it("FAILS when the entry is older than the 30-minute window", () => {
    const result = lintOrphanedTasks(goodWorklog(), STALE, [{ id: "TEST-001", status: "in_progress" }], NOW);
    expect(result.ok).toBe(false);
    expect(result.violations.filter((v) => v.rule === "a")).toHaveLength(1);
    expect(result.violations[0]?.message).toContain("minutes old");
  });

  it("PASSES a todo whose entry is inside the window", () => {
    const result = lintOrphanedTasks(goodWorklog(), FRESH, [{ id: "TEST-001", status: "in_progress" }], NOW);
    expect(result.violations.filter((v) => v.rule === "a")).toHaveLength(0);
  });
});

describe("rule (b) — a Stage Summary must declare a State", () => {
  it("FAILS an entry whose Stage Summary has no State — the negative control", () => {
    const worklog = `**Task ID**: TEST-003 **Agent**: tester **Task**: a task

Work Log:
- did the thing.

**Stage Summary**: Complete. All good.
`;
    const result = lintOrphanedTasks(worklog, FRESH, [], NOW);
    expect(result.ok).toBe(false);
    const ruleB = result.violations.filter((v) => v.rule === "b");
    expect(ruleB).toHaveLength(1);
    expect(ruleB[0]?.message).toContain("TEST-003");
  });

  it("does not fire for an entry with no Stage Summary at all", () => {
    const worklog = `**Task ID**: TEST-004 **Agent**: tester **Task**: a task

Work Log:
- did the thing.
`;
    const result = lintOrphanedTasks(worklog, FRESH, [], NOW);
    expect(result.violations.filter((v) => v.rule === "b")).toHaveLength(0);
  });
});

describe("rule (c) — a PAUSED entry must carry a Resume point", () => {
  it("FAILS a PAUSED entry with no Resume point — the negative control", () => {
    const worklog = `**Task ID**: TEST-005 **Agent**: tester **Task**: a task

Work Log:
- stopped halfway.

**Stage Summary**:
- State: PAUSED
`;
    const result = lintOrphanedTasks(worklog, FRESH, [], NOW);
    expect(result.ok).toBe(false);
    const ruleC = result.violations.filter((v) => v.rule === "c");
    expect(ruleC).toHaveLength(1);
    expect(ruleC[0]?.message).toContain("TEST-005");
  });

  it("PASSES a PAUSED entry that names its resume point", () => {
    const worklog = `**Task ID**: TEST-006 **Agent**: tester **Task**: a task

Work Log:
- stopped halfway.

**Stage Summary**:
- State: PAUSED
- Resume point: finish the second half
`;
    const result = lintOrphanedTasks(worklog, FRESH, [], NOW);
    expect(result.violations.filter((v) => v.rule === "c")).toHaveLength(0);
  });
});

describe("rule (d) — only ONE task may be in flight", () => {
  it("FAILS when two todos are in_progress — the negative control", () => {
    const result = lintOrphanedTasks(goodWorklog(), FRESH, [
      { id: "TEST-001", status: "in_progress" },
      { id: "TEST-002", status: "in_progress" },
    ], NOW);
    expect(result.ok).toBe(false);
    const ruleD = result.violations.filter((v) => v.rule === "d");
    expect(ruleD).toHaveLength(1);
    expect(ruleD[0]?.message).toContain("TEST-001");
  });

  it("does not fire for two todos that are not in_progress", () => {
    const result = lintOrphanedTasks(goodWorklog(), FRESH, [
      { id: "TEST-001", status: "pending" },
      { id: "TEST-002", status: "completed" },
    ], NOW);
    expect(result.violations.filter((v) => v.rule === "d")).toHaveLength(0);
  });
});
