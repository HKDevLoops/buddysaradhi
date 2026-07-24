// apps/gateway/src/lib/logger.ts
// Tiny typed logger for the gateway runtime. Mirrors apps/web/src/lib/logger.ts
// shape: rule-9 compliant (no console.log in prod, structured fields, never
// throws). Levels route to stderr (warn/error) or stdout (info/audit).

type LogLevel = "info" | "warn" | "error" | "audit";

interface LogContext { [k: string]: unknown; }

function emit(level: LogLevel, action: string, message: string, context?: LogContext): void {
  const line = JSON.stringify({
    level,
    action,
    message,
    context: context ?? {},
    timestamp: new Date().toISOString(),
  }) + "\n";
  if (level === "error" || level === "warn") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export const log = {
  info(action: string, message: string, context?: LogContext): void {
    emit("info", action, message, context);
  },
  warn(action: string, message: string, context?: LogContext): void {
    emit("warn", action, message, context);
  },
  error(action: string, message: string, context?: LogContext): void {
    emit("error", action, message, context);
  },
  audit(action: string, message: string, context: LogContext = {}): void {
    emit("audit", action, message, context);
  },
};

export function auditAction(action: string, context: LogContext = {}, message?: string): void {
  log.audit(action, message ?? action, context);
}
