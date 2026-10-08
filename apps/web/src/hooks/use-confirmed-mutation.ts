"use client";

// Implements: docs/rfc/004-multi-device-network-contract.md web duties —
// C1 (intent key minted once per mutate, same key on retry/replay) +
// C2 (retry via invokeWithRetry, bounded) +
// C3 (queue-on-offline via offline-queue, queued-vs-confirmed marks) with
// optimistic snapshot + rollback on final failure.
// AGENTS.md §2 Rule 9 (typed ConfirmedMutationError, no empty catch, zero
// console.*) + §6 (strict generics, no `any`) + C6 (event-driven flush only —
// this hook never polls; drains run on online/visibilitychange via
// useOnlineFlush in lib/offline-queue.ts).
//
// ── WIRING (documented, NOT wired — adopt per call site, one sketch each) ──
// CONVENTION for action authors: add trailing `intentKey` to the action's
// options/payload bag and forward it to the gateway `idempotency_keys` store
// when C1 lands server-side. Until then the client half (K2) holds.
//
// 1. record-payment — src/components/fees/record-payment-sheet.tsx:67-81
//    Replace the useMutation block with:
//      const confirmed = useConfirmedMutation({
//        tenantId, action: "fees.recordPayment",
//        invoke: (args) => recordPaymentAction(
//          args.studentIdSafe, args.amountPaise, args.description,
//          args.receivedOn,
//          { method: args.method, reference: args.reference,
//            advanceAcknowledged: args.advanceAcknowledged,
//            intentKey: args.intentKey }),
//        snapshot: () => ({ ledger: queryClient.getQueryData(["ledger", studentId]),
//                           students: queryClient.getQueryData(["fees-students"]) }),
//        applyOptimistic: (args) => { /* existing setQueryData blocks, unchanged */ },
//        rollback: (snap) => { /* restore both query datas from snap */ },
//        invalidateKeys: [["ledger"], ["fees-students"]],
//      });
//    and call `confirmed.mutate({...})` from handleSubmit (:192-200). The
//    existing optimistic blocks move verbatim into applyOptimistic/rollback.
//    NOTE: recordPaymentAction must first accept `intentKey` in
//    RecordPaymentOptions (src/server/actions/fees.ts:53-57) — server gap.
//
// 2. attendance-mark — src/components/attendance/attendance-grid.tsx:36-37
//    Replace `mutationFn: (payload) => updateAttendanceAction(payload)` with:
//      const confirmed = useConfirmedMutation({
//        tenantId, action: "attendance.update",
//        invoke: (args) => updateAttendanceAction({ ...args.payload, intentKey: args.intentKey }),
//        snapshot/applyOptimistic/rollback: move the existing
//          cancelQueries/setQueryData blocks (:38-60) verbatim,
//        invalidateKeys: [["attendance"]],
//      });
//    handleToggle/handleBulk (:67-84) call `confirmed.mutate({ payload })`.
//    NOTE: UpdateAttendancePayload (@buddysaradhi/shared) must first accept an
//    optional `intentKey` — shared-schema gap.
//
// 3. settings-save — src/components/settings/profile-section.tsx:80-99
//    Replace updateMutation with:
//      const confirmed = useConfirmedMutation({
//        tenantId, action: "settings.updateBatch",
//        invoke: (args) => updateSettingsBatchAction({ ...args.form, intentKey: args.intentKey }),
//        invalidateKeys: [["settings"]],
//        // No optimistic snapshot: form keeps draft state; onSubmit (:107-109)
//        // calls confirmed.mutate({ form: data }). CONFLICT (C4) surfaces via
//        // ConfirmedMutationError for refresh-and-reapply (new key).
//      });
//    NOTE: updateSettingsBatchAction (src/server/actions/settings.ts:335) must
//    first accept `intentKey` — server gap.
//
// 4. sign-out clear (hook point, read-only finding) —
//    src/components/buddysaradhi/glass-shell.tsx:42-53 onSignOut: call
//    `clearQueue(tenantId)` next to the existing `queryClient.clear()` before
//    `signOutAction()` so queued intents never leak across tenants.

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult } from "@tanstack/react-query";
import { mintIntentKey } from "@/lib/intent-key";
import { invokeWithRetry } from "@/lib/retry-invoke";
import type { ActionResult } from "@/lib/retry-invoke";
import { enqueueIntent, readQueue } from "@/lib/offline-queue";

