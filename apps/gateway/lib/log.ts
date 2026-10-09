// Implements: 10_Security.md §8 (no secret, credential, PIN, email or card number
// in a log line) + AGENTS.md §2 Rule 9 (typed logger, structured output).
//
// The redaction rules themselves are NOT here: they live once in
// `packages/shared/src/redact.ts` — which `apps/web/src/lib/logger.ts` uses too —
// and are vendored for edge deployability at `./vendor/redact.ts`. `redact` and
// `sanitizeLogData` are re-exported from here so every existing gateway import —
// and `__tests__/log-redaction.test.ts` — keeps working against that one
// implementation instead of a private copy that can drift.
import { sanitizeLogData } from "./vendor/redact.ts";

export { redact, sanitizeLogData } from "./vendor/redact.ts";

interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  event: string;
  tenantId?: string;
  path?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  cacheHit?: boolean;
  queryCount?: number;
  errorCode?: string | null;
  message?: string;
  [key: string]: unknown;
}

function emit(
  level: LogEntry["level"],
  event: string,
  data: Record<string, unknown> = {},
): void {
  const sanitizedData = sanitizeLogData(data);
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitizedData,
  };
  try {
    Deno.stdout.writeSync(
      new TextEncoder().encode(JSON.stringify(entry) + "\n"),
    );
  } catch {
    // Silently fail if stdout is not available
  }
}

export function logInfo(
  event: string,
  data: Record<string, unknown> = {},
): void {
  emit("info", event, data);
}

export function logWarn(
  event: string,
  data: Record<string, unknown> = {},
): void {
  emit("warn", event, data);
}

export function logError(
  event: string,
  data: Record<string, unknown> = {},
): void {
  emit("error", event, data);
}