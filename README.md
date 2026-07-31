# Buddysaradhi

> The operating system for tutors — run an entire tuition business from five screens, offline-first, with the elegance of Apple, the data density of Kite, and the persistent flow of Discord.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Apps](#apps)
- [Packages](#packages)
- [Deployment](#deployment)
- [Development](#development)
- [Specs & Documentation](#specs--documentation)
- [Non-Negotiable Rules](#non-negotiable-rules)

---

## Overview

Buddysaradhi lets a single tutor — or a 200-student coaching institute — manage their entire tuition business:

- **Dashboard** — KPIs, due-today, quick actions
- **Students** — CRUD, search, detail drawer
- **Attendance** — Daily session marking, preset summaries
- **Fees & Payments** — Invoices, payments, receipts, ledger
- **Settings** — 8 palettes, locale, currency, backup

**Five screens. Seven engines. One ledger. Zero servers to manage.**

## Architecture

```
buddysaradhi/
├── apps/
│   ├── web/                  # Next.js 16 frontend (v1.0 — primary surface)
│   ├── gateway/              # API Gateway — Supabase Edge Functions (Deno)
│   ├── mobile/               # Expo React Native (v1.x)
│   ├── desktop/              # Tauri v2 desktop (v1.x)
│   └── product-page/         # 3D product landing page
├── packages/
│   ├── core/                 # Ledger engine — shared across all apps
│   ├── shared/               # Zod schemas, types, calculation utils
│   ├── ui/                   # Cross-platform glass component primitives
│   └── security/             # Security utilities
├── prisma/                   # Prisma schema (local dev DB)
├── Buddysaradhi_Planning/    # 24-file specification (00–23)
├── docs/                     # RFCs, plans, specs
└── .github/workflows/        # CI/CD (web, gateway, mobile, desktop)
```

## Apps

| App | Path | Runtime | Status | Docs |
|-----|------|---------|--------|------|
| **Web** | `apps/web/` | Next.js 16 (Node.js 22) | v1.0 — primary | [README](apps/web/README.md) |
| **API Gateway** | `apps/gateway/` | Deno 2 (Supabase Edge Functions) | v1.0 — deployed | [README](apps/gateway/README.md) |
| **Mobile** | `apps/mobile/` | Expo (React Native) | v1.x — planned | — |
| **Desktop** | `apps/desktop/` | Tauri v2 (Rust) | v1.x — planned | [README](apps/desktop/README.md) |

### API Gateway (`apps/gateway/`)

The **canonical backend** for all platforms. Every client (web, mobile, desktop) calls this gateway over HTTPS. No platform runs its own service.

- **REST** (`/api/v1/*`) — all mutations, entity reads, sync
- **GraphQL** (`/graphql`) — read-only aggregation
- **Provisioning** (`/api/v1/provision`) — new tenant DB setup
- **Runtime:** Deno 2 on Supabase Edge Functions
- **DB:** Per-tenant Turso/libSQL (single-tenant SQLite)

### Web App (`apps/web/`)

The primary user-facing surface. Next.js 16 App Router with:
- Server Components for data fetching
- Client Components only for interactive glass/neumorphic UI
- Zustand for UI state, TanStack Query for server cache
- Tailwind 4 + Vibrant Glass design system
- Deployed to **Vercel** via GitHub Actions

## Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@buddysaradhi/core` | `packages/core/` | Ledger engine — `postLedgerEntry`, `voidEntry`, `computeBalance` |
| `@buddysaradhi/shared` | `packages/shared/` | Zod schemas (single source of truth), calc utils |
| `@buddysaradhi/ui` | `packages/ui/` | Cross-platform glass primitives (v1.x) |
| `@buddysaradhi/security` | `packages/security/` | Security utilities, ESLint config |

## Deployment

| Target | Command | Trigger |
|--------|---------|---------|
| **Web (Vercel)** | `vercel deploy --prod --yes` | Push to `main` (CI gate passes) |
| **Gateway (Supabase)** | `supabase functions deploy gateway --project-ref gmqwdnvbfnwpzpctwvho --no-verify-jwt` | Push to `main` (CI gate passes) |
| **Provision DB** | `supabase functions deploy provision-db --project-ref gmqwdnvbfnwpzpctwvho --no-verify-jwt` | Push to `main` |

### CI/CD

- **web-prod-gate.yml** — Lint, typecheck, tests → Vercel deploy
- **supabase-ci.yml** — Lint, tests → Supabase function deploy
- **mobile-ci.yml** — EAS build (v1.x)
- **desktop-ci.yml** — Tauri build (v1.x)

## Development

### Prerequisites
- Node.js 22.x
- pnpm 11.x
- Deno 2.x (for gateway)

### Quick start
```bash
# Install all dependencies
pnpm install

# Run web dev server
pnpm --filter web dev

# Run gateway locally
cd apps/gateway && deno run -A index.ts

# Lint everything
pnpm lint

# Typecheck everything
pnpm typecheck

# Run all tests
pnpm test:unit
```

### Useful commands
```bash
# Web only
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web test:e2e

# Gateway only
cd apps/gateway && deno lint
cd apps/gateway && deno test --allow-all __tests__/

# Core/shared packages
pnpm --filter @buddysaradhi/core build
pnpm --filter @buddysaradhi/shared build
```

## Specs & Documentation

The full specification lives in `Buddysaradhi_Planning/`:

| Spec | Description |
|------|-------------|
| [00_Vision.md](Buddysaradhi_Planning/00_Vision.md) | Elevator pitch, problem, market |
| [01_Product_Principles.md](Buddysaradhi_Planning/01_Product_Principles.md) | Constitution — 15 principles + anti-principles |
| [02_Core_Logic.md](Buddysaradhi_Planning/02_Core_Logic.md) | 7 engines, sync state machine |
| [04_Dashboard.md](Buddysaradhi_Planning/04_Dashboard.md) | Dashboard screen spec |
| [05_Students.md](Buddysaradhi_Planning/05_Students.md) | Students screen spec |
| [06_Attendance.md](Buddysaradhi_Planning/06_Attendance.md) | Attendance screen spec |
| [07_Fees_and_Payments.md](Buddysaradhi_Planning/07_Fees_and_Payments.md) | Fees & Payments screen spec |
| [08_Settings.md](Buddysaradhi_Planning/08_Settings.md) | Settings screen spec |
| [10_Security.md](Buddysaradhi_Planning/10_Security.md) | Auth, crypto, threat model |
| [11_Data_Model.md](Buddysaradhi_Planning/11_Data_Model.md) | Schema, IDs, money |
| [12_Business_Rules.md](Buddysaradhi_Planning/12_Business_Rules.md) | All BR-* rules |
| [13_UI_Guidelines.md](Buddysaradhi_Planning/13_UI_Guidelines.md) | Design system |
| [17_API_Gateway_System.md](Buddysaradhi_Planning/17_API_Gateway_System.md) | Gateway architecture |
| [AGENTS.md](AGENTS.md) | Master agent directive |

### App-specific docs
- [Web App README](apps/web/README.md)
- [API Gateway README](apps/gateway/README.md)
- [Desktop README](apps/desktop/README.md)

## Non-Negotiable Rules

1. **Ledger is append-only** — never UPDATE or DELETE `ledger_entries`; voids are new rows
2. **No outbound network calls** — offline-first; only dumb blob store (v2)
3. **No telemetry SDK** — not even "anonymous" analytics
4. **Five screens only** — a sixth requires a principle amendment
5. **No indigo/blue primary accents** — use bioluminescent palette (emerald, cyan, flare, amber, violet)
6. **Integer paise, never float** — `bigint` or safe-integer `number`
7. **Every mutation writes `sync_outbox`** — same transaction as the mutation
8. **Backups are AES-256-GCM + Argon2id** — never plaintext
9. **No silent failures** — every error throws or returns typed error
10. **Accessibility is not optional** — WCAG 2.1 AA, 44x44px touch targets

See [AGENTS.md](AGENTS.md) for full details.

---

## License

Private — Buddysaradhi. All rights reserved.