export type IntentStatus = "idle" | "confirming" | "queued" | "confirmed" | "failed";

/** A confirmed server effect, a queued offline intent, nothing else. */
export type Confirmation<TData> =
  | { state: "confirmed"; data: TData; attempts: number; intentKey: string }
  | { state: "queued"; intentKey: string };

/** Typed final failure: carries the intent key + attempt count for UI/audit. */
export class ConfirmedMutationError extends Error {
  readonly intentKey: string;
  readonly attempts: number;

  constructor(message: string, intentKey: string, attempts: number) {
    super(message);
    this.name = "ConfirmedMutationError";
    this.intentKey = intentKey;
    this.attempts = attempts;
  }
}

export interface ConfirmedMutationConfig<
  TArgs extends Record<string, unknown>,
  TData,
  TSnapshot = unknown,
> {
  tenantId: string;
  /** Queue/drain action name, e.g. "fees.recordPayment". */
  action: string;
  /** Server-action closure — receives the SAME intent key on every attempt. */
  invoke: (args: TArgs & { intentKey: string }) => Promise<ActionResult<TData>>;
  /** Override key derivation (default: fresh mintIntentKey per mutate). */
  keyFor?: (args: TArgs) => string;
  snapshot?: () => TSnapshot | Promise<TSnapshot>;
  applyOptimistic?: (args: TArgs) => void;
  rollback?: (snapshot: TSnapshot | undefined) => void;
  toQueuePayload?: (args: TArgs) => Record<string, unknown>;
  invalidateKeys?: ReadonlyArray<readonly unknown[]>;
  retry?: { attempts?: number; baseMs?: number };
  /** Injectable online check (default: navigator.onLine). */
  isOnline?: () => boolean;
}

export type ConfirmedMutationHandle<
  TArgs extends Record<string, unknown>,
  TData,
  TSnapshot = unknown,
> = UseMutationResult<Confirmation<TData>, ConfirmedMutationError, TArgs, TSnapshot | undefined> & {
  intentStatus: IntentStatus;
  lastIntentKey: string | null;
  queuedCount: number;
};

function defaultIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * CONTRACT
 * ────────
 * OWNS: the lifecycle of ONE server effect that must not be silently dropped.
 *   It mints an intent key, calls `invoke` through a bounded retry with the SAME
 *   key on every attempt (C1/C2), or — when the browser is offline — writes the
 *   intent to the durable queue under that same key and reports `queued` (C3).
 *   It snapshots before, rolls back after, and invalidates the query keys the
 *   caller named.
 * RETURNS: `UseMutationResult<Confirmation<TData>, ConfirmedMutationError, …>`
 *   plus `intentStatus`, `lastIntentKey` and `queuedCount`.
 * ON UNMOUNT: nothing — this hook registers no listener, timer or observer. The
 *   mutation is react-query's to cancel, not this hook's; in-flight work keeps
 *   running and the caller decides whether to `queryClient.cancelQueries`.
 * DELIBERATELY DOES NOT: poll (C6 — draining is event-driven, in
 *   `lib/offline-queue.ts`); retry forever (`invokeWithRetry` is bounded); open a
 *   second dialog or toast (Rule 9 is this hook's job — it throws a typed
 *   `ConfirmedMutationError` and the caller decides how to say it); or decide
 *   `isOnline` for the caller (injectable, and read ONCE per mutate — a device
 *   that drops mid-retry finishes the retry rather than half-queueing).
 *
 * TWO THINGS A CALLER MUST KNOW, because they are the shape of the thing and not
 * obvious from the types.
 *
 * 1. `intentStatus` is terminal once it reaches `confirmed` / `queued` / `failed`
 *    — it is NOT a "pending" flag and does not return to `idle`. Use
 *    `isPending` for "is a request in flight". The distinction matters: a sheet
 *    that disables its Save on `intentStatus !== "idle"` stays disabled forever
 *    after one use, which is a bug the previous draft invited.
 * 2. `snapshot()` is called in `onMutate` and is NOT wrapped. If it rejects, the
 *    mutation rejects with THAT error, not with a `ConfirmedMutationError`, and
 *    `rollback` is called with `undefined`. Read `error instanceof
 *    ConfirmedMutationError` before touching `error.intentKey`, and make
 *    `snapshot` total.
 *
 * SSR: `queuedCount` starts at 0 and is filled in after mount. Reading the queue
 * during the first render — which is also the render React uses to match server
 * markup — compares an empty server-side fallback against the browser's real
 * queue and produces a hydration mismatch for any tutor with a queued intent.
 * Same reason `settings-store`/`attendance-store` set `skipHydration`.
 */
