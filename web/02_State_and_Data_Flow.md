# 02 — State & Data Flow (Web)

> The state architecture for the Buddysaradhi web surface. Three layers, two cache hierarchies, one immutable invariant (the ledger), and a 30-second pulse that keeps the web app in sync with mobile and desktop. Every store, every Query key, every optimistic update in this file is the contract.

---

## 1. The Three Layers

Web state in Buddysaradhi is a strict three-layer cake. Each layer has a single responsibility; data flows down, mutations flow up, and the layers never bypass each other.

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1 — SERVER STATE (source of truth)                       │
│  ─────────────────────────────────────                          │
│  • Turso (libSQL) per-user DB — every table, the ledger, audit  │
│  • Supabase Auth — identity root (auth.users)                   │
│  • Read via RSC (src/server/queries/*) or Server Action         │
│  • Written via Server Action (src/server/actions/*)             │
│  • Every mutation appends to sync_outbox (BR-SYN-01)              │
└────────────────────────────────┬────────────────────────────────┘
                                 │ fetch / action RPC
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2 — CLIENT SERVER-STATE (TanStack Query v5)              │
│  ──────────────────────────────────────────                     │
│  • Mirrors server state in the browser                          │
│  • staleTime + gcTime per entity                                │
│  • Query keys are stable strings: ['students','list',{cursor}]  │
│  • Optimistic updates via setQueryData in onMutate              │
│  • Invalidated on Server Action success                         │
└────────────────────────────────┬────────────────────────────────┘
                                 │ selector
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3 — CLIENT UI STATE (Zustand v5)                         │
│  ──────────────────────────────                                 │
│  • Ephemeral UI: selected student, drawer open, filter chips    │
│  • Persisted slices via idb-keyval (last active screen, theme)  │
│  • useDashboardStore, useStudentsStore, useAttendanceStore...   │
│  • Never holds server data — only IDs + UI flags                │
└─────────────────────────────────────────────────────────────────┘
```

### 1.1 Why Three Layers (not one)

A single global store (Redux-style) bundles three concerns that have different lifetimes and different consistency models:

- **Server data** changes on other devices; it must be refreshable and conflict-resolvable.
- **Server-cache** data must be invalidated when mutations land.
- **UI state** is per-tab and ephemeral; it must survive route changes but not device changes.

Splitting them lets each layer use the right tool: TanStack Query for cache invalidation, Zustand for ephemeral UI, the per-user Turso DB for the canonical record. The cost is two libraries instead of one — a worthwhile tradeoff.

### 1.2 What Lives Where (Quick Map)

| State | Layer | Example |
|---|---|---|
| Student list | 1 (server) → 2 (Query cache) | `useQuery(['students','list',cursor])` |
| Selected student ID | 3 (Zustand) | `useStudentsStore(s => s.selectedId)` |
| Drawer open? | 3 (Zustand) | `useStudentsStore(s => s.drawerOpen)` |
| Ledger entries (immutable) | 1 → 2 (cache never expires) | `useQuery(['ledger','list',studentId])` |
| Today's attendance grid | 1 → 2 (`staleTime: 0`) | `useQuery(['attendance','grid',batchId,date])` |
| PIN entry (transient) | 3 (Zustand, never persisted) | `useSettingsStore(s => s.pinEntry)` |
| Theme (dark only) | 3 (Zustand, persisted to idb) | `useSettingsStore(s => s.theme)` |
| Sync status | 3 (Zustand, transient) | `useSyncStore(s => s.status)` |

---

## 2. Layer 1 — Server State

### 2.1 The Source of Truth — Turso (libSQL)

Every tutor has their own Turso DB (`db-{user_uuid}`). The schema is in top-level `11_Data_Model.md` §4. Every read on the web app goes through `@libsql/client` HTTP — there is **no embedded replica** on web (the embedded replica is mobile/desktop only, per top-level `02_Core_Logic.md` §9). The web client makes HTTP requests to the Turso endpoint with the scoped JWT in the `Authorization` header.

Server-side reads use `src/lib/turso/server.ts`:

```ts
import { createClient } from "@libsql/client";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function getTursoClient() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("UNAUTHENTICATED");

  const dbUrl = session.user.user_metadata?.db_url as string | undefined;
  const dbToken = session.user.user_metadata?.db_token as string | undefined;
  if (!dbUrl || !dbToken) throw new Error("UNPROVISIONED");

  return createClient({ url: dbUrl, authToken: dbToken });
}
```

This client is **per-request**: it is created inside an RSC or Server Action, used once, and discarded. There is no connection pooling on the server because libSQL HTTP is stateless — each query is a single HTTPS call to the Turso endpoint.

### 2.2 The Identity Root — Supabase

`auth.users` in Supabase is the identity root. The Supabase JWT carries `user_metadata.db_url` and `user_metadata.db_token` (set by the provisioning Edge Function — see `03_Auth_and_Provisioning.md` §4). The server never sees the Supabase service-role key outside of the Edge Function env.

### 2.3 Writes — Server Actions Only

Every mutation runs in a Server Action (`src/server/actions/*`). The action:

1. Parses input with a Zod schema (`src/server/schemas/*`). On parse failure → return `Err({ code: 'VALIDATION', issues })`.
2. Verifies the user is authenticated and provisioned (calls `getTursoClient()`).
3. Runs the mutation inside a single libSQL `batch()` call — `INSERT` + `sync_outbox` INSERT + `audit_log` INSERT in the same transaction (BR-SYN-01, top-level `AGENTS.md` Rule 7).
4. Returns `Ok({ id, ... })` on success or `Err({ code, ... })` on failure.

For the ledger specifically: the action **never** runs an `UPDATE` or `DELETE` on `ledger_entries`. The libSQL trigger `ledger_no_update_delete` (top-level `11_Data_Model.md` §10) will abort the transaction with `RAISE(ABORT, 'ledger_entries is append-only. Post a reversing entry.')`. This is the load-bearing invariant of the system (top-level `AGENTS.md` Rule 1).

### 2.4 The `sync_outbox` Table — Bridge to Mobile/Desktop

Every mutation appends a row to `sync_outbox` in the same transaction. The row carries the entity type, the entity ID, the operation (`INSERT`/`UPDATE`/`VOID`), and the timestamp. Mobile and desktop embedded-replica clients pull this table on their sync schedule and apply the changes to their local SQLite (top-level `12_Business_Rules.md` BR-SYN-01..03).

On web, `sync_outbox` is **append-only**; the web app does not flush it (it has no local replica to flush to). It exists in the per-user Turso DB purely as the canonical mutation log for other devices.

---

## 3. Layer 2 — TanStack Query v5

### 3.1 The QueryClient

One `QueryClient` per browser tab. Created in `src/app/providers.tsx` (Client Component wrapping the root layout's children) and reused across route transitions.

```tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,      // 30s default
            gcTime: 5 * 60_000,     // 5 min
            retry: (failCount, err) =>
              err.message === "UNAUTHENTICATED" ? false : failCount < 2,
            refetchOnWindowFocus: true,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

### 3.2 Per-Entity `staleTime` / `gcTime`

| Entity | `staleTime` | `gcTime` | Rationale |
|---|---|---|---|
| `students` list | 30 s | 5 min | High churn potential; refresh on focus. |
| `students` detail | 60 s | 10 min | Lower churn; deeper fetch. |
| `ledger` entries (immutable) | `Infinity` | `Infinity` | Never stale — the ledger is append-only. New rows arrive via optimistic update or `invalidateQueries` after a successful action. |
| `attendance` grid (today) | 0 s | 1 min | Always refetch on focus; today's data is volatile. |
| `attendance` grid (past) | `Infinity` | 1 h | Locked historical data; immutable. |
| `fees` matrix | 30 s | 5 min | Derived from ledger; refresh on focus. |
| `reports` | 5 min | 30 min | Computed; low churn. |
| `settings` | `Infinity` | 1 h | Mutated only via explicit action; invalidate manually. |

The ledger's `Infinity` staleTime is deliberate: ledger rows are immutable, so a cached read is correct forever. New rows invalidate the query via `queryClient.invalidateQueries({ queryKey: ['ledger','list',studentId] })` inside the Server Action's `onSuccess` callback.

### 3.3 Query Key Convention

```
['students','list',{ cursor, limit, filter }]        → paginated list
['students','detail', studentId]                     → single student
['ledger','list', studentId]                         → student ledger (immutable)
['attendance','grid', batchId, date]                 → batch grid for date
['fees','matrix', { month, batchId }]                → fees matrix
['reports', type, { from, to, format }]              → reports
['settings']                                         → singleton
```

Keys are arrays of strings + plain objects (for serialisable params). Never include functions or class instances.

### 3.4 The 30-Second libSQL HTTP Polling Loop

The web app does not use libSQL's embedded replica. Instead, a `useSyncPoll` hook fetches a sync delta every 30 seconds from the user's Turso DB via a Server Action (or `/api/sync/pull`):

```ts
"use client";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pullSyncDelta } from "@/server/actions/sync";

export function useSyncPoll(enabled: boolean) {
  const qc = useQueryClient();
  const lastSyncAt = useRef<string>(new Date(0).toISOString());

  useEffect(() => {
    if (!enabled) return;
    const tick = async () => {
      const res = await pullSyncDelta({ since: lastSyncAt.current });
      if (res.ok) {
        lastSyncAt.current = res.value.serverTime;
        for (const key of res.value.invalidatedKeys) {
          qc.invalidateQueries({ queryKey: key });
        }
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [enabled, qc]);
}
```

The Server Action `pullSyncDelta` runs:

```sql
SELECT entity_type, entity_id, operation, created_at
  FROM sync_outbox
  WHERE created_at > ?
  ORDER BY created_at ASC
  LIMIT 500;
```

It returns the list of `(entityType, entityId)` pairs that changed; the client maps each to a Query key and invalidates. The actual data is fetched on the next `useQuery` render — no payload bloat.

### 3.5 Optimistic Updates

Ledger writes are optimistic by default. The pattern:

```tsx
const mutation = useMutation({
  mutationFn: (input: PaymentInput) => recordPaymentAction(input),
  onMutate: async (input) => {
    await qc.cancelQueries({ queryKey: ["ledger", "list", input.studentId] });
    const prev = qc.getQueryData<LedgerEntry[]>(["ledger", "list", input.studentId]);
    const optimistic: LedgerEntry = {
      id: `optimistic-${Date.now()}`,
      type: "PAYMENT_RECEIVED",
      direction: "credit",
      amount_paise: input.amountPaise,
      occurred_on: input.receivedOn,
      reverses_entry_id: null,
      tamper_hash: "pending",
      created_at: new Date().toISOString(),
      is_optimistic: true,
    };
    qc.setQueryData<LedgerEntry[]>(
      ["ledger", "list", input.studentId],
      (old = []) => [...old, optimistic]
    );
    return { prev };
  },
  onError: (_err, input, ctx) => {
    if (ctx?.prev) qc.setQueryData(["ledger", "list", input.studentId], ctx.prev);
    toast.error("Payment failed — rolled back");
  },
  onSettled: (_data, _err, input) => {
    qc.invalidateQueries({ queryKey: ["ledger", "list", input.studentId] });
    qc.invalidateQueries({ queryKey: ["fees", "matrix"] });
    qc.invalidateQueries({ queryKey: ["dashboard", "kpis"] });
  },
});
```

Key invariants:

1. The optimistic entry carries `is_optimistic: true` so the UI can render it with an amber dot (pending) instead of emerald (committed).
2. `onError` rolls back to `prev`. The user sees the row vanish with a flare toast.
3. `onSettled` invalidates three queries: the ledger (to fetch the real row with the real `tamper_hash`), the fees matrix (the student's paid/unpaid status changed), and the dashboard KPIs (the "collected today" number changed).

The same deferred-state pattern — render the server-known value first, swap in the client-detected value in a `useEffect` after hydration — is what makes the `HeroPlatformBadge` island on the commercial landing page hydration-safe (`07_Landing_Page.md §4.2`). The server HTML and the first client paint must match; the platform-specific string updates only after `navigator.userAgent` is available.

Cross-references: ledger invariants in top-level `12_Business_Rules.md` §3 (BR-LED-*); optimistic UI in top-level `02_Core_Logic.md` §6.1; the deferred-state pattern on the marketing surface in `07_Landing_Page.md §4.2`.

### 3.6 Schema Bootstrap on First Login

When a new user logs in and has no `user_metadata.db_url`, the middleware redirects to `/signup/provision`. The provision page runs a Server Action that calls `/api/provision` (see `04_API_Routes.md` §3), which:

1. Calls the Turso Platform API to create `db-{user_uuid}`.
2. Issues a scoped JWT (`db_url` + `db_token` claims, 1-year expiry).
3. Writes the JWT into Supabase `user_metadata` via the Edge Function.
4. Returns the `db_url` + `db_token` to the client.
5. The client calls `bootstrapSchema(dbUrl, dbToken)` which runs the forward-only migrations from `migrations/0001_init.sql` through `0010_*.sql` against the new DB.
6. The client navigates to `/dashboard`, which shows the empty state (top-level `02_Core_Logic.md` §3.1).

Cross-references: full provisioning flow in `03_Auth_and_Provisioning.md` §4.

---

## 4. Layer 3 — Zustand v5 (Client UI State)

### 4.1 Store Catalogue

| Store | File | Persisted? | Holds |
|---|---|---|---|
| `useDashboardStore` | `src/stores/dashboard.ts` | No | Date filter, period chip, quick-action queue. |
| `useStudentsStore` | `src/stores/students.ts` | No | `selectedId`, `drawerOpen`, `filter`, `mergeCandidateIds`. |
| `useAttendanceStore` | `src/stores/attendance.ts` | No | `selectedDate`, `selectedBatchId`, `markingState`. |
| `useFeesStore` | `src/stores/fees.ts` | No | `selectedStudentId`, `receiptFormOpen`, `voidTargetId`. |
| `useSettingsStore` | `src/stores/settings.ts` | Partial (theme) | `activeTab`, `pinEntry`, `biometricEnrolling`, `theme`. |
| `useSyncStore` | `src/stores/sync.ts` | No | `status: 'idle'\|'syncing'\|'offline'`, `pendingCount`, `lastSyncAt`. |
| `useCommandPaletteStore` | `src/stores/command-palette.ts` | No | `open: boolean`. |
| `useShellStore` | `src/stores/shell.ts` | Yes (last screen) | `activeScreen`, `sidebarCollapsed`. |

### 4.2 Store Rules

1. **Never hold server data.** A Zustand store holds IDs and UI flags only. The actual data (student names, ledger amounts) lives in TanStack Query. This keeps the stores tiny and avoids two-source-of-truth bugs.
2. **Persisted slices use `idb-keyval`.** The `persist` middleware writes the slice to IndexedDB. Never use `localStorage` — it's synchronous and blocked by the sandbox CSP.
3. **No cross-store coupling.** A store never imports another store. Cross-store coordination happens in a React Component (`useShellStore` reads `useStudentsStore.selectedId` to decide the sidebar active item — that logic lives in `GlassShell`, not in the stores themselves).
4. **Selectors are stable.** Each component reads the smallest slice: `useStudentsStore(s => s.drawerOpen)`. Never `useStudentsStore()` wholesale — it re-renders on every change.

### 4.3 Example Store — `useStudentsStore`

```ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";

interface StudentsState {
  selectedId: string | null;
  drawerOpen: boolean;
  filter: "all" | "active" | "archived" | "in-arrears";
  mergeCandidateIds: string[];
  setSelected: (id: string | null) => void;
  setDrawerOpen: (open: boolean) => void;
  setFilter: (f: StudentsState["filter"]) => void;
  reset: () => void;
}

const idbStorage = {
  getItem: async (name: string) => (await idbGet(name)) ?? null,
  setItem: async (name: string, value: string) => await idbSet(name, value),
  removeItem: async (name: string) => await idbDel(name),
};

export const useStudentsStore = create<StudentsState>()(
  persist(
    (set) => ({
      selectedId: null,
      drawerOpen: false,
      filter: "all",
      mergeCandidateIds: [],
      setSelected: (id) => set({ selectedId: id, drawerOpen: id !== null }),
      setDrawerOpen: (open) => set({ drawerOpen: open }),
      setFilter: (f) => set({ filter: f }),
      reset: () =>
        set({ selectedId: null, drawerOpen: false, filter: "all", mergeCandidateIds: [] }),
    }),
    {
      name: "buddysaradhi.students",
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ filter: s.filter }), // only persist the filter
    }
  )
);
```

---

## 5. Cache Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│  TanStack Query (in-memory)                             │
│  • Per-tab, per-QueryClient                            │
│  • Hit: <1 ms                                          │
│  • Miss → falls through to IndexedDB                   │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  IndexedDB (via idb-keyval)                             │
│  • Per-origin, per-tab session                          │
│  • Hit: ~5 ms                                           │
│  • Miss → falls through to Server Action                │
│  • Invalidation: explicit `qc.invalidateQueries()`      │
│    propagates a "delete from idb" for that key          │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Server (RSC fetch / Server Action)                     │
│  • Per-request                                          │
│  • Hit: 50-200 ms (Turso HTTP roundtrip)               │
│  • Miss → 500 / 503 to the client                       │
└─────────────────────────────────────────────────────────┘
```

The IndexedDB layer is a **read-through cache** — the client checks TanStack first, then IndexedDB, then the server. On a server hit, the response is written back to both IndexedDB and TanStack. On a mutation, the Server Action's `onSettled` invalidates TanStack (which marks the entry stale) and deletes the IndexedDB entry (which forces the next read to hit the server).

### 5.1 What Gets Cached in IndexedDB

- **Ledger entries** (immutable, large) — cached for offline read.
- **Student list** (page 1 only) — cached for instant dashboard.
- **Settings** — cached for instant `GlassShell` render.
- **Today's attendance grid** — cached for the 30s poll cycle.

### 5.2 What Does NOT Get Cached

- **PIN hash, biometric credentials** — never IndexedDB; OS keychain/WebAuthn only.
- **`tenant_secret`** — server-only; never leaves the Turso DB.
- **Sync outbox** — server-only; never read on web.

### 5.3 Logout Wipe (BR-SEC-04)

On logout, the client calls `wipeLocalCache()` which:

1. `qc.clear()` — drops all TanStack queries.
2. `await idbClear()` — clears all `buddysaradhi.*` keys from IndexedDB.
3. `useShellStore.getState().reset()` + every other store's `.reset()`.
4. `supabase.auth.signOut()` — clears the Supabase cookie.
5. `router.replace('/login')`.

The wipe is mandatory — a shared computer must not leak a prior tutor's roster. Cross-references: top-level `10_Security.md` §4 (BR-SEC-04 logout discipline).

---

## 6. Validation — Zod Before DB

Every Server Action, every API route, every form submission parses its input with a Zod schema before touching the DB. The schemas live in `src/server/schemas/` and are the single source of truth for TypeScript types (`type Student = z.infer<typeof StudentSchema>`, top-level `AGENTS.md` §6.1).

```ts
// src/server/schemas/student.ts
import { z } from "zod";

export const StudentInputSchema = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(0).max(60),
  code: z.string().regex(/^[A-Z]{2,4}-\d{3,4}$/),
  phone: z.string().regex(/^\+91\d{10}$/).optional(),
  email: z.string().email().optional(),
  grade: z.string().min(1).max(20),
  batchIds: z.array(z.string().uuid()).max(5),
  feePlanId: z.string().uuid().optional(),
});

export type StudentInput = z.infer<typeof StudentInputSchema>;
```

The Server Action:

```ts
"use server";
import { StudentInputSchema } from "@/server/schemas/student";
import { getTursoClient } from "@/lib/turso/server";
import type { Result } from "@/lib/types";

export async function createStudentAction(
  raw: unknown
): Promise<Result<{ id: string }, { code: string; issues?: unknown }>> {
  const parsed = StudentInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION", issues: parsed.error.issues } };
  }
  const db = await getTursoClient();
  // ... INSERT + sync_outbox + audit_log in a batch()
  return { ok: true, value: { id: newId } };
}
```

The `Result<T, E>` type is the project's error channel — Server Actions never throw; they return `Err`. The Client island's `useMutation` `onError` runs only on network/transport errors, not on application errors (those arrive as `Ok({ ok: false, ... })` and are handled in `onSuccess`).

Cross-references: Result type and "no silent failures" in top-level `AGENTS.md` Rule 9 and AP-9.

---

## 7. The Cross-Device Sync Story (Web's Role)

The web app is one of three surfaces (web, mobile, desktop) that share the same per-user Turso DB. The sync model is **last-writer-wins (LWW)** by `updated_at`, except for the ledger which is **append-only** and therefore conflict-immune (top-level `12_Business_Rules.md` BR-SYN-02).

```
                ┌─────────────────┐
                │  Turso DB       │
                │  db-{user_uuid} │
                │  (canonical)    │
                └────┬────────┬───┘
                     │        │
       HTTP poll 30s │        │ libSQL embedded replica
                     │        │ (mobile + desktop)
                     ▼        ▼
              ┌─────────┐  ┌─────────────────┐
              │   Web   │  │ Mobile / Desktop│
              │ (no     │  │ (embedded       │
              │  replica)│  │  replica +      │
              │         │  │  sync_outbox    │
              │         │  │  flush)         │
              └─────────┘  └─────────────────┘
```

The web app **reads** from the canonical DB directly (no replica) and **writes** via Server Actions that append to `sync_outbox`. Mobile/desktop pull `sync_outbox` to keep their local replica fresh; they push their own writes via libSQL's embedded-replica sync protocol, which the web app picks up on the next 30-second poll.

The web app never has to resolve a conflict because it never holds a stale copy of mutable rows for more than 30 seconds — the poll invalidates the relevant Query keys, and the next render fetches fresh data.

---

## 8. Common Pitfalls (Anti-Patterns)

| # | Anti-pattern | Why wrong | Fix |
|---|---|---|---|
| 1 | Storing ledger rows in Zustand | Ledger is server-canonical; Zustand is per-tab UI. | Use `useQuery(['ledger','list',studentId])`. |
| 2 | Mutating `ledger_entries` via `UPDATE` | Append-only invariant (Rule 1, BR-LED-06). | INSERT a `VOID` row with `reverses_entry_id`. |
| 3 | Skipping `sync_outbox` on a mutation | Other devices won't see the change (BR-SYN-01). | Append the outbox row in the same `batch()`. |
| 4 | Caching the fees matrix with `staleTime: Infinity` | The matrix is derived from the ledger; it goes stale on every payment. | `staleTime: 30_000`. |
| 5 | Using `localStorage` instead of IndexedDB | Blocked by the sandbox CSP; synchronous. | `idb-keyval`. |
| 6 | Calling `fetch('/api/...')` from a Client Component | Bypasses Server Action type safety (FM-05). | Use a Server Action. |
| 7 | Forgetting `qc.invalidateQueries` after a mutation | UI shows stale data. | Always invalidate in `onSettled`. |
| 8 | Using a `number` (float) for money in any cache | Float drift (Rule 6, BR-M-01). | `bigint` or safe-integer paise. |
| 9 | Persisting `pinEntry` to IndexedDB | PIN must never touch disk. | Transient Zustand slice only. |
| 10 | Skipping the wipe on logout | Shared computer leak (BR-SEC-04). | `wipeLocalCache()` in the logout action. |

---

## 9. Cross-References

- Top-level `11_Data_Model.md` §4 — the schema (every table, every column).
- Top-level `12_Business_Rules.md` §9 — `BR-SYN-*` (sync rules: BR-SYN-01 stub, BR-SYN-02..06 LWW + outbox, BR-SYN-07 v2 unlock, BR-SYN-08/09 conflict).
- Top-level `12_Business_Rules.md` §3 — BR-LED-* (ledger rules: append-only, tamper hash, void cascade).
- Top-level `12_Business_Rules.md` §12c — BR-M-01 (integer paise; all `*_minor` columns are `INTEGER NOT NULL`).
- Top-level `10_Security.md` §4 — BR-SEC-04 logout wipe.
- Top-level `02_Core_Logic.md` §9 — the sync engine deep dive.
- This directory's `01_Architecture.md` §4 — RSC vs Client island table.
- This directory's `03_Auth_and_Provisioning.md` — Supabase session, provisioning.
- This directory's `04_API_Routes.md` — `/api/sync/pull` contract.
- This directory's `07_Landing_Page.md §4.2` — the deferred-state pattern reused on the commercial landing page's `HeroPlatformBadge` island.

---

## 10. ASCII Art Mockup Suite (§20 Compliance)

Per `13_UI_Guidelines.md` §20.6, every web/ state file must carry ≥ 2 ASCII art mockups. The mockups below complement the existing §1 three-layer diagram, §5 cache hierarchy, and §7 sync diagram — they add three new views: (1) the Zustand store tree with persistence rules, (2) the TanStack Query cache as a key-tree with staleTime/gcTime annotations, and (3) the optimistic-update lifecycle as a horizontal sequence diagram. Every mockup sits inside a fenced code block per §20.3 rule 1; box widths stay within the 80–120 character desktop range per §20.3 rule 2; the §20.2 character set is in use; accent colours are named, never hexed; cross-references use canonical IDs only.

### 10.1 Design System Reference — State Layer

> **The single rule (§6.6) carried into the state layer.** The state layer itself is headless — it stores IDs, flags, and cache entries, not UI surfaces. But the **components that consume the state** (the Client islands that read `useStudentsStore` or `useQuery`) render both surfaces and controls. The tables below list the state-driven surfaces and controls on the web app's five screens; the tables mirror `01_Architecture.md` §12.1 and the per-screen specs.

| Surface (state-driven) | Glass tier | Where on web | Cross-ref |
|---|---|---|---|
| KPI card (reads `useDashboardStore.period`) | `glass` + accent L-border | `/dashboard` | §5.4, §8.1, `04_Dashboard.md §21` |
| List row (reads `useStudentsStore.filter`) | `glass-faint` band | `/students`, `/fees` | §5.5, §8.4, `05_Students.md §21` |
| Drawer / sheet (reads `useStudentsStore.drawerOpen`) | `glass-strong` | `/students/[id]` | §5.5, §8.7 |
| Modal (reads `useFeesStore.receiptFormOpen`) | `glass-strong` + backdrop | `/fees` receipt form | §5.5, §8.7 |
| Toast (reads `useSyncStore.status`) | `glass-strong` + 4px accent bar | app-wide | §5.5, §8.8 |

| Control (state-driven) | Neumo recipe | Where on web | Cross-ref |
|---|---|---|---|
| Period segmented control (`useDashboardStore.period`) | `neumo-inset` well + `neumo-raised` pill | `/dashboard` KPI row | §6.6, §8.5 |
| Filter segmented control (`useStudentsStore.filter`) | `neumo-inset` well + `neumo-raised` pill | `/students` toolbar | §6.6, §8.5 |
| PIN toggle (`useSettingsStore.pinEntry`) | `neumo-inset` + raised knob | `/settings` security tab | §6.4, §6.6, §8.16 |
| Stepper (page-size on `/students`) | `neumo-inset` well + `neumo-raised` ± buttons | `/students` pagination | §6.6, §8.18 |

> **References.** TanStack Query v5 docs (`useQuery`, `useMutation`, `setQueryData`, `invalidateQueries`, optimistic updates via `onMutate`, `staleTime` / `gcTime` strategy, query-key conventions); Zustand v5 docs (`create`, `persist` middleware, custom storage adapters, selectors, the "no cross-store coupling" rule); Smashing Magazine — "A Visual Guide To React Server Components" (the cache hierarchy rationale); Josh W. Comeau — "The 'What' And 'Why' Of Server Components" (why state lives on the server first); CSS-Tricks — "Managing State In React With Zustand" (the selector-stability pattern); web.dev — "Offline-First For Progressive Web Apps" (the IndexedDB read-through cache pattern). These are the same references cited in `README.md` §7.2.

### 10.2 Mockup M1 — Zustand Store Tree (Persistence Annotated)

The §4.1 store catalogue listed the eight stores; this mockup shows them as a **tree** with persistence rules, so a future agent can see at a glance which stores survive a tab close (persisted to IndexedDB via `idb-keyval`) and which are transient (cleared on tab close, never touch disk).

```
                              Zustand v5 — Client UI State
                              ┌──────────────────────────────────────────────────────────┐
                              │  Root: src/stores/index.ts (re-exports the 8 create()s)  │
                              │  ↑ one store per screen + 3 cross-cutting stores         │
                              └──────────────────────────┬───────────────────────────────┘
                                                         │
            ┌──────────────────┬──────────────────┬──────┴──────────┬──────────────────┬──────────────────┐
            ▼                  ▼                  ▼                  ▼                  ▼                  ▼
   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
   │ useDashboardStore│ │ useStudentsStore │ │useAttendanceStore│ │   useFeesStore   │ │ useSettingsStore │ │   useSyncStore   │
   │ ─────────────────│ │ ─────────────────│ │ ─────────────────│ │ ─────────────────│ │ ─────────────────│ │ ─────────────────│
   │ Persisted: NO    │ │ Persisted: PART. │ │ Persisted: NO    │ │ Persisted: NO    │ │ Persisted: PART. │ │ Persisted: NO    │
   │  (transient —    │ │  only `filter`   │ │  (transient —    │ │  (transient —    │ │  only `theme`    │ │  (transient —    │
   │   date + period  │ │  to idb-keyval   │ │   date + batch   │ │   selection +    │ │  + density to    │ │   status +       │
   │   reset on mount)│ │  (partialize)    │ │   reset on mount)│ │   form flags)    │ │  idb-keyval      │ │   pendingCount   │
   │                  │ │                  │ │                  │ │                  │ │                  │ │   reset on mount)│
   │ State:           │ │ State:           │ │ State:           │ │ State:           │ │ State:           │ │ State:           │
   │  • period: 'MTD' │ │  • selectedId    │ │  • selectedDate  │ │  • selectedStu-  │ │  • activeTab     │ │  • status: 'idle'│
   │  • quickAction-  │ │  • drawerOpen    │ │  • selectedBatch │ │    dentId        │ │  • pinEntry      │ │    |'syncing'    │
   │    Queue: []     │ │  • filter: 'all' │ │  • markingState  │ │  • receiptForm-  │ │    (TRANSIENT —  │ │    |'offline'    │
   │                  │ │  • mergeCandi-   │ │                  │ │    Open          │ │     NEVER disk)  │ │  • pendingCount  │
   │                  │ │    dateIds: []   │ │                  │ │  • voidTargetId  │ │  • biometric-    │ │  • lastSyncAt    │
   │                  │ │                  │ │                  │ │                  │ │    Enrolling     │ │                  │
   └──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘ │  • theme         │ └──────────────────┘
                                                                                       │  • density       │
                                                                                       └──────────────────┘
            ┌──────────────────┐                                     ┌──────────────────┐
            │useCommandPalette │                                     │   useShellStore  │
            │ ─────────────────│                                     │ ─────────────────│
            │ Persisted: NO    │                                     │ Persisted: YES   │
            │  (transient —    │                                     │  (last screen +  │
            │   `open: bool`)  │                                     │   sidebar col-   │
            │                  │                                     │   lapse to idb-  │
            │ State:           │                                     │   keyval)        │
            │  • open: false   │                                     │                  │
            │                  │                                     │ State:           │
            │                  │                                     │  • activeScreen  │
            │                  │                                     │  • sidebarCol-   │
            │                  │                                     │    lapse: false  │
            └──────────────────┘                                     └──────────────────┘

  ── Persistence layer (idb-keyval, IndexedDB) ──────────────────────────────────────────
   ╔════════════════════════════════════════════════════════════════════════════════════╗
   ║  idb-keyval keys (per-origin, per-tab session):                                    ║
   ║   • buddysaradhi.students       ← { filter: 'all' }                (from useStudents)   ║
   ║   • buddysaradhi.settings       ← { theme: 'cosmic', density: 'comfortable' }           ║
   ║   • buddysaradhi.shell          ← { activeScreen: 'dashboard', sidebarCollapse: false } ║
   ║                                                                                     ║
   ║  NEVER persisted (transient slices only):                                           ║
   ║   ✕ PIN entry (useSettingsStore.pinEntry) — security: BR-SEC-02                    ║
   ║   ✕ Biometric enrollment state — security: server-side only                        ║
   ║   ✕ Sync status (useSyncStore.status) — recomputed on mount                        ║
   ║   ✕ Drawer/modal open state — UI ephemerality                                      ║
   ║   ✕ Quick-action queue — should not survive tab crash                              ║
   ╚════════════════════════════════════════════════════════════════════════════════════╝
   ↑ Wipe discipline (BR-SEC-04): on logout, wipeLocalCache() clears ALL buddysaradhi.* keys
   ↑ Cross-store rule: a store NEVER imports another store; cross-store coordination
     lives in a React Component (e.g. GlassShell reads useStudentsStore.selectedId to
     decide the sidebar active item — that logic is in GlassShell, not in the stores)

  ── Selector stability rule (§4.2 rule 4) ─────────────────────────────────────────────
   Each component reads the smallest slice:
     ✓ useStudentsStore(s => s.drawerOpen)         ← re-renders only when drawerOpen changes
     ✗ useStudentsStore()                          ← re-renders on EVERY state change
   ↑ the lint rule `no-zustand-wholesale` enforces this in CI
```

The tree shows the eight stores, their persistence posture (NO / PARTIAL / YES), and the slice each persists. Three stores survive a tab close (`useStudentsStore`, `useSettingsStore`, `useShellStore`) — but only their declared `partialize` slices, never their full state. Five stores are transient: they reset on mount. The persistence layer (`idb-keyval`) holds three keys; the wipe discipline (`wipeLocalCache()` on logout per BR-SEC-04) clears all three plus every TanStack Query cache entry. The cross-store rule (a store never imports another store) keeps the dependency graph acyclic — coordination lives in React Components, not in the stores.

### 10.3 Mockup M2 — TanStack Query Cache (Key-Tree with staleTime / gcTime)

The §5 cache hierarchy showed the three-layer read-through; this mockup shows the **TanStack Query layer** as a key-tree, with `staleTime` and `gcTime` annotated per entity. The cache is per-tab and per-`QueryClient`; the keys are stable strings that encode the entity type, the operation, and the parameters.

```
   TanStack Query v5 — Client Server-State (per-tab QueryClient)
   ╔═════════════════════════════════════════════════════════════════════════════════════════════════════╗
   ║  QueryClient created in src/lib/query-client.ts, provided via <Providers> in src/app/layout.tsx     ║
   ║  defaultOptions: { staleTime: 30_000, gcTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: false }  ║
   ║  ↑ default staleTime = 30 s; per-entity overrides below                                            ║
   ╚═════════════════════════════════════════════════════════════════════════════════════════════════════╝
                                                                  │
   ┌──────────────────────────────────────────────────────────────┴──────────────────────────────────────────────┐
   │                                                                                                               │
   ▼                                                                                                               ▼
   ┌────────────────────────────────────────────┐                                       ┌────────────────────────────────────────────┐
   │  ['dashboard']                              │                                       │  ['students', ...]                          │
   │  ──────────────                             │                                       │  ──────────────                              │
   │  ├─ ['kpis']                                │                                       │  ├─ ['list', { cursor, limit, filter }]     │
   │  │    staleTime: 30_000  (30 s)             │                                       │  │    staleTime: 60_000  (60 s)             │
   │  │    gcTime:     5 min                     │                                       │  │    gcTime:     5 min                     │
   │  │    ↑ derived from ledger; invalidated    │                                       │  │    ↑ cursor pagination; invalidated      │
   │  │      on LEDGER_MUTATED event             │                                       │  │      on student create/edit              │
   │  │                                          │                                       │  │                                          │
   │  ├─ ['activity-feed']                       │                                       │  ├─ ['detail', studentId]                   │
   │  │    staleTime: 30_000  (30 s)             │                                       │  │    staleTime: 30_000  (30 s)             │
   │  │    gcTime:     5 min                     │                                       │  │    gcTime:     5 min                     │
   │  │    ↑ last 20 events; short staleTime     │                                       │  │    ↑ invalidated on student edit +       │
   │  │      because new payments fire events    │                                       │  │      ledger mutations affecting balance  │
   │  │                                          │                                       │  │                                          │
   │  └─ ['heatmap', { month }]                  │                                       │  └─ ['enrollments', studentId]              │
   │       staleTime: 5 * 60_000  (5 min)        │                                       │       staleTime: 5 * 60_000  (5 min)        │
   │       gcTime:     10 min                    │                                       │       gcTime:     10 min                    │
   │       ↑ rarely changes; long staleTime OK   │                                       │       ↑ rarely changes; long staleTime OK  │
   └────────────────────────────────────────────┘                                       └────────────────────────────────────────────┘
   ┌────────────────────────────────────────────┐                                       ┌────────────────────────────────────────────┐
   │  ['ledger', ...]                            │                                       │  ['attendance', ...]                        │
   │  ──────────────                             │                                       │  ──────────────                              │
   │  ├─ ['list', studentId, { cursor }]         │                                       │  ├─ ['sessions', { date }]                  │
   │  │    staleTime: Infinity ← IMMUTABLE       │                                       │  │    staleTime: 30_000  (30 s)             │
   │  │    gcTime:     30 min                    │                                       │  │    gcTime:     5 min                     │
   │  │    ↑ ledger is append-only (BR-LED-06);  │                                       │  │    ↑ today's batch grid; short stale     │
   │  │      rows never mutate, only new rows    │                                       │  │      because mobile marks flow in        │
   │  │      arrive via sync_outbox poll         │                                       │  │                                          │
   │  │                                          │                                       │  └─ ['batch-grid', batchId, date]           │
   │  ├─ ['entry', entryId]                      │                                       │       staleTime: 60_000  (60 s)             │
   │  │    staleTime: Infinity ← IMMUTABLE       │                                       │       gcTime:     5 min                     │
   │  │    gcTime:     30 min                    │                                       │       ↑ past sessions are stable; longer   │
   │  │                                          │                                       │         staleTime                           │
   │  └─ ['fees-matrix']                         │                                       └────────────────────────────────────────────┘
   │       staleTime: 30_000  (30 s)             │
   │       gcTime:     5 min                     │
   │       ↑ derived from ledger; INVALIDATING   │
   │         Infinity here is W-AP-8 (anti-      │
   │         pattern — see AGENTS.md §10)        │
   └────────────────────────────────────────────┘

   ── Mutation invalidation map (onSettled → qc.invalidateQueries) ────────────────────────────────────────────
     recordPayment(studentId, amountPaise)       → invalidate(['dashboard','kpis'], ['students','detail',studentId],
                                                                  ['ledger','list',studentId], ['ledger','fees-matrix'])
     markAttendance(batchId, date, studentMarks) → invalidate(['attendance','sessions'], ['attendance','batch-grid',batchId,date])
     voidReceipt(entryId, reason)                → invalidate(['ledger','list',*], ['ledger','entry',entryId],
                                                                  ['ledger','fees-matrix'], ['dashboard','kpis'])
     createStudent(input)                        → invalidate(['students','list',*])
     editStudent(id, patch)                      → invalidate(['students','detail',id], ['students','list',*])
   ↑ every mutation appends to sync_outbox in the same batch() (BR-SYN-01) — invalidation + outbox are paired
```

The key-tree shows the four top-level entities (`dashboard`, `students`, `ledger`, `attendance`) and their per-query `staleTime` / `gcTime`. Two queries use `staleTime: Infinity` — the ledger list and the ledger entry — because the ledger is append-only (BR-LED-06) and rows never mutate, only new rows arrive via the 30-second sync poll. The `fees-matrix` query explicitly does NOT use `staleTime: Infinity` (W-AP-8 anti-pattern) because it is derived from the ledger and goes stale on every payment. The mutation invalidation map at the bottom is the contract for `onSettled` — every Server Action returns `Ok` or `Err`, and the `onSettled` callback invalidates the relevant Query keys so the next render fetches fresh data.

### 10.4 Mockup M3 — Optimistic Update Lifecycle (Horizontal Sequence)

The §3 narrative described the optimistic-update pattern; this mockup shows it as a **horizontal sequence diagram** across the four actors: User, Client Island, TanStack Cache, Server Action, and Turso DB. The point: the user sees the optimistic state immediately, the cache is updated, the Server Action runs, and the cache is either confirmed (Ok → invalidate) or rolled back (Err → `setQueryData` to prior snapshot).

```
   User              Client Island         TanStack Cache        Server Action          Turso DB
   ────              ──────────────        ──────────────        ──────────────          ─────────
   │  click "Mark    │                     │                     │                      │
   │  Present"       │                     │                     │                      │
   │ ──────────────► │                     │                     │                      │
   │                 │  setQueryData(      │                     │                      │
   │                 │   ['attendance',    │                     │                      │
   │                 │    'batch-grid',    │                     │                      │
   │                 │    batchId, date],  │                     │                      │
   │                 │   (old) => ({       │                     │                      │
   │                 │     ...old,         │                     │                      │
   │                 │     marks: {        │                     │                      │
   │                 │       [studentId]:  │                     │                      │
   │                 │       'present' }   │                     │                      │
   │                 │   }))               │                     │                      │
   │                 │ ──────────────────► │                     │                      │
   │                 │                     │  cache updated —    │                      │
   │                 │                     │  snapshot prior     │                      │
   │                 │                     │  state for rollback │                      │
   │  sees Present   │ ◄─────────────────  │                     │                      │
   │  immediately    │                     │                     │                      │
   │  (no spinner)   │                     │                     │                      │
   │                 │  startTransition    │                     │                      │
   │                 │   (() => markAtt-   │                     │                      │
   │                 │    endanceAction(   │                     │                      │
   │                 │     { batchId,      │                     │                      │
   │                 │       date,         │                     │                      │
   │                 │       studentId,    │                     │                      │
   │                 │       status:       │                     │                      │
   │                 │       'present',    │                     │                      │
   │                 │       pin }))       │                     │                      │
   │                 │ ────────────────────────────────────────► │                      │
   │                 │                     │                     │  Zod parse           │
   │                 │                     │                     │  ✓ valid             │
   │                 │                     │                     │  PIN verify (BR-     │
   │                 │                     │                     │   SEC-02)            │
   │                 │                     │                     │  ✓ verified          │
   │                 │                     │                     │                      │
   │                 │                     │                     │  db.batch([          │
   │                 │                     │                     │    INSERT INTO       │
   │                 │                     │                     │      attendance_     │
   │                 │                     │                     │      records …,      │
   │                 │                     │                     │    INSERT INTO       │
   │                 │                     │                     │      sync_outbox     │
   │                 │                     │                     │      (op='INSERT',   │
   │                 │                     │                     │       entity=        │
   │                 │                     │                     │       'attendance',  │
   │                 │                     │                     │       entity_id,     │
   │                 │                     │                     │       ts),           │
   │                 │                     │                     │    INSERT INTO       │
   │                 │                     │                     │      audit_log       │
   │                 │                     │                     │      (action=        │
   │                 │                     │                     │       'attendance_   │
   │                 │                     │                     │       marked',       │
   │                 │                     │                     │       actor='tutor') │
   │                 │                     │                     │  ])                  │
   │                 │                     │                     │ ───────────────────► │
   │                 │                     │                     │                      │  atomic
   │                 │                     │                     │                      │  commit
   │                 │                     │                     │ ◄─────────────────── │
   │                 │                     │                     │  Result<Ok, { id }>  │
   │                 │ ◄───────────────────────────────────────── │                      │
   │                 │  onSettled:          │                     │                      │
   │                 │   qc.invalidate-     │                     │                      │
   │                 │   Queries(['attend-  │                     │                      │
   │                 │   ance','batch-     │                     │                      │
   │                 │   grid', batchId,   │                     │                      │
   │                 │   date])             │                     │                      │
   │                 │ ──────────────────► │                     │                      │
   │                 │                     │  next read fetches  │                      │
   │                 │                     │  fresh from server  │                      │
   │                 │                     │  → confirms 'present'│                     │
   │                 │                     │                     │                      │
   │  sees toast     │ ◄─────────────────  │                     │                      │
   │  "Marked        │                     │                     │                      │
   │  Present"       │                     │                     │                      │
   │  (✓ emerald)    │                     │                     │                      │

   ── Failure branch (Server Action returns Err) ────────────────────────────────────────────────────────────
   │                 │ ◄───────────────────────────────────────── │                      │
   │                 │  Result<Err, { code:   │                     │                      │
   │                 │   'PIN_INVALID' }>     │                     │                      │
   │                 │  onError:              │                     │                      │
   │                 │   qc.setQueryData(     │                     │                      │
   │                 │    ['attendance',      │                     │                      │
   │                 │     'batch-grid',      │                     │                      │
   │                 │     batchId, date],    │                     │                      │
   │                 │    priorSnapshot)      │                     │                      │
   │                 │ ──────────────────► │                     │                      │
   │                 │                     │  cache rolled back  │                      │
   │                 │                     │  to prior state     │                      │
   │  sees UI revert │ ◄─────────────────  │                     │                      │
   │  + flare toast  │                     │                     │                      │
   │  "PIN invalid — │                     │                     │                      │
   │   4 attempts    │                     │                     │                      │
   │   left"         │                     │                     │                      │
   │  (✕ flare)      │                     │                     │                      │
   ↑ toast = .glass-strong + 4px flare left-bar (§5.5 §8.8), aria-live="assertive"
   ↑ audit_log row written: action='pin_invalid', actor='tutor', attempts_remaining=4
```

The sequence shows the optimistic-update lifecycle in three phases: (1) the user click immediately updates the TanStack cache (the prior state is snapshotted for rollback), (2) the Server Action runs Zod parse → PIN verify → atomic `db.batch()` (INSERT attendance + sync_outbox + audit_log in one transaction per BR-SYN-01), (3) on `Ok` the cache is invalidated (next read fetches fresh); on `Err` the cache is rolled back via `setQueryData(priorSnapshot)` and a flare toast surfaces the typed error. The whole lifecycle is < 200 ms on a fast connection — the user sees "Present" immediately, and the confirmation (or rollback) is perceptible only as a brief flash on the toast. The 30-second sync poll (`useSyncPoll`) catches the same mutation when it lands from a mobile device — the invalidation map in M2 ensures the web UI refreshes.

---

*State in this file is the contract. When a store, a Query key, or a cache layer diverges, the spec wins — unless the spec is wrong, in which case you amend this file first, then the code, then the worklog.*
