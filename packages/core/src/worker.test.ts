// Implements: 19_Concurrency_and_Testing.md (multithreaded execution —
// CPU-heavy work leaves the event loop; the pool is the mechanism),
// AGENTS.md §2 Rule 9 (typed rejection, never a silent hang) + §7.1 (unit).
//
// Real `worker_threads` Workers from fixture files written to the OS temp
// dir at runtime (no new repo files). No mocks: every task runs on a genuine
// OS thread and resolves/rejects through the real pool.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { WorkerPool, globalWorkerPool } from "./worker";

let fixtureDir: string;
let echoWorker: string;
let boomWorker: string;
let exitWorker: string;

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "worker-test-"));
  echoWorker = join(fixtureDir, "echo.js");
  boomWorker = join(fixtureDir, "boom.js");
  exitWorker = join(fixtureDir, "exit2.js");
  writeFileSync(
    echoWorker,
    `const { parentPort, workerData } = require("worker_threads");
parentPort.postMessage({ echo: workerData });\n`,
  );
  writeFileSync(boomWorker, `throw new Error("boom");\n`);
  writeFileSync(exitWorker, `process.exit(2);\n`);
});

afterAll(() => {
  try {
    rmSync(fixtureDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("WorkerPool construction (19_Concurrency)", () => {
  it("builds with an explicit worker cap", async () => {
    const pool = new WorkerPool(2);
    await expect(pool.runTask(echoWorker, { n: 1 })).resolves.toEqual({
      echo: { n: 1 },
    });
  });

  it("exposes a shared global pool", () => {
    expect(globalWorkerPool).toBeInstanceOf(WorkerPool);
  });
});

describe("WorkerPool.runTask success path (Rule 9 — every task settles)", () => {
  it("echoes workerData back from a real OS thread", async () => {
    const pool = new WorkerPool(2);
    await expect(pool.runTask(echoWorker, { hello: "world" })).resolves.toEqual({
      echo: { hello: "world" },
    });
  });

  it("drains a queue longer than the cap in submission order", async () => {
    const pool = new WorkerPool(1);
    const results = await Promise.all(
      [0, 1, 2, 3].map((n) => pool.runTask(echoWorker, { n })),
    );
    expect(results).toEqual([{ echo: { n: 0 } }, { echo: { n: 1 } }, { echo: { n: 2 } }, { echo: { n: 3 } }]);
  });

  it("reuses the pool across sequential batches", async () => {
    const pool = new WorkerPool(2);
    for (let batch = 0; batch < 3; batch++) {
      await expect(pool.runTask(echoWorker, { batch })).resolves.toEqual({
        echo: { batch },
      });
    }
  });
});

describe("WorkerPool.runTask failure paths (Rule 9 — typed rejection, never silent)", () => {
  it("rejects when the worker throws", async () => {
    const pool = new WorkerPool(1);
    await expect(pool.runTask(boomWorker, {})).rejects.toThrow();
  });

  it("rejects with the exit code when the worker exits non-zero", async () => {
    const pool = new WorkerPool(1);
    await expect(pool.runTask(exitWorker, {})).rejects.toThrow(
      /exit code 2/,
    );
  });

  it("rejects when the worker file does not exist", async () => {
    const pool = new WorkerPool(1);
    await expect(
      pool.runTask(join(fixtureDir, "no-such-worker.js"), {}),
    ).rejects.toThrow();
  });

  it("keeps serving tasks after a failure", async () => {
    const pool = new WorkerPool(1);
    await expect(pool.runTask(boomWorker, {})).rejects.toThrow();
    await expect(pool.runTask(echoWorker, { after: "failure" })).resolves.toEqual({
      echo: { after: "failure" },
    });
  });
});
