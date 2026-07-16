# gateway-graphql

A **GraphQL gateway** for BuddySaradhi, deployed as a Supabase Edge Function
(Deno). It complements the existing REST gateway in `supabase/functions/gateway`
and exposes the data-heavy, paginated read queries that GraphQL is well suited to.

## Why this exists

The REST gateway (`functions/gateway`) serves the transactional, write-heavy
routes (`POST /api/v1/ledger`, attendance marking, settings PATCH, etc.).
The GraphQL gateway serves the **data-heavy list/detail reads** — paginated
students, invoices, and ledger entries — letting web/mobile/desktop clients fetch
exactly the fields they need in one round trip. Per the lead's directive:
"use GraphQL for the gateway and microservices for data-heavy queries."

Both gateways share the **same** auth model and the **same** Postgres tables
(`students`, `invoices`, `ledger_entries`, `settings`). Neither invents a new
DB layer — both use `@supabase/supabase-js@2` with the service-role key.

## Endpoint

```
POST/GET https://<project>.supabase.co/functions/v1/gateway-graphql
```

GraphiQL is available at that URL via a `GET` (handy for manual testing). The
function normalizes the request path to `/` internally so graphql-yoga's endpoint
match succeeds regardless of the deployed path.

## Auth

Identical to the REST gateway:

1. Send the Supabase user JWT in the header:
   `Authorization: Bearer <JWT>`
2. The function calls `supabase.auth.getUser(token)` to verify the JWT.
3. The verified user id becomes the `tenant_id`. **Every query is scoped to
   `tenant_id = <jwt sub>`** — the `tenantId` argument in each query is
   validated to equal the JWT subject and rejected (`forbidden`) otherwise. This
   is defense-in-depth: clients cannot read another tenant's rows even if they
   tamper with the argument.

Required env vars (auto-injected by Supabase for Edge Functions):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Schema summary

```graphql
type Query {
  health: String!
  settings(tenantId: ID!): Setting
  students(tenantId: ID!, search: String, page: Int, pageSize: Int): StudentPage!
  invoices(tenantId: ID!, status: String, page: Int, pageSize: Int): InvoicePage!
  ledgerEntries(tenantId: ID!, page: Int, pageSize: Int): LedgerPage!
}
```

- `StudentPage` / `InvoicePage` / `LedgerPage` each return
  `{ items: [...], total, page, pageSize }`.
- `page` defaults to `1`, `pageSize` defaults to `50`, capped at `200`.
- `students` supports an `ilike` `search` over `first_name`, `last_name`, `code`
  (same semantics as the REST gateway).
- `invoices` supports an optional `status` filter (e.g. `"unpaid"`, `"paid"`).

All monetary amounts are returned as **integer minor units (paise)**, consistent
with the rest of the system. Field names are camelCase (e.g. `balancePaise`);
the resolver maps them from the snake_case DB columns.

### Security note

`Setting` intentionally **omits** `tenantSecret`, `pinHash`, and
`backupPassphraseHash`. Secrets are never serialized over GraphQL.

## Example query

```graphql
query {
  students(tenantId: "user-uuid", search: "an", page: 1, pageSize: 20) {
    total
    items { id name grade balancePaise status }
  }
}
```

## Implementation notes

- Server: **graphql-yoga v5** (`createSchema` + `createYoga`), invoked via
  `export default { fetch: yoga.fetch }` (Deno/Workers style).
- DB client: `@supabase/supabase-js@2` `createClient` — **same as the REST
  gateway**. No new ORM, no generated Prisma client in Deno.
- CORS: mirrors the request `Origin` header so the web/mobile/desktop clients can
  call it cross-origin; `OPTIONS` preflight is handled.
- Errors are surfaced as GraphQL errors; failures are logged via `console.error`
  with the message only (no PII).

## Deployment

Deployment is handled by the lead via the Supabase MCP tooling. It is currently
**blocked by an MCP project-ref mismatch** (the MCP client's project ref does not
match this Supabase project), so do not attempt a deploy from this environment.

When unblocked, deploy with:

```bash
supabase functions deploy gateway-graphql --no-verify-jwt
```

`--no-verify-jwt` is required because the function performs its **own** JWT
verification via `supabase.auth.getUser` (same as the REST gateway) and must
receive the raw bearer token.

The function depends only on `https://esm.sh/@supabase/supabase-js@2` and
`https://esm.sh/graphql-yoga@5`, declared in `deno.json` (Deno 2 runtime).
