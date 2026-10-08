# Zustand 5

- **Docs:** https://zustand.docs.pmnd.rs/ · persist reference: https://zustand.docs.pmnd.rs/reference/integrations/persisting-store-data
- **Pinned:** `zustand@^5.0.14` — `apps/web/package.json`. (v4.5.7 also appears in the lockfile as a transitive dep; the app uses 5.0.14.)
- **Stores:** `apps/web/src/stores/` — `shell`, `students`, `attendance`, `fees`, `settings` (5 stores)

## Project specifics

### A `persist` slice backed by `sessionStorage` needs `skipHydration: true` AND a `rehydrate()` effect

This is the one that cost real time, and the failure is **silent** — no error, no console warning in dev, just wrong first paint.

Without `skipHydration`, `persist` hydrates **synchronously at store creation**. On the server there is no `sessionStorage`, so the server renders the *constructor* value. In the browser, the store is already hydrated from storage *before* the first render. Server markup and first client markup therefore disagree for any returning tutor — a structural hydration mismatch on **every load**, which AGENTS.md §16 makes a release blocker.

The two halves, both required:

```ts
// stores/settings-store.ts:68  and  stores/attendance-store.ts:39
persist(
  /* ... */,
  {
    storage: createJSONStorage(() => sessionStorage),
    skipHydration: true,          // ← without this, hydration is synchronous
  },
);
```

```ts
// components/settings/settings-client.tsx:45
// components/attendance/attendance-client.tsx:39
useEffect(() => {
  void useSettingsStore.persist.rehydrate();
}, []);
```

With `skipHydration`, the server's value **is also** the first client render's value — the markup agrees, and rehydration happens in an effect afterwards. This is also what let `/settings` and `/attendance` drop their `ssr: false` wrappers and become genuinely server-rendered.

**Two wrong turns, for the record:** (1) wrapping the two screens in `ssr: false` behind `next/dynamic` — illegal in a Server Component, and it treated the symptom; (2) assuming a hydration-mismatch fix belonged in the component rather than in the store that caused it.

### The persisted slice must be tutor-scoped, not screen-scoped

`useAttendanceStore.selectedDateIso` is persisted tutor state, and that is precisely why `/attendance` does **no** server prefetch: the server cannot know the stored date, and prefetching under the server's own date would either throw away the result or — worse — render the **wrong day's marks with full confidence**. See `apps/web/src/app/(app)/attendance/page.tsx`. For a daily-marking screen, guessing is the one unacceptable outcome.

### `idb-keyval` was removed; all three persisted stores use `sessionStorage`

Phase 3 of TABS-HARDEN-01 removed `idb-keyval` at 0 import sites. No store needed IndexedDB — 3–4 keys do not justify the dependency over native storage.

### The store is the client cache for screen switching, not the source of truth

Server data lives in TanStack Query ([tanstack-react-query.md](tanstack-react-query.md)); Zustand holds *view* state (which screen, which section, which filters). After the five-route change both exist and the boundary is: `queryKey` = server data, store = UI state. See `docs/mindmap.md` §1.

## Store-state rules this repo actually follows (audited 2026-10-07, `src/hooks` + `src/stores`)

### A selector never builds a new object or array

Zustand compares a selector's result with `Object.is` on every store notification. A selector that returns a fresh object returns a *different* object every time, so every notification re-renders every subscriber — and a write inside a subscriber re-notifies. That is the render loop, and it presents as a browser hung for minutes rather than as an error.

Every store in `src/stores` therefore builds new objects **inside `set(…)`**, never inside a selector:

```ts
setFilters: (f) => set((state) => ({ filters: { ...state.filters, ...f }, page: 1 })),
```

Measured: no `useShallow` anywhere in the app, and no selector in `src/` that returns an object literal or an array method result. If you add one, add `useShallow` in the same commit.

### Mutable collections are copied on write, never mutated in place

`settings-store.ts`'s `dirtySections` is a `Set`. `markDirty`/`markClean` build a new `Set` every time. Mutating in place would keep the same identity, every subscriber would conclude nothing changed, and the nav rail's "Unsaved" marker would never appear. Same rule for `bulkSelectedIds` in `students-store.ts`.

### `skipHydration` is required only when a PERSISTED field is also a RENDERED field

`fees-store.ts` persists `mode` and `searchQuery` and does **not** set `skipHydration` — and that is correct, measured rather than assumed. A hydration mismatch needs a *rendered* difference, and neither persisted field has a reader anywhere in the app (the Fees screen destructures `selectedStudentId` only; the rendered fields — the sheet flags, the description seed, the selected student — are excluded by `partialize`).

Do not "fix" it by copying the settings/attendance pattern: with no `persist.rehydrate()` call in `fees-client.tsx`, adding `skipHydration` would stop restoring the persisted slice **entirely**, silently. The trigger to revisit is `mode` gaining a reader.

The same reasoning rules out reading external state during the first render. `useConfirmedMutation` used `useState(() => readQueue(tenantId).items.length)` — a lazy initialiser that runs during the hydration render, comparing an empty server-side fallback against the browser's real queue. It starts at `0` and reads the queue in an effect instead.

### A module-level `let` in a store is a question, not automatically a leak

`shell-store.ts` holds `let navigator: ScreenNavigator | null`. It looks exactly like the cross-request mutable state AGENTS.md §3.4 warns about, and the answer is structural: `registerScreenNavigator` is called only from a `useEffect` in a `"use client"` hook, and effects do not run during a server render — so on the server `navigator` is permanently `null` and `setActiveScreen` degrades to a plain setter, in every process, for every tenant. Moving that registration out of an effect would make it a real cross-tenant leak, so the invariant is stated in the file itself.

The rule it follows: **an external store is safe if only client code can write to it.** Write that down where the invariant lives, or the next agent will tidy the guard away.