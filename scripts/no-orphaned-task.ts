#!/usr/bin/env node
// scripts/no-orphaned-task.ts
// Implements: AGENTS.md §9.2.6 — "A CI lint (`tools/no-orphaned-task.test.ts`)
//   scans the worklog and the todo state at session end: Fail if any todo is
//   `in_progress` with no worklog entry in the last 30 minutes, Fail if a
//   worklog entry's `Stage Summary` lacks a `State:` field, Fail if a `PAUSED`
//   task's worklog entry lacks a `Resume point:` field, Fail if two
//   `in_progress` todos exist simultaneously."
//
// WHY THIS EXISTS. Audit AUD-053 (docs/audit/AUDIT-2026-10-21.md) found the
//   lint did not exist (`tools/` holds only `reasoningbank/`), nothing in
//   `.github/workflows/**` referenced it, and NO workflow in the repo had a
//   `schedule:` trigger — so the `webDevReview` cron AGENTS.md §9.2.6 names
//   did not exist either. The four promised checks were enforced by nothing,
//   and the measured gap was exactly the promised failure: 68 `Task ID`
//   entries in `worklog.md`, 62 `State:` fields.
//
// WHAT IT CHECKS — the four rules, verbatim from §9.2.6:
//   (a) a todo that is `in_progress` must have a worklog entry, and that
//       entry must be recent (30 minutes);
//   (b) a worklog entry that has a `Stage Summary` must have a `State:` field;
//   (c) a worklog entry whose state is `PAUSED` must have a `Resume point:`;
//   (d) two `in_progress` todos must not exist at once (§9.2.1: exactly ONE
//       task is in flight at any moment).
//
// THE TODO STATE. AGENTS.md §9.2 describes the `TodoWrite` tool's state, which
//   lives in the agent's session, not in the repository — so this lint reads a
//   committed file instead: `todos.json` at the repo root, shaped
//   `{"todos":[{"id":"…","content":"…","status":"in_progress|pending|completed|paused"}]}`.
//   A bare JSON array is accepted too. When the file is absent there is no
//   in-flight work to orphan, so rules (a) and (d) have no input; rules (b)
//   and (c) still run against the worklog.
//
// TIMESTAMPS. A worklog entry is timestamped by its own `Date:` /
//   `Timestamp:` line when it has one; otherwise the worklog file's mtime is
//   used, because an agent appends the entry while it is working on the task.
//   This is stated here because the rule's 30-minute window depends on it.
//
// Exit 0 = clean. Exit 1 = violations (printed). Exit 2 = harness error.
//
// Zero new dependencies: plain Node (>=22) + node:fs.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT: string = fileURLToPath(new URL("..", import.meta.url));

/** §9.2.6: the window in which an `in_progress` todo must have a worklog entry. */
export const STALE_MINUTES = 30;

export type TodoStatus = "in_progress" | "pending" | "completed" | "paused" | string;

export interface Todo {
  id?: string;
  taskId?: string;
  content?: string;
  status: TodoStatus;
}

export interface WorklogEntry {
  /** The `Task ID` of the entry, when it has one. */
  taskId: string | null;
  /** The `State:` value — COMPLETED | PAUSED | BLOCKED. */
  state: "COMPLETED" | "PAUSED" | "BLOCKED" | null;
  hasStageSummary: boolean;
  hasResumePoint: boolean;
  /** Epoch millis — the entry's own date, or the worklog's mtime. */
  timestamp: number;
  /** The raw entry text, used to match a todo that has no id. */
  text: string;
}

export interface Violation {
  rule: "a" | "b" | "c" | "d";
  message: string;
}

export interface LintResult {
  ok: boolean;
  violations: Violation[];
  /** How many entries and todos were read — printed so a zero-violation run
   *  is visibly "I checked 70 entries", not "I checked nothing". */
  entriesRead: number;
  todosRead: number;
}

/** Parse the todo state file. A missing file means "no todo state". */
export function parseTodos(text: string): Todo[] {
  const parsed: unknown = JSON.parse(text);
  const list: unknown = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as { todos?: unknown }).todos)
      ? (parsed as { todos: unknown[] }).todos
      : [];
  const out: Todo[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const status = typeof record.status === "string" ? record.status : "pending";
    out.push({
      id: typeof record.id === "string" ? record.id : undefined,
      taskId: typeof record.taskId === "string" ? record.taskId : undefined,
      content: typeof record.content === "string" ? record.content : undefined,
      status,
    });
  }
  return out;
}

