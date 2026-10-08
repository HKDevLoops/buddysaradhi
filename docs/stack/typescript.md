# TypeScript 7

- **Docs:** https://www.typescriptlang.org/docs/ · https://www.typescriptlang.org/tsconfig/
- **7.0 announcement:** https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ (the official TypeScript blog; typescriptlang.org links it from the docs index — there is no handbook page for 7.0)
- **Pinned:** `^7.0.2` in root, `apps/web`, `packages/core`, `packages/shared`. **Exception:** `packages/design-system` is on `^5.9.3` (resolves **5.9.3**) — an independently versioned token generator that was not migrated. Its scripts compile under TS 5, so a TS-7-only construct there will fail.
- **Compiler on disk:** `typescript@7.0.2` (Go-native port)

## Project specifics

### `typescript-eslint` was REMOVED from this repo, permanently

`typescript-eslint@8.x` calls TypeScript's deprecated CJS compiler API. Under TS 7 that throws `Cjs undefined error in typescript-estree`, which crashed the pre-commit hook and forced `--no-verify`. Every ESLint config here is `@eslint/js` recommended + `languageOptions.globals` — no TS parser:

- `eslint.config.mjs` (root)
- `apps/web/eslint.config.mjs`

**Consequence you will trip over:** that config is `@eslint/js` with no TS-aware parser, so **`eslint .` does not actually lint `.ts`/`.tsx`**. A "lint clean" claim from ESLint alone is not a TypeScript gate. AGENTS.md §15 FM-17. The real TS gate is:

```bash
pnpm --filter web typecheck    # tsc --noEmit
```

`apps/desktop` additionally parses `.ts` with plain espree (pre-existing) and `apps/mobile`'s flat config crashes under TS 7 — both are ignored by the root config so root `eslint .` does not double-lint them, and both have their own CI gate.

### The CLI flag Next.js needs

`apps/web/next.config.ts` sets `experimental.useTypeScriptCli: true`. TS 7 removed the compiler API path Next used to type-check during build. Without the flag `next build` fails. See [next.md](next.md).

### `moduleResolution: "bundler"` is required for the resolver subpaths

`apps/web/tsconfig.json` uses `"moduleResolution": "bundler"`. That is not stylistic: `@hookform/resolvers/zod` is a **subpath export**, and under `node10`/`node` resolution it fails to resolve at all, producing `Cannot find module '@hookform/resolvers/zod'`. See [react-hook-form.md](react-hook-form.md).

### TS 7 language features: two adoptions, and four measured KEEPs

`docs/plans/TABS-HARDEN-01.md` §4 lists `satisfies`, `const` type parameters, `using`, `NoInfer<T>`, `accessor`, and `in`/`out` variance as available, and constrains their use to places that *remove code or a cast*. A feature that merely still type-checks after conversion is churn, so a correct **KEEP** is a result here, not a failure.

**Adopted (`satisfies`), both mutation-tested — a deliberate typo in either is a compile error:**

| Site | Removed | Why it paid |
|---|---|---|
| `apps/web/src/components/settings/settings-nav.tsx:36` | **2 `as` casts** (`section.id as SettingsSectionId`, twice) | The 13 section ids are written twice — as the union in `settings-store.ts` and as `id:` values in `SECTIONS`. The two casts were laundering the drift; `as const satisfies readonly { id: SettingsSectionId; … }[]` makes a typo'd id `TS2820` and leaves `section.id` assignable with no cast. |
| `apps/web/src/app/api/v1/[...slug]/route.ts:105` | **2 `as const` clenches** | `defaultFilters` was only assignable because of two inline `as const`; its key set was unchecked. `satisfies StudentFilters` checks the key set and both enums. Honest limit: the four `[]` arrays are **not** meaningfully checked — an empty array infers `never[]`, which satisfies any element type. |

`satisfies` is the pattern §4 asks for: the annotation becomes a **checked** constraint instead of a widening coercion. `packages/design-system/src/surfaces.ts:58,71` already used `as const satisfies readonly (keyof PaletteTokens)[]`; these two are the same idiom applied in `apps/web`.

**KEEP, with the evidence that convinced us:**

