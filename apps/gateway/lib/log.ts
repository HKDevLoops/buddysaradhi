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

const SENSITIVE_PATTERNS = [
  /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
  /(?:secret|token|key|apikey|api_key)\s*[:=]\s*\S+/gi,
  /(?:authorization|auth)\s*[:=]\s*\S+/gi,
  /(?:x-db-token|x-db-url)\s*[:=]\s*\S+/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  /(?<!\d)(?:\d{4}[- ]){3}\d{4}(?!\d)/g,
  /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
  /libsql:\/\/[^\s]+/gi,
  /https?:\/\/[^\s]*@[^\s]+/gi,
];

function sanitizeLogData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      let clean = value;
      for (const pattern of SENSITIVE_PATTERNS) {
        clean = clean.replace(pattern, "[REDACTED]");
      }
      if (clean.length > 500) {
        clean = clean.substring(0, 500) + "...";
      }
      sanitized[key] = clean;
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = "[OBJECT]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
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