/** Split the worklog into entries and read each entry's four fields. */
export function parseWorklog(text: string, fallbackTimestamp: number): WorklogEntry[] {
  const chunks = text.split(/^\s*---\s*$/m);
  const entries: WorklogEntry[] = [];
  for (const chunk of chunks) {
    if (chunk.trim().length === 0) continue;
    const taskIdMatch = /Task\s*ID\**\s*:\s*\**\s*`?([A-Za-z0-9][A-Za-z0-9_-]*)/i.exec(chunk);
    const stateMatch = /State:\s*\**\s*(COMPLETED|PAUSED|BLOCKED)/i.exec(chunk);
    const dateMatch = /^\s*[-*]?\s*(?:Date|Timestamp)\s*:\s*(.+)$/im.exec(chunk);
    let timestamp = fallbackTimestamp;
    if (dateMatch?.[1] !== undefined) {
      const parsed = Date.parse(dateMatch[1]);
      if (!Number.isNaN(parsed)) timestamp = parsed;
    }
    entries.push({
      taskId: taskIdMatch?.[1] ?? null,
      state: stateMatch ? (stateMatch[1]!.toUpperCase() as WorklogEntry["state"]) : null,
      hasStageSummary: /Stage\s*Summary/i.test(chunk),
      hasResumePoint: /Resume\s*point\s*:/i.test(chunk),
      timestamp,
      text: chunk,
    });
  }
  return entries;
}

/** The todo's identity: an explicit id, a taskId, or its content. */
function todoKey(todo: Todo): string | null {
  return todo.id ?? todo.taskId ?? null;
}

function matches(todo: Todo, entry: WorklogEntry): boolean {
  const key = todoKey(todo);
  if (key !== null && entry.taskId !== null) {
    if (entry.taskId === key) return true;
  }
  if (todo.content !== undefined && todo.content.length > 0) {
    return entry.text.includes(todo.content);
  }
  return false;
}

/**
 * The lint. `now` is epoch millis; the caller passes it so the 30-minute
 * window is testable without waiting for the clock.
 */
export function lintOrphanedTasks(
  worklogText: string,
  worklogMtimeMs: number,
  todos: Todo[],
  now: number = Date.now(),
): LintResult {
  const entries = parseWorklog(worklogText, worklogMtimeMs);
  const violations: Violation[] = [];

  // (b) A worklog entry's Stage Summary must declare a State.
  for (const entry of entries) {
    if (!entry.hasStageSummary) continue;
    if (entry.state === null) {
      violations.push({
        rule: "b",
        message: `a worklog entry${entry.taskId ? ` (${entry.taskId})` : ""} has a Stage Summary with no \`State:\` field — \`State: COMPLETED | PAUSED | BLOCKED\` is mandatory (AGENTS.md §9.2.2 step 3)`,
      });
    }
  }

  // (c) A PAUSED entry must carry a Resume point.
  for (const entry of entries) {
    if (entry.state !== "PAUSED") continue;
    if (!entry.hasResumePoint) {
      violations.push({
        rule: "c",
        message: `a PAUSED worklog entry${entry.taskId ? ` (${entry.taskId})` : ""} has no \`Resume point:\` field — a paused task that cannot be resumed is orphaned work (AGENTS.md §9.2.3)`,
      });
    }
  }

  const inProgress = todos.filter((t) => t.status === "in_progress");

  // (d) Exactly ONE task may be in flight.
  if (inProgress.length > 1) {
    violations.push({
      rule: "d",
      message: `${inProgress.length} todos are \`in_progress\` at once (${inProgress.map((t) => todoKey(t) ?? t.content ?? "?").join(", ")}) — exactly ONE task may be in flight (AGENTS.md §9.2.1)`,
    });
  }

  // (a) An in_progress todo needs a recent worklog entry.
  for (const todo of inProgress) {
    const entry = entries.find((e) => matches(todo, e));
    const label = todoKey(todo) ?? todo.content ?? "(unnamed todo)";
    if (entry === undefined) {
      violations.push({
        rule: "a",
        message: `the todo \`${label}\` is \`in_progress\` with no worklog entry — append one before the session ends (AGENTS.md §9.2.2 step 3)`,
      });
      continue;
    }
    const ageMinutes = (now - entry.timestamp) / 60_000;
    if (ageMinutes > STALE_MINUTES) {
      violations.push({
        rule: "a",
        message: `the todo \`${label}\` is \`in_progress\` and its last worklog entry is ${Math.round(ageMinutes)} minutes old (limit ${STALE_MINUTES}) — the task is in flight with nobody writing it down (AGENTS.md §9.2.6)`,
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    entriesRead: entries.length,
    todosRead: todos.length,
  };
}

function readTodos(paths: string[]): Todo[] {
  const flag = paths.indexOf("--todos");
  const value = flag === -1 ? path.join(REPO_ROOT, "todos.json") : paths[flag + 1];
  if (value === undefined || !existsSync(value)) return [];
  return parseTodos(readFileSync(value, "utf8"));
}

function main(): number {
  const args = process.argv.slice(2);
  const worklogFlag = args.indexOf("--worklog");
  const worklogPath =
    worklogFlag === -1 ? path.join(REPO_ROOT, "worklog.md") : (args[worklogFlag + 1] ?? "");
  if (worklogPath === "" || !existsSync(worklogPath)) {
    process.stderr.write(`no-orphaned-task: cannot read the worklog at ${worklogPath}\n`);
    return 2;
  }
  const nowFlag = args.indexOf("--now");
  const now = nowFlag === -1 ? Date.now() : Date.parse(args[nowFlag + 1] ?? "");
  if (Number.isNaN(now)) {
    process.stderr.write("no-orphaned-task: --now needs an ISO timestamp\n");
    return 2;
  }

  let todos: Todo[];
  try {
    todos = readTodos(args);
  } catch (error) {
    process.stderr.write(`no-orphaned-task: cannot read the todo state: ${String(error)}\n`);
    return 2;
  }

  const result = lintOrphanedTasks(
    readFileSync(worklogPath, "utf8"),
    statSync(worklogPath).mtimeMs,
    todos,
    now,
  );

  if (result.ok) {
    process.stdout.write(
      `no-orphaned-task: PASS — ${result.entriesRead} worklog entries, ${result.todosRead} todos\n`,
    );
    return 0;
  }

  process.stderr.write(
    `no-orphaned-task: FAIL — ${result.violations.length} violation(s) across ${result.entriesRead} worklog entries and ${result.todosRead} todos\n`,
  );
  for (const violation of result.violations) {
    process.stderr.write(`  - [rule ${violation.rule}] ${violation.message}\n`);
  }
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  process.exit(main());
}
