# ESLint + Prettier

- **Docs:** https://eslint.org/docs/latest/ · flat config files: https://eslint.org/docs/latest/use/configure/configuration-files · https://prettier.io/docs/en/index.html
- **Pinned:** `eslint@^10.8.0` (root) / `^9` (workspaces — the version actually installed for `apps/web` is **9.39.5**) · `@eslint/js@^10.0.1` · `prettier@^3.9.6` → 3.9.6 · `prettier-plugin-tailwindcss@^0.8.0` · `eslint-config-next@16.2.10`

> **The root and `apps/web` are on different major ESLints** (10 vs 9). That is the state on disk; do not assume a rule behaves identically across both when reading output from `pnpm -r lint`.

## Project specifics

### `typescript-eslint` was removed from this repo, permanently

`typescript-eslint@8.x` uses TypeScript's deprecated CJS compiler API, which **TypeScript 7 removed**. Under TS 7 it throws `Cjs undefined error in typescript-estree`, crashing the pre-commit hook and forcing `--no-verify` workarounds. Every config here is `@eslint/js` recommended + `languageOptions.globals` — no TS parser anywhere:

- `eslint.config.mjs` (root)
- `apps/web/eslint.config.mjs`
- `apps/desktop/eslint.config.mjs`

**Do not reintroduce it.** See [typescript.md](typescript.md).

### ⚠️ `eslint .` does NOT lint `.ts`/`.tsx` — `tsc --noEmit` is the real gate

Because there is no TS-aware parser, a clean `eslint .` says nothing about TypeScript correctness. AGENTS.md §15 FM-17. This is the single most misreported result in this repo's history.

The actual gate:

```bash
pnpm run typecheck     # → pnpm --filter web typecheck → tsc --noEmit
```

### `apps/mobile` and `apps/desktop` are ignored by the root config — deliberately

Root `eslint.config.mjs` ignores both, with the reason in a comment: `apps/mobile`'s Expo flat config crashes under TS 7 and its lint script skips linting; `apps/desktop` parses `.ts` with plain espree and its CI gate is oxlint. They each have their own gate. A root `eslint .` run will not touch them, and that is correct, not an oversight.

### Zero-warning policy, and where it is enforced

CI lints with `--max-warnings 0`. The root config sets `no-console: "warn"` and a strict `no-unused-vars` (with `caughtErrorsIgnorePattern` for `e`/`err`/`error`/`_`). `apps/web` overrides both to `"off"` because the web app's real gates are `tsc` and `scripts/principle-lints.ts`.

### `scripts/principle-lints.ts` is where the non-negotiables actually live

`pnpm run lint` = `pnpm -r --if-present lint` **plus** `node scripts/principle-lints.ts`. Seven principle lints run there, including the P0 `no-raw-sql` (L6) that blocks `$queryRaw` / `$executeRaw` / string SQL at runtime, and the no-ledger-mutation scan. A tripped build fails with **no override** without a spec citation, a security reviewer, and an expiry.

This script also used to take **697s** because of a cache problem; it now takes ~5s. If you see it jump back to minutes, a cache is being bypassed.

## Related

- [typescript.md](typescript.md) — why the parser is absent and what actually type-checks.
- [prisma.md](prisma.md) — the ORM-only rule that `no-raw-sql` enforces.