export function useConfirmedMutation<
  TArgs extends Record<string, unknown>,
  TData,
  TSnapshot = unknown,
>(config: ConfirmedMutationConfig<TArgs, TData, TSnapshot>): ConfirmedMutationHandle<TArgs, TData, TSnapshot> {
  const queryClient = useQueryClient();
  const online = config.isOnline ?? defaultIsOnline;
  const [intentStatus, setIntentStatus] = useState<IntentStatus>("idle");
  const [lastIntentKey, setLastIntentKey] = useState<string | null>(null);
  // 0 until after mount — see the SSR note in the doc comment above.
  const [queuedCount, setQueuedCount] = useState<number>(0);

  useEffect(() => {
    setQueuedCount(readQueue(config.tenantId).items.length);
  }, [config.tenantId]);

  const mutation = useMutation<
    Confirmation<TData>,
    ConfirmedMutationError,
    TArgs,
    TSnapshot | undefined
  >({
    mutationFn: async (args: TArgs): Promise<Confirmation<TData>> => {
      const key = config.keyFor ? config.keyFor(args) : mintIntentKey();
      if (!online()) {
        const payload = config.toQueuePayload ? config.toQueuePayload(args) : { ...args };
        const queued = enqueueIntent(config.tenantId, { action: config.action, payload, key });
        if (!queued.ok) {
          throw new ConfirmedMutationError(queued.error, key, 0);
        }
        return { state: "queued", intentKey: key };
      }
      const outcome = await invokeWithRetry<TData>(
        (intentKey) => config.invoke({ ...args, intentKey }),
        { key, attempts: config.retry?.attempts, baseMs: config.retry?.baseMs },
      );
      if (!outcome.success) {
        throw new ConfirmedMutationError(outcome.error, key, outcome.attempts);
      }
      return { state: "confirmed", data: outcome.data, attempts: outcome.attempts, intentKey: key };
    },
    onMutate: async (args: TArgs): Promise<TSnapshot | undefined> => {
      setIntentStatus("confirming");
      const snapshot = config.snapshot ? await config.snapshot() : undefined;
      config.applyOptimistic?.(args);
      return snapshot;
    },
    onSuccess: (data) => {
      setLastIntentKey(data.intentKey);
      if (data.state === "queued") {
        setIntentStatus("queued");
        setQueuedCount(readQueue(config.tenantId).items.length);
        return;
      }
      setIntentStatus("confirmed");
      for (const queryKey of config.invalidateKeys ?? []) {
        void queryClient.invalidateQueries({ queryKey: [...queryKey] });
      }
    },
    onError: (error, _args, context) => {
      if (error instanceof ConfirmedMutationError) {
        setLastIntentKey(error.intentKey);
      }
      setIntentStatus("failed");
      config.rollback?.(context);
    },
  });

  return { ...mutation, intentStatus, lastIntentKey, queuedCount };
}
