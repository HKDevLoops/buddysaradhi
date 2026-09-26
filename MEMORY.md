# Buddysaradhi — Persistent Memory (seed)

> File-backed memory for OpenCode (Kilo parity: `kilo_memory_save` /
> `kilo_memory_recall`). The `memory` skill owns this file. Agents: READ this
> first, UPDATE after durable findings. NEVER store secrets, tokens, PINs, or
> passphrases here — decisions, paths, and commands only.

## Current Platform State

- `In-Flight: WEB` | `MOBILE: LOCKED` | `DESKTOP: LOCKED` |
  `WEB gate: IN-FLIGHT`
- Exactly ONE platform In-Flight at a time (`16_Platform_Delivery_Sequence.md`).
- Scaffolds at `apps/mobile/` + `apps/desktop/` stay LOCKED until
  `WEB-PROD-GATE`.

## Durable Decisions

- Spec root is repo root (`00_*.md` + `web/` + `product/` + `deployment/`), NOT
  `Buddysaradhi_Planning/`.
- Money = integer paise via `paiseAdd/paiseSub/paiseMul`
  (`packages/shared/src/utils/format.ts`).
- Ledger append-only: only `db.ledgerEntry.create()`; voids = new rows with
  `reversesEntryId`.
- Every mutation writes `sync_outbox` + `audit_log` in the SAME transaction.
- Vercel project `buddysaradhi`: root `vercel.json` pins
  `outputDirectory: apps/web/.next`.
- Product-page deploys via `vercel --prod` from its own dir; Vercel dashboard
  uses `bun install` + `next build`.
- Gateway deploys via
  `supabase functions deploy gateway --project-ref gmqwdnvbfnwpzpctwvho`.
- Crypto: `hashPin` uses argon2 `secret` (NOT `associatedData`) to match
  `verifyPin`.
- `packages/shared/zod/index.ts` carries `// @ts-nocheck` (TS2589 on `makeApi`
  with TS 7).
- Run MCP CLIs from `$env:TEMP` — repo `npmrc`/`pnpm overrides` break bare
  `npx`.
- `drei ^10.0.0-rc.3` detached the build; pinned `@react-three/drei ^9.105.6` +
  `fiber 8.16.2`.

## Corrections

- Never hardcode origins in `fetch` — read base URL from
  `env.NEXT_PUBLIC_APP_URL`.
- Never run `pnpm install --no-frozen-lockfile` blindly — sync `pnpm-lock.yaml`
  deliberately.
- `drei` RC versions break Vercel turpopack typecheck — stay on stable v9.
- `argon2` `associatedData` ≠ `secret` — hashing and verify must use the SAME
  parameter.

## Environment

- Shell: PowerShell 7 (`pwsh`), Windows. Package manager: `pnpm@11.15.0` (+
  `bun` for scripts).
- CLIs on PATH: `gh`, `vercel` (59.3.0), `supabase` (2.113.0), `deno` (2.9.6),
  `opencode`.
- Remote: GitHub `HKDevLoops/buddysaradhi` (branch `main`), Vercel `hdkevs`,
  Supabase ref `gmqwdnvbfnwpzpctwvho`.
- Higgsfield: CLI `1.1.26` global (`npm i -g --allow-scripts=@higgsfield/cli`;
  postinstall blocked otherwise); skills at
  `~/.config/opencode/skills/higgsfield` (8 skills).
- Asset strategy: free chat models can't generate media (Mimo =
  understanding-only; StepFun image API needs paid key) → Higgsfield free-tier
  is the generator; ALWAYS `higgsfield generate cost` before `create`; auth
  pending user (`higgsfield auth login`).
- NIM (NVIDIA): no NIM wiring existed anywhere; researched ladder
  (qwen-image-2512 finals, flux.1-schnell drafts, flux.1-dev fallback; Cosmos
  video = self-host GPU only, not serverless). opencode provider `nvidia-nim`
  wired via `{env:NVIDIA_API_KEY}` (never store key in repo). Generation script:
  `apps/product-page/scripts/nim-generate.ps1` (Verify/Drafts/Finals, seeds
  7101-7104).
- CSP hard lesson (Next 16 static + Turbopack): nonce CSP is IMPOSSIBLE on
  force-static pages (no request headers at prerender; vercel/next.js #96063
  closed as expected). Static marketing pages use script-src self+unsafe-inline
  with everything else locked down; middleware nonce only helps dynamic routes.
  Never ship static script-src without nonces (bricks hydration, canvas 0).
- TestSprite needs TESTSPRITE_API_KEY env + MCP restart; without it only the
  Playwright loop is available.
