// Implements: docs/rfc/004-multi-device-network-contract.md web duties
// (C1+C2+C3 via useConfirmedMutation: same-key retry, queue-on-offline,
// optimistic snapshot + rollback). Uses @testing-library/react renderHook.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import {
  useConfirmedMutation,
  ConfirmedMutationError,
  type ConfirmedMutationConfig,
} from "./use-confirmed-mutation";
import { isIntentKey } from "@/lib/intent-key";
import { queueKeyFor, readQueue } from "@/lib/offline-queue";

type Args = Record<string, unknown>;

function makeWrapper(): { Wrapper: (props: { children: ReactNode }) => ReactNode; client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = (props: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  );
  return { Wrapper, client };
}

const TENANT = "hook-test-tenant";

beforeEach(() => {
  window.localStorage.removeItem(queueKeyFor(TENANT));
});

afterEach(() => {
  window.localStorage.removeItem(queueKeyFor(TENANT));
  vi.clearAllMocks();
});

describe("useConfirmedMutation (RFC-004 web duties)", () => {
  it("confirms online with a valid intent key, applies optimistic, invalidates", async () => {
    const { Wrapper, client } = makeWrapper();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const seenKeys: string[] = [];
    let applied = 0;
    let rolledBack = 0;
    const config: ConfirmedMutationConfig<Args, string, { n: number }> = {
      tenantId: TENANT,
      action: "test.confirm",
      invoke: (args) => {
        seenKeys.push(args.intentKey);
        return Promise.resolve({ success: true as const, data: `ok:${String(args["n"])}` });
      },
      snapshot: () => ({ n: 1 }),
      applyOptimistic: () => {
        applied += 1;
      },
      rollback: () => {
        rolledBack += 1;
      },
      invalidateKeys: [["ledger"]],
      retry: { attempts: 1, baseMs: 1 },
      isOnline: () => true,
    };
    const { result } = renderHook(() => useConfirmedMutation(config), { wrapper: Wrapper });
    let data: unknown = null;
    await act(async () => {
      data = await result.current.mutateAsync({ n: 5 });
    });
    expect(data).toMatchObject({ state: "confirmed", attempts: 1 });
    expect(seenKeys).toHaveLength(1);
    expect(isIntentKey(seenKeys[0])).toBe(true);
    expect(applied).toBe(1);
    expect(rolledBack).toBe(0);
    expect(result.current.intentStatus).toBe("confirmed");
    expect(result.current.lastIntentKey).toBe(seenKeys[0]);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["ledger"] });
  });

  it("retries with the SAME key and rolls back on final failure (typed error)", async () => {
    const { Wrapper } = makeWrapper();
    const seenKeys: string[] = [];
    let snapshots = 0;
    let rollbacks = 0;
    const config: ConfirmedMutationConfig<Args, string, { n: number }> = {
      tenantId: TENANT,
      action: "test.retry",
      invoke: (args) => {
        seenKeys.push(args.intentKey);
        if (seenKeys.length === 1) return Promise.resolve({ success: false as const, error: "UPSTREAM: timeout" });
        return Promise.resolve({ success: true as const, data: "replayed" });
      },
      snapshot: () => {
        snapshots += 1;
        return { n: 9 };
      },
      rollback: () => {
        rollbacks += 1;
      },
      retry: { attempts: 3, baseMs: 1 },
      isOnline: () => true,
    };
    const { result } = renderHook(() => useConfirmedMutation(config), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ n: 1 });
    });
    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[0]).toBe(seenKeys[1]);
    expect(rollbacks).toBe(0);

    // Final failure path: fatal error → rollback with the snapshot.
    const failing: ConfirmedMutationConfig<Args, string, { n: number }> = {
      ...config,
      invoke: () => Promise.resolve({ success: false as const, error: "VALIDATION: bad amount" }),
      retry: { attempts: 2, baseMs: 1 },
    };
    const second = renderHook(() => useConfirmedMutation(failing), { wrapper: Wrapper });
    let thrown: unknown = null;
    await act(async () => {
      try {
        await second.result.current.mutateAsync({ n: 2 });
      } catch (err) {
        thrown = err;
      }
    });
    expect(thrown).toBeInstanceOf(ConfirmedMutationError);
    if (!(thrown instanceof ConfirmedMutationError)) {
      throw new Error(`expected ConfirmedMutationError, got ${String(thrown)}`);
    }
    expect(thrown.attempts).toBe(1); // fatal: no retry
    expect(second.result.current.intentStatus).toBe("failed");
    expect(rollbacks).toBe(1);
    expect(snapshots).toBe(2);
  });

  it("queues while offline with the same key, keeps optimistic, marks queued", async () => {
    const { Wrapper } = makeWrapper();
    const invoke = vi.fn();
    let applied = 0;
    let rolledBack = 0;
    const config: ConfirmedMutationConfig<Args, string, { n: number }> = {
      tenantId: TENANT,
      action: "fees.recordPayment",
      invoke,
      snapshot: () => ({ n: 0 }),
      applyOptimistic: () => {
        applied += 1;
      },
      rollback: () => {
        rolledBack += 1;
      },
      isOnline: () => false,
    };
    const { result } = renderHook(() => useConfirmedMutation(config), { wrapper: Wrapper });
    let data: unknown = null;
    await act(async () => {
      data = await result.current.mutateAsync({ studentId: "s-1", amountPaise: 50000 });
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(data).toMatchObject({ state: "queued" });
    expect(result.current.intentStatus).toBe("queued");
    expect(result.current.queuedCount).toBe(1);
    expect(applied).toBe(1); // optimistic kept
    expect(rolledBack).toBe(0); // no rollback for queued
    const queued = readQueue(TENANT).items;
    expect(queued).toHaveLength(1);
    expect(queued[0]?.action).toBe("fees.recordPayment");
    expect(queued[0]?.payload).toEqual({ studentId: "s-1", amountPaise: 50000 });
    expect(queued[0]?.key).toBe((data as { intentKey: string }).intentKey);
  });
});
