# API Gateway — `apps/gateway`

> The canonical edge gateway for all Buddysaradhi platforms (web, mobile, desktop). Runs on **Supabase Edge Functions** (Deno runtime).

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Endpoints](#endpoints)
- [Directory Structure](#directory-structure)
- [Local Development](#local-development)
- [Deployment](#deployment)
- [Environment Variables](#environment-variables)
- [Security](#security)
- [Testing](#testing)

---

## Overview

The API Gateway is the single backend entry point for all Buddysaradhi clients. Every platform — web (Next.js), mobile (Expo), desktop (Tauri) — calls this gateway over HTTPS. No platform runs its own service.

The gateway is a **Deno/TypeScript** edge function that:
- Authenticates requests via Supabase JWT
- Routes to per-tenant Turso/libSQL databases
- Provides REST and GraphQL interfaces
- Handles schema provisioning for new tenants
- Enforces security (nonce, timestamp, rate limiting, path validation)

## Architecture

```
Client (web/mobile/desktop)
  │
  ├── HTTPS ──► apps/gateway/index.ts  (REST + GraphQL dispatch)
  │                ├── /api/v1/*        (REST route handlers)
  │                ├── /graphql         (GraphQL executor)
  │                ├── /health          (health check)
  │                └── /provision-db    (tenant provisioning)
  │
  └── Turso/libSQL (per-tenant SQLite database)
```

**Runtime:** Deno 2 (Supabase Edge Functions)
**Protocol split:** REST (`/api/v1/*`) for mutations and simple reads; GraphQL (`/graphql`) for read-only aggregation.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/v1/students` | List students |
| `POST` | `/api/v1/students` | Create student |
| `PATCH` | `/api/v1/students/:id` | Update student |
| `DELETE` | `/api/v1/students/:id` | Delete student (destructive) |
| `GET` | `/api/v1/attendance` | Get attendance records |
| `POST` | `/api/v1/attendance` | Mark attendance |
| `GET` | `/api/v1/ledger` | Get ledger entries |
| `POST` | `/api/v1/ledger/payment` | Record payment |
| `POST` | `/api/v1/ledger/invoice` | Create invoice |
| `POST` | `/api/v1/ledger/void` | Void entry |
| `GET` | `/api/v1/settings` | Get tutor settings |
| `PATCH` | `/api/v1/settings` | Update settings |
| `GET` | `/api/v1/analytics/dashboard` | Dashboard KPIs & analytics |
| `GET` | `/api/v1/notifications` | List notifications |
| `POST` | `/api/v1/notifications` | Create notification |
| `GET` | `/api/v1/sync` | Get sync outbox |
| `POST` | `/api/v1/sync` | Push sync outbox |
| `POST` | `/graphql` | GraphQL query endpoint |
| `POST` | `/api/v1/provision` | Provision new tenant DB |

## Directory Structure

```
apps/gateway/
├── index.ts              # Main entrypoint — CORS, auth, routing, caching
├── deno.json             # Deno workspace config
├── package.json          # Workspace package metadata
├── lib/                  # Shared library modules
│   ├── auth.ts           # JWT verification, tenant extraction
│   ├── cache.ts          # In-memory per-tenant response cache
│   ├── crypto.ts         # Encryption utilities
│   ├── db.ts             # Turso/libSQL client factory
│   ├── errors.ts         # Typed Result<T,E>, error responses
│   ├── log.ts            # Structured JSON logger
│   ├── schema.ts         # Idempotent DDL (CREATE TABLE IF NOT EXISTS)
│   └── security.ts       # Rate limiting, nonce, timestamp, path validation
├── routes/               # REST route handlers
│   ├── analytics.ts      # Dashboard analytics & KPIs
│   ├── attendance.ts     # Attendance CRUD + summary
│   ├── ledger.ts         # Ledger entries, payments, invoices, voids
│   ├── notifications.ts  # Notifications
│   ├── security.ts       # Erase, audit log
│   ├── settings.ts       # Tutor settings
│   ├── students.ts       # Student CRUD
│   └── sync.ts           # Sync outbox
├── graphql/              # GraphQL gateway
│   ├── index.ts          # GraphQL entrypoint (standalone Deno.serve)
│   ├── executor.ts       # Query executor
│   ├── resolvers.ts      # Read-only Query resolvers
│   └── schema.ts         # GraphQL type definitions
├── provision/            # Tenant provisioning
│   ├── index.ts          # provision-db entrypoint
│   └── deno.json         # Provision-specific Deno config
├── migrations/           # SQL migrations (canonical DDL)
│   ├── 0001_init.sql     # Initial schema
│   └── 0002_add_palette.sql
├── __tests__/            # Test suite (134+ tests)
└── .env                  # Local environment variables (git-ignored)
```

## Local Development

### Prerequisites
- [Deno](https://deno.land/) v2+
- `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` env vars (for deploy)

### Run locally
```bash
cd apps/gateway
deno run -A index.ts
```

### Lint
```bash
deno lint
```

### Run tests
```bash
deno test --allow-all __tests__/
```

## Deployment

Deployed via Supabase CLI or custom deploy script:

```bash
# Deploy all functions
supabase functions deploy gateway --project-ref <ref> --no-verify-jwt
supabase functions deploy gateway-graphql --project-ref <ref> --no-verify-jwt
supabase functions deploy provision-db --project-ref <ref> --no-verify-jwt
```

Or using the custom deploy script (if available):
```bash
deno run -A scripts/deploy.ts
```

### Supabase project
- **Project ref:** `gmqwdnvbfnwpzpctwvho`
- **Functions base URL:** `https://<ref>.supabase.co/functions/v1/`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Provision only | Service role key (provision-db only) |
| `DATABASE_URL` | Yes | Default Turso/libSQL database URL |
| `TURSO_TOKEN` | Yes | Default Turso auth token |
| `ALLOWED_ORIGIN` | No | CORS allowed origin (default: `https://buddysaradhi.app`) |
| `GATEWAY_ADMIN_TOKEN` | No | Admin token for provision endpoints |

## Security

- **JWT Authentication:** All requests require a valid Supabase JWT in the `Authorization` header.
- **Nonce validation:** Mutation requests must include `x-nonce` and `x-timestamp` headers.
- **Path validation:** Only whitelisted paths are accepted.
- **Rate limiting:** Failed auth attempts are tracked and temporarily locked.
- **Request body validation:** Mutation bodies are size-checked and sanitized.
- **Security headers:** HSTS, CSP, X-Frame-Options, etc. on every response.
- **Structured logging:** Every request emits `{event, durationMs, tenantId, path, status, cacheHit}`.

## Testing

The test suite covers:
- Student CRUD operations
- Attendance marking and summary
- Ledger entry posting and voiding
- Settings read/update
- Error handling and security checks
- Schema application
- Performance budgets

```bash
deno test --allow-all __tests__/
```

---

## See Also

- [Root README](../../README.md) — Monorepo overview and table of contents
- [Web App README](../web/README.md) — Next.js 16 frontend
- [AGENTS.md](../../AGENTS.md) — Master agent directive and coding rules
- [Spec: 17_API_Gateway_System.md](../../Buddysaradhi_Planning/17_API_Gateway_System.md) — Gateway architecture spec
- [Spec: deployment/06_Edge_Function_Hosting.md](../../Buddysaradhi_Planning/deployment/06_Edge_Function_Hosting.md) — Deployment recipe
