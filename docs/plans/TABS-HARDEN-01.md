# PLAN — TABS-HARDEN-01: SSR routes, native-first, TS7, singleton safety

**Owner order (2026-10-07).** Audit every route file, page file, hook, store and
singleton; make the five screens server-rendered; prefer native TypeScript and
native CSS over modules where native is *precise*; use TypeScript 7 properly;
raise the bar to industry standard with docs and comments; record the result as
a mind-map graph.

**Method:** Ponytail (ultra) for code shape and dependency choice.
`AGENTS.md` §2 non-negotiables are not simplifiable — Ponytail says so itself
("Never simplify away: input validation at trust boundaries, error handling
that prevents data loss, security measures, accessibility basics"). Every place
the two genuinely conflict is listed in §8 below rather than silently resolved.

---

## 0. The blocker that must be cleared first — **CLEARED 2026-10-07**

**AGENTS.md Rule 4 previously stated: "only `/` is a user-facing route in web".**
Promoting the five screens to real SSR routes contradicts a §2 non-negotiable.

AGENTS.md §0.1 makes the spec the contract, so the rule is amended *before* the
code, and the amendment is recorded with the reason. This is Phase 0 and nothing
else starts until it lands. Rule 4's *intent* — five screens, no sprawl — is
preserved: this makes five screens into five routes, it does not add a sixth.

### What landed

| Location | Change |
|---|---|
| `AGENTS.md` §2 Rule 4 (`Enforced`) | Now names the five routes, and carries a "**WHY FIVE ROUTES IS NOT A SIXTH SCREEN**" paragraph stating that the rule protects the screen COUNT, not the ROUTING, citing `16_Platform_Delivery_Sequence.md` §W1 (which already listed the five paths) and the owner directive of 2026-10-07 |
| `AGENTS.md` §3.1 `apps/web` row | "add a 2nd user-facing route" → "add a 6th user-facing route" (the original wording already implied there were several) |
| `AGENTS.md` §3.3 web snapshot | "Only the `/` route is user-facing — screen switching is Zustand-driven" → the five SSR routes + each `page.tsx` prefetching its own data |
| `AGENTS.md` §15 FM-03 prevention | "only `/` user-facing in web" → the five named routes |

The five-screen prohibition is untouched: still five screens, still P2, still a
ratified amendment required for a sixth.

---

## 1. Measured surface (not guessed)

| Surface | Count | Notes |
|---|---|---|
| `page.tsx` | 6 | `(app)/dashboard`, `(auth)/{login,signup,forgot-password,reset-password}`, `(auth)/signup/provision` |
| `route.ts` (API) | 3 | `(auth)/callback`, `api/auth/signout`, `api/v1/[...slug]` |
| hooks | 5 real | `use-auto-provision`, `use-confirmed-mutation`, `use-media-query`, `use-platform`, `use-screen-url` |
| stores | 5 | `shell`, `students`, `attendance`, `fees`, `settings` |
| components | 71 | across the five screens |
| server actions | 16 | `@/server/actions/*` |
| gateway routes | ~8 | Deno edge |

**Singleton / module-level state found** (the multithreading concern):

| File | State | Risk |
|---|---|---|
| `lib/db.ts` | `clientCache`, `prismaCache` — module `Map`s | Unbounded. Per-worker in Next; a leak that grows with tenant count. Same class of bug as the 1.9 GB `deno-lsp` cache found earlier. |
| `lib/offline-queue.ts` | `memoryFallback` `Map` | Unbounded per tenant. |
| `lib/intent-key.ts` | `let lastEntropy` | Cross-request mutable in a server module. |
| `lib/xlsx-template.ts` | `let CRC_TABLE` | Benign (idempotent memo), but still module-mutable. |
| `apps/gateway/lib/*` | several `Map`s | Previously audited safe (synchronous get/set). |

Fix pattern for all of them: a bounded LRU or a `WeakRef`-keyed map, plus a
test that asserts the bound. **Unbounded cache growth in a long-lived server
process is a real leak, not a style opinion.**

---

## 2. SSR target ("all" = fullest option, per the owner's answer) — **PARTLY LANDED 2026-10-07**

Five real routes, each server-rendered, **and** the existing Zustand store kept
as the client cache so switching between already-visited screens stays instant
with no refetch.

```
/dashboard  /students  /attendance  /fees  /settings
```

- Each `page.tsx` is a Server Component that prefetches its own data and
  renders the screen's shell server-side.
- The existing `GlassShell` becomes the shared chrome the five routes render.
- `useScreenUrl` / the `g then N` shortcuts write the route and stay instant
  from the store cache (TanStack Query is already the server cache).
- `/` redirects to `/dashboard`.

**Risk, stated plainly:** this is the largest single change in the plan. It
touches the store, the shortcuts, `glass-shell.tsx`, `proxy.ts` and every
screen's data entry point. It is Phase 1 and it is gated behind Phase 0.

### What actually shipped, and the one thing that did not

All five routes exist and all five `page.tsx` files are Server Components. Four
of the five server-render the screen body; **Attendance does not**, and the
reason is a real defect in a file this lane does not own:

| Route | Body server-rendered | Data prefetched on the server | Key |
|---|---|---|---|
| `/dashboard` | yes | yes | `["dashboard","summary",period]` |
| `/students` | yes | yes (default roster) | `["students",filters,"",1,50,sort]` |
| `/fees` | yes | yes | `["fees-students",""]` |
| `/settings` | **no** (`ssr: false`) | yes | `["settings"]` |
| `/attendance` | **no** (`ssr: false`) | **no** | `["attendance",dateIso,batch]` — tutor-scoped, not server-knowable |

**The blocker.** `useSettingsStore.activeSection` and
`useAttendanceStore.selectedDateIso` are both in a zustand `persist` slice backed
by `sessionStorage`, which restores **synchronously** before the browser's first
paint. The server has no `sessionStorage`, so it renders the constructor value.
Server markup and first client markup therefore disagree for any returning tutor
— a structural hydration mismatch on every load, which `AGENTS.md` §16 makes a
release blocker.

**The fix, in files this lane does not own:**

```ts
// stores/settings-store.ts  +  stores/attendance-store.ts
persist(…, {
  storage: createJSONStorage(() => sessionStorage),
  skipHydration: true,                                   // ← add
})
// and in the screen component (a client component):
useEffect(() => { void useSettingsStore.persist.rehydrate(); }, []);
```

With `skipHydration` the server's value is also the first client render's value,
the markup agrees, and both screens drop `ssr: false`. **Phase 1 is incomplete
until that lands.**

**One regression, stated.** The old `?screen=` hook could REFUSE a browser Back
press while a tutor had a typed ₹5,000 payment open. The App Router owns
`popstate` and offers no API to veto it, so Back is no longer guarded. Mitigated
partly — `GlassShell` closes the fee sheets on unmount, so a sheet cannot leak
across a navigation and re-appear over a different student — but the typed values
inside a sheet open at the moment Back was pressed are still lost silently.

---

## 3. Native-first, with the verdict recorded per dependency

Owner's rule: native where it is *precise and accurate*; modules where they
genuinely buy complexity reduction. AGENTS.md mandates Zod (§6.1), Tailwind 4
(§3.1/§13) and `Intl.NumberFormat` money formatting (Rule 6) — those stay.

Measured import sites:

| Package | Sites | Verdict |
|---|---|---|
| `lodash.debounce` | 0 | **Remove.** Native replacement is trivial and exact — see below. |
| `idb-keyval` | 0 | **Remove if genuinely unused**; native `indexedDB` is more code than the dep is worth for 3–4 keys. |
| `clsx` | 1 | **Remove.** Native `filter(Boolean).join(" ")` is exact for the class shapes in use. |
| `class-variance-authority` | 1 | **Keep unless a variant set is trivial** — it earns its keep for `buttonVariants`. |
| `react-day-picker` | 1 | **Candidate.** Native `<input type="date">` is a platform primitive and is the correct answer for a date field (Ponytail rung 4). Accessibility and mobile behaviour both improve. |
| `date-fns` | 7 | **Keep** — mandated indirectly by money/date precision (Rule 6). Hand-rolling `addMonths` is *less* precise. |
| `zod` | many | **Keep** — mandated (§6.1). |

**The native debounce that replaces `lodash.debounce`** (exact semantics:
trailing-edge, cancelable, typed):

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...a: A): void => {
    if (t !== undefined) clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  wrapped.cancel = (): void => {
    if (t !== undefined) clearTimeout(t);
    t = undefined;
  };
  return wrapped;
}
```

Same in native CSS: `color-mix()`, `oklch()`, `:has()`, `@container`, nesting
and `light-dark()` are all available in 2026 browsers and replace the handful of
places currently reaching for JS or a helper to do what the platform now does.
Each swap gets a *precision verdict* written next to it — not a vibe.

---

## 4. TypeScript 7

Already on `^7.0.2`. The compiler is the Go-native port; the *language* surface
to exploit is what matters:

- `satisfies` — Zod schema + inferred type in one declaration, no duplicate
  shape drift. Fits §6.1 exactly.
- `const` type parameters — literal-preserving helpers without `as const` noise.
- `using` / explicit resource management — correct shape for the DB client and
  transaction lifetimes, which currently rely on manual cleanup.
- `NoInfer<T>` — stops `z.infer` inference bleeding into unrelated call sites.
- `accessor`, `out`/`in` variance for the ORM shim's builder types.

Applied only where it *reduces* code or removes a cast. Not sprayed for its own
sake — Ponytail rung 6.

---

## 5. Docs, comments, standards

Every exported module gets:
- an `Implements:` header citing the spec section (already AGENTS.md §0.2 — this
  enforces it rather than inventing a new convention);
- doc comments on **interface methods**, stating the contract and what it
  throws, not restating the signature;
- tech-stack reference links stored in `docs/stack/` — one file per stack
  (Next 16, React 19, TS 7, Tailwind 4, Drizzle/SQLite, Playwright, Vitest) with
  the canonical doc URL and the notes that actually mattered on this project.

No comment that only restates the code. A comment earns its place by explaining
*why*, *what breaks*, or *which rule forbids the obvious alternative*.

---

## 9. Memory

- `docs/mindmap.md` — the graph: nodes (files, stores, hooks, routes, rules,
  spec ids) and edges (imports, owns, implements, breaks-with).
- Kilo memory: the node index, the singleton-leak findings, the native-swap
  verdicts, and the gate commands — so the next session recalls them without
  re-reading the repo.

---

## 10. Phase 6 (docs) — DELIVERED 2026-10-07

The DOCS lane owned `docs/stack/*` and `docs/mindmap.md`. Two things the plan
did not specify and that are now on record, because both were found by looking
rather than by planning:

**1. The stack list had to be cut against the real tree, not the plan's list.**
§5 named "Next 16, React 19, TS 7, Tailwind 4, Drizzle/SQLite, Playwright,
Vitest". There is no Drizzle in this repo — the ORM is Prisma + a hand-rolled
`libsql-proxy.ts` shim, and the plan's "Drizzle/SQLite" was simply wrong. Import
sites were counted with `rg` before any file was written, which is how the list
grew to 18: three of them (`packages/shared`, `packages/core`, the UI-primitive
grab-bag) exist because they are *used*, and two (`supabase`, `eslint-prettier`)
were added because each one carries a project-specific trap the brief had not
listed — `proxy.ts` vs `middleware.ts`, and the fact that `eslint .` does not
lint `.tsx` at all.

**2. "Gotchas line" had to be symptom-shaped or it was not worth writing.**
Every note in `docs/stack/` is anchored to a file and line in this tree, and the
expensive ones are phrased as the *symptom that was actually observed*:

- every screen 500'd with `A "use server" file can only export async functions`
  while `tsc` and 621 tests were green — a **build-time** error, not a type error
- `--accent-cyan` exists in none of the 20 palettes, so every focus ring using it
  resolved to an invalid colour and **had no ring at all** (WCAG 2.4.7), and
  nothing looked broken
- the nav renders in both a sidebar and a mobile bottom nav, so a role-based
  Playwright query matches **two** elements
- `low-latency.test.ts` / `performance.test.ts` assert wall-clock budgets and
  fail under CPU contention: 546/548 with a `next build` running, **29/29 clean
  when read serially**
- `CREATE TABLE IF NOT EXISTS` cannot relax a column, so the legacy
  `invoices.invoice_number NOT NULL` shape killed every payment and only a table
  **rebuild** could fix it

Every URL in the directory was probed and returns 200. Every version was read
out of a real `package.json` or `node_modules/<pkg>/package.json` — the specifier
and the resolved version are both cited, because they differ in 6 of the 18 files
and the difference is exactly the sort of thing a reader would otherwise guess
wrong.

**`docs/mindmap.md` was also corrected, not just appended to.** Two of its
sections described a state that had already shipped:

- §1 said "Today: one route `/`, five screens swapped client-side" and framed the
  five SSR routes as a *target*. They shipped in `5974e6a`. Rewritten to the
  shipped shape, with the Back-press regression stated rather than dropped.
- §2 said the module `Map`s were UNBOUNDED. They were already bounded at 64 —
  FIFO not LRU, two keyspaces, and eviction orphaned the ORM proxy. **A map that
  reports a bound it does not enforce is worse than an unbounded one, because
  it is trusted**, and the original text would have let the next agent "confirm"
  a fixed bug.

New §9 records the lane boundaries including the lesson that a lane is a *file
list, not a subject* — splitting phase 1 by subject rather than by file would
have produced two correct half-patches and a broken app.

**Open and deliberately not written:** nothing in `docs/stack/` claims to be a
tutorial. Where a section had no project-specific content it states the link and
stops, per the owner's instruction. The `zz-tmp-settings-audit.spec.ts` 9/13
result is recorded in three places as an **open** item against the uncommitted
phase-5 lane that is re-basing it, with the explicit instruction not to loosen an
assertion to make it pass.

---

## 7. Execution order

| Phase | Work | Gate |
|---|---|---|
| 0 | Amend AGENTS.md Rule 4 (spec first) + record the reason | owner review of the diff |
| 1 | Five SSR routes + shared chrome; `/` redirects | build + browser: each route SSRs, switching instant |
| 2 | Singleton safety: bound every module-level cache | test asserting the bound |
| 3 | Native-first: the four dependency verdicts above | tests + visual diff |
| 4 | TS 7 adoption where it removes code or a cast | `tsc --noEmit` 0, tests green |
| 5 | Hook + store audit: 5 hooks, 5 stores | each hook/store has a stated contract |
| 6 | Docs: `docs/stack/*`, `docs/mindmap.md`, interface-method comments | links resolve |
| 7 | Memory write-back | — |

Gates run after **every** phase, never only at the end: `tsc --noEmit`,
`lint:principles`, `pnpm --filter web exec vitest run`, `next build`, and the
browser suite.

---

## 8. Where Ponytail-ultra and AGENTS.md genuinely conflict

Per the owner's answer, Ponytail runs at ultra. These are the collisions I will
hit; each gets cited and escalated rather than silently resolved:

1. **Ponytail: "no unrequested abstractions".** AGENTS.md §3.5 forbids a second
   implementation of money logic. Not a conflict — but it *is* an abstraction,
   and ultra pressure will push toward collapsing it. The money engine stays.
2. **Ponytail: "deletion before addition".** AGENTS.md §7.3 forbids mocking the
   DB in ledger tests and demands real file-backed SQLite. A "delete the
   fixture, trust the mock" shortcut is prohibited.
3. **Ponytail: YAGNI on tests.** §7.2/§7.3 require named coverage floors on
   `packages/core` and `packages/shared`. Not simplifiable.
4. **Ponytail: less prose.** The owner explicitly requested thorough docs. Per
   Ponytail itself, "Explanation the user explicitly asked for is not debt."

None of these are discretionary. They are listed so the boundary is on record
before implementation starts.

---

## 9. Open — waiting on the owner

**Caveman.** Not installed; the Ponytail skill references it as a companion for
terse prose. URL/path requested, not yet supplied. Nothing is blocked by it —
it governs prose, not code — but it will be read before Phase 1 ships.