- **`NoInfer<T>`** — `server/get-db.ts:452,484,516,548` (`gatewayGet<T = unknown>` and siblings). `T` appears **only** in the return type; it is not inferable from `path`/`params`/`body`. There is no inference site to block, so `NoInfer` is a no-op. `profile-section.tsx` derives `ProfileFormValues` from `z.infer` and calls `zodResolver(profileSchema)` with no explicit type argument at all — nothing bleeds into the call site.
- **`const` type parameters** — no generic helper in `apps/web` is clenching with `as const`. The occurrences are all top-level literal tuples/objects (nothing generic), or load-bearing discriminant narrowings in non-generic server actions (`server/actions/settings.ts:720,730,…` `code: "VALIDATION" as const` — removing one collapses the result union and breaks every `res.code === "VALIDATION"` narrowing), or library calls this lane does not own (`cva`, `z.enum`, `forwardRef`).
- **`using`** — `lib/db.ts` + `lib/offline-queue.ts` cache through `lib/lru.ts` `BoundedCache`, whose cleanup is an `onEvict(key, value)` hook fired **per evicted entry on insert**. `using` binds disposal to a lexical scope; these caches are module-level singletons whose lifetime is the *process*, and a `Symbol.dispose` would dispose the whole cache at scope exit, not the one LRU victim. A `using` block is strictly worse than the hook. `lib/db.ts:33` even needs declaration ordering (`prismaCache` before the closure that references it) — an ordering constraint `using` cannot express.
- **`accessor`, explicit `in`/`out` variance, `NoPropertyAccessFromIndexSignature`** — no repo interface needs one. `NoPropertyAccessFromIndexSignature` was measured: `tsc --noEmit --noPropertyAccessFromIndexSignature` produces **439 errors**, essentially all `process.env.*` (a legitimately open map) plus Supabase `user_metadata`. It removes 0 lines and adds 439 bracket-noise errors. `Settings` (`types/settings.ts:18`) already lists every field it exposes above its `[key: string]: unknown` index, so `readText(settings, key, fallback)` narrows explicitly rather than by cast.

**Rejected as a simplification, with the reason:**

- `components/students/add-student-sheet.tsx:158` `FormValues` looks like the textbook "schema + hand-written type" duplication (14 fields written twice). It is **not** one. `Omit<z.input<typeof FormSchema>, "baseFee"> & { baseFee?: number }` fails on three of the fourteen: `phone` is `z.union([string, null, undefined])` so its input gains `| null` (which `<input value>` cannot take); `fee_model` has `.default("postpaid")` so its input becomes **optional**, weakening a required field to a possibly-missing one; and `baseFee` is `z.coerce.number()`, whose input is `unknown`. Deriving is not a simplification here — it is a loosening, and the hand-written INPUT shape is the honest one. Note the file's comment at :53 is imprecise: `.transform` does **not** widen the input to `unknown` (`boundedDateField` was deliberately written with `.transform` rather than `z.preprocess` for exactly that reason); only `z.coerce.number()` does.
- `lib/csv-parse.ts:677` `StudentImportRow = z.infer<typeof StudentImportRowSchema>` is already single-source — the type is derived, never written twice. `packages/shared/src/schemas/*` (30 schemas) likewise: every model exports `z.infer`, none restates a shape.
- `lib/palettes.ts:93` `MATERIAL_OPTIONS: readonly MaterialOption[]`, `components/ui/avatar.tsx:59` `SIZE_SCALE: Record<AvatarSize, …>`, `lib/app-errors.ts:37` `STATES: Record<AppErrorCode, AppErrorState>` — already carry a real annotation, and `satisfies` would remove nothing. On `SIZE_SCALE` it would actively **lose** the `` ring: `${number}px` `` constraint unless `as const` were added too, turning a future typo from a compile error into a passing build.

**Not done, reported instead:** the "all filters empty" default is written out three times — `app/api/v1/[...slug]/route.ts:105`, `stores/students-store.ts:102`, `components/settings/import-export-section.tsx:168`. Collapsing them is a runtime refactor, not a type-level one, and it crosses the hooks/stores lane's file ownership.

### `strict: true` everywhere, `noUncheckedIndexedAccess` is NOT

All four tsconfigs set `strict: true`. None set `noUncheckedIndexedAccess`, despite AGENTS.md §6.1 naming it. Index-access returns are therefore still `T`, not `T | undefined` — do not assume the stricter behaviour from the manual.

### Per-package output settings differ on purpose

| Package | `target` | `module` | `outDir` |
|---|---|---|---|
| `apps/web` | ES2017 | esnext | (none, `noEmit`) |
| `packages/core` | ES2022 | CommonJS | `./dist` |
| `packages/shared` | ES2022 | CommonJS | `./dist` |

`packages/core` and `packages/shared` compile to CommonJS with declarations because they are consumed as `workspace:*` dependencies whose `exports` map points at `./dist/*.js` + `.d.ts`. `apps/web` never emits. The root `postinstall` builds both packages — a fresh clone that skips it will typecheck against missing `dist`.

## Related

- AGENTS.md §6.1 code-style rules (no `any`, `as` needs `// SAFETY:`, Zod-inferred types) are repo policy, not TypeScript policy.