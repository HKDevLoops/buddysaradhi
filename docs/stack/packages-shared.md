# packages/shared — the cross-platform schema of record

- **Package:** `@buddysaradhi/shared` v1.0.0
- **Docs for its dependency:** [zod.md](zod.md) · [typescript.md](typescript.md)
- **Pinned deps:** `zod@^3.24.2`, `@zodios/core@^10.9.6`; dev: `typescript@^7.0.2`, `openapi-typescript-codegen@^0.31.0`, `openapi-zod-client@^1.18.3`
- **Build:** `tsc` → `./dist` (CommonJS + `.d.ts`), consumed as `workspace:*`
- **Built by:** root `postinstall`, *before* `packages/core`

## Why this earns its own file

`packages/shared` is not a third-party technology, but it is the one workspace package whose breakage is **cross-platform**: web, core, and eventually mobile/desktop all import it, so a schema change here is a change to every platform's contract. `AGENTS.md` §9.2 forbids an In-Flight agent editing another platform's files — but this package is the sanctioned shared surface, so the rule that applies is *contract change ⇒ RFC*, not *don't touch*.

## Project specifics

### The build order is not alphabetical — `shared` builds before `core`

Root `postinstall`:

```
prisma generate && pnpm --filter @buddysaradhi/shared build && pnpm --filter @buddysaradhi/core build
```

`packages/core` depends on `shared` and its `exports` map points at `./dist/*.js` + `.d.ts`. A fresh clone that skips `postinstall` typechecks against missing `dist` files and reports a wall of "cannot find module" errors that have nothing to do with the code you changed.

### Output is CommonJS with declarations; the app is ESM

`packages/shared/tsconfig.json` and `packages/core/tsconfig.json` both set `module: CommonJS`, `declaration: true`, `outDir: ./dist`. `apps/web` uses `module: esnext` + `noEmit`. This is not drift — the workspace packages are consumed through their `exports` maps, which require real emitted `.js` + `.d.ts`.

### Contents and what each file is authoritative for

| File | Authority |
|---|---|
| `src/schemas.ts` | Zod schemas — the single source of truth for request/response shapes |
| `src/types.ts` | inferred types (`z.infer`), never hand-written (AP-18) |
| `src/feeCalc.ts` | fee arithmetic in **integer paise**. Hand-rolled date/amount maths is *less* precise — see below |
| `src/fuzzy.ts` | the search engine's scoring (Search engine, AGENTS.md §2) |
| `src/pin.ts` | PIN hashing/verification contract (10_Security.md §3) |
| `src/outboxPayload.ts` | the `sync_outbox` row shape (Rule 7) |

### Money and dates: the native-first verdict KEEPS `date-fns`

`docs/plans/TABS-HARDEN-01.md` §3 and `docs/mindmap.md` §8 record the measured verdicts. The rule is **precision, not purity**. A hand-rolled `addMonths` is *less* precise than `date-fns`, and AGENTS.md §2 Rule 6 makes date arithmetic a money path — so `date-fns` stays. Conversely `lodash.debounce` (0 sites), `idb-keyval` (0 sites), and `clsx` (1 site) were removed because the native replacement is exact, not merely adequate.

When you swap a dependency, **write the precision verdict next to it**. A vibe is not a justification.

### Do not duplicate a formula

If a fee formula, a due-date rule, or a ledger behaviour already exists here or in `packages/core`, importing it is the only correct move. A second copy of money logic is a P0 defect (AGENTS.md §3.5), and the ledger dialect-parity test is the gate that catches it.

### Generated code is committed-adjacent, not hand-edited

`generate:sdk` / `generate:zod` run against `contracts/openapi.yaml`. Their output (`./sdk`, `./zod/index.ts`) is produced, not authored — edit the OpenAPI contract and regenerate, never the output.

## Related

- [prisma.md](prisma.md) — `packages/core` is where Prisma actually appears.
- [zod.md](zod.md) — the validation contract and its version pinning.