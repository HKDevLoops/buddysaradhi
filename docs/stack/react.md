# React 19

- **Docs:** https://react.dev/learn (start here) · https://react.dev/reference/react (API index)
- **Pinned:** `19.2.4` in `apps/web` (`react` + `react-dom`, exact pins) · `19.2.7` at the repo root (`package.json:67-68`) · `@types/react@19.2.17`, `@types/react-dom@19.2.3` pinned via root `overrides`

> **Version skew is real and deliberate-looking.** Root is 19.2.7, `apps/web` is 19.2.4. The app is what ships, so `apps/web`'s pin is the one that governs behaviour. Root's copy exists for the `postinstall`/root-level tooling. Two React copies in one process is exactly the failure mode the React dedupe work exists to prevent — see `docs/mindmap.md` and the `pnpm.overrides` block in the root `package.json`. Do not "fix" one side without fixing the other.

## Project specifics

### `cache()` from React is the per-request memo, and this repo depends on it

`apps/web/src/app/(app)/screen-data.tsx:77` builds the server-side `QueryClient` with `React.cache`:

```ts
export const getRequestQueryClient = cache(
  (): QueryClient => new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS }),
);
```

`cache()` scopes the instance to one request's render and drops it when the response is done. **Never hoist this to module scope** — a module singleton puts one tutor's roster in another tutor's HTML. Full reasoning in [tanstack-react-query.md](tanstack-react-query.md).

### `cache()` and `"use client"` do not mix in one direction

`apps/web/src/app/query-defaults.ts` is a **plain module** — no `"use client"`, no `"use server"` — specifically so a Server Component and a Client Component can import the same object. A value imported from a `"use client"` module arrives in a Server Component as a *client reference*, not as the value, and the shared cache policy silently becomes two policies.

### `prefers-reduced-motion` is not optional here

AGENTS.md §2 Rule 10 / §16 require it honoured on every new animation. No project-specific React mechanism, but it is the rule most often broken by adding a `transition` class.

## Related

- Server/client boundary and `next build` errors: [next.md](next.md)
- `skipHydration` mismatch: [zustand.md](zustand.md)