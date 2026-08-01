import { describe, it, expect, beforeEach } from "vitest";

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

let capturedOutput: string[] = [];

function emit(level: LogEntry["level"], event: string, data: Record<string, unknown> = {}): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  };
  const line = JSON.stringify(entry) + "\n";
  capturedOutput.push(line);
}

function logInfo(event: string, data: Record<string, unknown> = {}): void {
  emit("info", event, data);
}

function logWarn(event: string, data: Record<string, unknown> = {}): void {
  emit("warn", event, data);
}

function logError(event: string, data: Record<string, unknown> = {}): void {
  emit("error", event, data);
}

beforeEach(() => {
  capturedOutput = [];
});

describe("logInfo", () => {
  it("outputs valid JSON", () => {
    logInfo("test.event");
    expect(capturedOutput.length).toBe(1);
    expect(() => JSON.parse(capturedOutput[0])).not.toThrow();
  });

  it("includes required fields: ts, level, event", () => {
    logInfo("gateway.request");
    const parsed = JSON.parse(capturedOutput[0]);
    expect(parsed).toHaveProperty("ts");
    expect(parsed).toHaveProperty("level", "info");
    expect(parsed).toHaveProperty("event", "gateway.request");
  });

  it("ts is a valid ISO timestamp", () => {
    logInfo("test.event");
    const parsed = JSON.parse(capturedOutput[0]);
    expect(() => new Date(parsed.ts)).not.toThrow();
    expect(new Date(parsed.ts).toISOString()).toBe(parsed.ts);
  });

  it("includes optional path, method, status, durationMs", () => {
    logInfo("gateway.request", {
      path: "/api/v1/students",
      method: "GET",
      status: 200,
      durationMs: 42,
    });
    const parsed = JSON.parse(capturedOutput[0]);
    expect(parsed.path).toBe("/api/v1/students");
    expect(parsed.method).toBe("GET");
    expect(parsed.status).toBe(200);
    expect(parsed.durationMs).toBe(42);
  });

  it("includes tenantId when provided", () => {
    logInfo("gateway.request", { tenantId: "t-123" });
    const parsed = JSON.parse(capturedOutput[0]);
    expect(parsed.tenantId).toBe("t-123");
  });

  it("includes cacheHit boolean when provided", () => {
    logInfo("gateway.request", { cacheHit: true });
    const parsed = JSON.parse(capturedOutput[0]);
    expect(parsed.cacheHit).toBe(true);
  });

  it("includes queryCount when provided", () => {
    logInfo("db.query", { queryCount: 5 });
    const parsed = JSON.parse(capturedOutput[0]);
    expect(parsed.queryCount).toBe(5);
  });

  it("ends with newline", () => {
    logInfo("test.event");
    expect(capturedOutput[0].endsWith("\n")).toBe(true);
  });

  it("each line is a standalone JSON object", () => {
    logInfo("event.one", { status: 200 });
    logInfo("event.two", { status: 404 });
    for (const line of capturedOutput) {
      const trimmed = line.trimEnd();
      expect(() => JSON.parse(trimmed)).not.toThrow();
    }
  });
});

describe("logError", () => {
  it("outputs valid JSON", () => {
    logError("test.error");
    expect(capturedOutput.length).toBe(1);
    expect(() => JSON.parse(capturedOutput[0])).not.toThrow();
  });

  it("has level='error'", () => {
    logError("gateway.error");
    const parsed = JSON.parse(capturedOutput[0]);
    expect(parsed.level).toBe("error");
  });

  it("includes event name", () => {
    logError("auth.fail", { errorCode: "unauthenticated" });
    const parsed = JSON.parse(capturedOutput[0]);
    expect(parsed.event).toBe("auth.fail");
    expect(parsed.errorCode).toBe("unauthenticated");
  });

  it("includes message when provided", () => {
    logError("internal.error", { message: "something broke" });
    const parsed = JSON.parse(capturedOutput[0]);
    expect(parsed.message).toBe("something broke");
  });

  it("includes status code when provided", () => {
    logError("gateway.error", { status: 500 });
    const parsed = JSON.parse(capturedOutput[0]);
    expect(parsed.status).toBe(500);
  });

  it("supports null errorCode", () => {
    logError("gateway.error", { errorCode: null });
    const parsed = JSON.parse(capturedOutput[0]);
    expect(parsed.errorCode).toBeNull();
  });
});

describe("logWarn", () => {
  it("outputs valid JSON with level='warn'", () => {
    logWarn("test.warn");
    const parsed = JSON.parse(capturedOutput[0]);
    expect(parsed.level).toBe("warn");
    expect(parsed.event).toBe("test.warn");
  });

  it("includes custom data", () => {
    logWarn("cache.miss", { path: "/api/v1/students", cacheHit: false });
    const parsed = JSON.parse(capturedOutput[0]);
    expect(parsed.path).toBe("/api/v1/students");
    expect(parsed.cacheHit).toBe(false);
  });
});

describe("log shape contract", () => {
  it("every log entry has ts as string", () => {
    logInfo("a");
    logWarn("b");
    logError("c");
    for (const line of capturedOutput) {
      const parsed = JSON.parse(line);
      expect(typeof parsed.ts).toBe("string");
    }
  });

  it("every log entry has level as info|warn|error", () => {
    logInfo("a");
    logWarn("b");
    logError("c");
    for (const line of capturedOutput) {
      const parsed = JSON.parse(line);
      expect(["info", "warn", "error"]).toContain(parsed.level);
    }
  });

  it("every log entry has event as non-empty string", () => {
    logInfo("event.name");
    logWarn("event.name");
    logError("event.name");
    for (const line of capturedOutput) {
      const parsed = JSON.parse(line);
      expect(typeof parsed.event).toBe("string");
      expect(parsed.event.length).toBeGreaterThan(0);
    }
  });

  it("status is numeric when present", () => {
    logInfo("req", { status: 200 });
    logInfo("req", { status: 404 });
    logInfo("req", { status: 500 });
    for (const line of capturedOutput) {
      const parsed = JSON.parse(line);
      expect(typeof parsed.status).toBe("number");
    }
  });

  it("durationMs is numeric when present", () => {
    logInfo("req", { durationMs: 0 });
    logInfo("req", { durationMs: 1500 });
    for (const line of capturedOutput) {
      const parsed = JSON.parse(line);
      expect(typeof parsed.durationMs).toBe("number");
    }
  });
});
