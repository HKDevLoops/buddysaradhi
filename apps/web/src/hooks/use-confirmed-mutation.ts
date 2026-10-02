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

import { useState } from "react";
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
 * react-query useMutation wired with intent-key + retry + offline queue.
 * Online → retrying invoke (same key), rollback on final failure.
 * Offline → enqueue (same key), optimistic state kept, marked queued.
 * Single-flight UI assumed (all three call sites disable submit while
 * pending); the intent key travels inside the Confirmation result, not refs.
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
  const [queuedCount, setQueuedCount] = useState<number>(() =>
    config.tenantId ? readQueue(config.tenantId).items.length : 0,
  );

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
