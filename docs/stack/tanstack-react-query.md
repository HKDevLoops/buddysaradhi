# TanStack Query (React Query) 5

- **Docs:** https://tanstack.com/query/latest/docs/framework/react/overview · SSR guide: https://tanstack.com/query/latest/docs/framework/react/guides/ssr · App Router / Server Components: https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr · query keys: https://tanstack.com/query/latest/docs/framework/react/guides/query-keys
- **Pinned:** `@tanstack/react-query@^5.101.1` → **5.101.2** — `apps/web/package.json`
- **Sites:** ~35 import sites in `apps/web/src`
- **The one mechanism:** `apps/web/src/app/(app)/screen-data.tsx`

## Project specifics

### The SSR pattern here is `prefetchQuery` → `dehydrate` → `HydrationBoundary`, with a PER-REQUEST client

A module-scoped `QueryClient` would put **one tutor's roster in another tutor's HTML**. It is a cross-tenant data leak, not a style problem, and it is why `screen-data.tsx` wraps the constructor in React's `cache()`:

```ts
export const getRequestQueryClient = cache(
  (): QueryClient => new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS }),
);
```

`cache()` scopes it to one request's render and drops it when the response is done. **Never hoist it to module scope.**

The browser's own client lives in `apps/web/src/app/providers.tsx` and is created via `useState(() => new QueryClient(...))` — *not* a module singleton, for the same reason (React calls the initializer once per React tree).

### Two clients, ONE policy — this is the subtle one

Both the server's per-request client and the browser's long-lived client construct from the same `QUERY_DEFAULT_OPTIONS` in `apps/web/src/app/query-defaults.ts`. That module is deliberately **plain** (no `"use client"`, no `"use server"`) so both sides import the same object.

Why it matters: a dehydrated query is only trusted by the browser if its `dataUpdatedAt` sits inside the browser client's `staleTime`. Two copies of these numbers → the server emits data the browser immediately discards and refetches → **SSR that costs a round trip and buys nothing**. A copy of the policy inside a prefetch page drifts within a release.

`staleTime: 30_000` is the load-bearing number. `retry` opts out immediately when `error.message === "UNAUTHENTICATED"` — that is a decision the server already made; retrying spends two round trips proving a known answer.

### The prefetch `queryKey` MUST be the screen component's own `queryKey`

Not a similar one, not a subset. A page that invents its own key hydrates a cache nothing reads, and the browser refetches the very query the server just ran. The key is part of the contract, so `ScreenQuery` takes the key **beside** the `queryFn` that produced it and cannot drift apart in a file that has to repeat both.

The `queryFn` must also resolve to exactly what the screen's own `queryFn` resolves to. A wrapper that unwraps an envelope the screen expects wrapped hydrates a value the screen cannot read — and the only symptom is a screen that ignores perfectly good data.

### A failed prefetch is not an error page

`prefetchQuery` records the rejection on the query and resolves; `dehydrate` then omits it. So a gateway timeout costs the server one logged failure and the browser nothing: it fetches on mount and the screen renders its own `ErrorState`, which already knows how to explain the failure and offer a retry (AGENTS.md §2 Rule 9). A page that let the prefetch `throw` would turn a readable data problem into a **500 for the whole screen**. Per-query `retry: false` exists for reads the browser is about to repeat anyway.

### Do not call a Server Action from a `queryFn`

Server Actions run **serially, not in parallel**, when called from the client, which conflicts with how React Query fetches and refetches — queries can hang pending or never run. Server Actions are for **mutations** (`useMutation`), not `queryFn`. Fetching goes through the BFF `/api/v1/*` route.

## Related

- [zustand.md](zustand.md) — the other half of the state picture. Query cache = server data; store = view state.
- [next.md](next.md) — `"use server"` files may only export async functions, which constrains where `queryFn` can live.