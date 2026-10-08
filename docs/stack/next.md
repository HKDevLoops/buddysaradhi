# Next.js

- **Docs:** https://nextjs.org/docs
- **Pinned:** `16.2.12` — exact pin, no caret (`apps/web/package.json:36`, root `package.json:66`, root `overrides.next: ^16.2.12`)
- **Bundled docs in-repo:** `apps/web/node_modules/next/dist/docs/` (`01-app`, `02-pages`, `03-architecture`, `04-community`). `apps/web/AGENTS.md` instructs reading this before writing code, because 16 differs from older training data.
- **Companions:** `eslint-config-next@16.2.10`, `react@19.2.4`, `react-dom@19.2.4`

## Project specifics

### `"use server"` files may ONLY export async functions

**This is a BUILD-time error, not a type error.** `tsc --noEmit` stays green, every unit test stays green, and then `next build` fails — and once built and deployed, every screen in the app 500s with:

```
A "use server" file can only export async functions
```

It shipped once. Symptom recorded in `docs/mindmap.md` §6: 621 tests green while every screen returned 500.

Two forms of the trap, both hit:

1. `export const CONST = ...` in a `"use server"` file.
2. `export { CONST } from "./isomorphic-module"` — a **re-export**. A scanner that only greps `export const` will not catch this; it looks like a clean separation and is not.

**Guard that exists now:** gate constants live in plain isomorphic modules and are imported by the action file — `apps/web/src/server/attendance-window.ts` and `apps/web/src/lib/settings-gates.ts`. Neither carries a `"use server"` directive.

**Gate that catches it:** `pnpm --filter web build`. It is not optional for a change touching a server action; nothing else in the toolchain sees this class of bug.

### `ssr: false` cannot live in a Server Component

`/settings` and `/attendance` were briefly wrapped as `ssr: false` behind `next/dynamic`. Beyond being illegal in a Server Component, it was the wrong answer for the actual problem, which was a hydration mismatch (§Zustand below). Fixing the mismatch at the store removed the need for the wrapper, and the wrapper was deleted per AGENTS.md §0.2.

### The App Router owns `popstate` and offers no veto

The pre-SSR shell used `?screen=` query state, whose hook could refuse a browser Back press while a tutor had a typed ₹5,000 payment open. With five real routes that guard is gone: the App Router performs the navigation and exposes no API to intercept or cancel it. This is a **stated regression**, recorded in `docs/plans/TABS-HARDEN-01.md` §2, not an oversight. Mitigation in place: `GlassShell` closes the fee sheets on unmount so a sheet cannot leak across a navigation.

### `middleware.ts` was renamed `proxy.ts` in 16

This repo's session-refresh middleware is `apps/web/src/proxy.ts`. Next 15 named it `middleware.ts` and never called the file; 16 renamed it. Any Supabase SSR pattern copied from older docs will be silently dead here.

### `next.config.ts` needs `experimental.useTypeScriptCli: true`

TypeScript 7 removed the compiler API path Next used. Without the flag, `next build` fails under TS 7. Set in `apps/web/next.config.ts:38` with the reason in a comment.

### Name collision: route config vs `next/dynamic` import

`export const dynamic` (route segment config) collides with `import { dynamic } from 'next/dynamic'` in the same file — TS2395/TS2440. Rename the import (`nextDynamic`). Recorded as AGENTS.md §15 FM-11.

## Related

- Per-request React Query cache: [tanstack-react-query.md](tanstack-react-query.md)
- Store hydration: [zustand.md](zustand.md)