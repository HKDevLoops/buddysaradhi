# Stack references

One file per technology this repo actually depends on. Each carries the
**canonical documentation URL**, the **version pinned in the repo** (read from the
real `package.json`, not guessed), and the **project-specific notes** — the things
a reader could only learn by being in this codebase and hitting the same walls.

A stack reference is a **pointer plus this project's hard-won specifics**, not a
tutorial. If a section has nothing project-specific to say, it says the link and
stops.

Owned by `docs/plans/TABS-HARDEN-01.md` §5. Written by the DOCS lane.

## The index

| File | Stack | Pinned |
|---|---|---|
| [next.md](next.md) | Next.js | 16.2.12 |
| [react.md](react.md) | React | 19.2.4 (web) · 19.2.7 (root) |
| [typescript.md](typescript.md) | TypeScript | ^7.0.2 |
| [tailwindcss.md](tailwindcss.md) | Tailwind CSS | ^4 → 4.3.2 |
| [zustand.md](zustand.md) | Zustand | ^5.0.14 |
| [tanstack-react-query.md](tanstack-react-query.md) | TanStack Query | ^5.101.1 → 5.101.2 |
| [zod.md](zod.md) | Zod | 3.24.2 (exact) |
| [react-hook-form.md](react-hook-form.md) | React Hook Form | ^7.80.0 → 7.81.0 |
| [vitest.md](vitest.md) | Vitest | ^4.1.10 → 4.1.10 |
| [playwright.md](playwright.md) | Playwright | ^1.61.1 → 1.61.1 |
| [libsql.md](libsql.md) | libSQL / Turso | @libsql/client ^0.17.4 |
| [deno.md](deno.md) | Deno (gateway) | 2.9.7 |
| [prisma.md](prisma.md) | Prisma | 6.2.1 (exact) |
| [supabase.md](supabase.md) | Supabase | @supabase/ssr ^0.12.0 · supabase-js ^2.110.8 |
| [eslint-prettier.md](eslint-prettier.md) | ESLint + Prettier | eslint ^10.8.0 (root) · ^9 (web) |
| [ui-primitives.md](ui-primitives.md) | Radix / Base UI / shadcn / lucide / date-fns | see file |
| [packages-shared.md](packages-shared.md) | `@buddysaradhi/shared` | 1.0.0 |
| [packages-core.md](packages-core.md) | `@buddysaradhi/core` | 1.0.0 |

## The three traps that span the whole stack

Read these before debugging anything that "passes tests but breaks in the app":

1. **A `"use server"` file may only export async functions** — including no
   `export { CONST }`. BUILD-time error, invisible to `tsc` and to every test. →
   [next.md](next.md)
2. **A module-scoped `QueryClient` is a cross-tenant data leak.** The server
   client must be wrapped in React's `cache()`. → [tanstack-react-query.md](tanstack-react-query.md)
3. **A `persist` + `sessionStorage` store needs `skipHydration: true` and a
   `rehydrate()` effect**, or server markup and first client render disagree on
   every load. → [zustand.md](zustand.md)

## Rules for adding to this directory

- **Every URL must resolve.** A dead link in a reference document is worse than
  no document. Verify before committing.
- **Never invent a version.** Read the `package.json` (or `node_modules/<pkg>/package.json`
  for the resolved version) and cite both the specifier and what it resolved to.
- **Do not restate the official docs.** If a section has nothing project-specific
  to add, state the link and stop.
- **Gotchas are symptom-shaped.** "Every screen 500'd with `A "use server" file
  can only export async functions` while 621 tests were green" is useful. "Be
  careful with server actions" is not.
- **Every note must be traceable** to a real file in this tree. If you cannot
  point at the line, it is folklore — either find the evidence or drop the note.