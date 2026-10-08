# Supabase

- **Docs:** https://supabase.com/docs/guides/auth/server-side/nextjs (cookie-based SSR clients) · `getClaims` reference: https://supabase.com/docs/reference/javascript/auth-getclaims
- **Pinned:** `@supabase/supabase-js@^2.110.8` (root) / `^2.110.0` (`apps/web`, resolves **2.110.5**) · `@supabase/ssr@^0.12.0` → **0.12.3** · `argon2@^0.45.1` (PIN KDF)
- **Sites:** `@supabase/ssr` at 4 files, `user_metadata` at 21 sites

## Project specifics

### `middleware.ts` is `proxy.ts` here — Next 16 renamed it

Supabase's own SSR guide calls this out and it matters: on Next 15 and earlier a `middleware.ts` is never called by the renamed hook, so **sessions silently never refresh and users get signed out**. Our session-refresh code lives in `apps/web/src/proxy.ts`. Any auth pattern copied from an older tutorial lands dead in this repo.

### Two clients, and the browser one is the ONLY singleton

The official pattern is: a request-scoped **server** client (Server Components, Server Actions, Route Handlers) and a **browser** client built with `createBrowserClient`, which is internally a singleton. Creating a new server client per request is correct and cheap — it is configuring a `fetch` with that request's cookies.

The mistake this repo already made once: refreshing tokens in **two** places. A refresh token can generally be used once; presenting a reused one outside Supabase's narrow grace window **revokes the entire session**. The symptom is users being signed out at random with no error in your code. Refresh in the proxy, once.

### `getClaims()`, not `getSession()`, guards pages and data

`getSession()` reads the session out of the cookie **without revalidating it**. Anyone can forge the session cookie, so trusting it lets an attacker render another user's page. `getClaims()` verifies the token signature on every call. This is the rule for every guard in this repo.

### `user_metadata` is where the tenant DB lives

`db_url` / `db_token` are written onto the Supabase user by the provisioning route and read back on every request — 21 sites, including the session-refresh path (`lib/supabase/middleware.ts`), `server/get-db.ts`, `server/actions/signout.ts`, and `api/v1/[...slug]/route.ts`. See [libsql.md](libsql.md) for the rule and the hardcoded-fallback P0 that came from ignoring it.

`user_metadata` also carries `active_session_id` (single-active-session enforcement, 10_Security.md) and `provisioned_at`.

### `AUTH_REQUIRED` / `UNAUTHENTICATED` are typed refusals, not exceptions to swallow

A server action that refuses resolves as a **typed refusal**. One bug cost real time here: `getSettings` resolved an `AUTH_REQUIRED` refusal as a *successful* query carrying `{success:false}`, and `SettingsClient` rendered `<ErrorState>` in place of the whole nav rail and content pane. Since every settings write invalidates `['settings']`, one flaky background refetch **unmounted the subtree under the pointer** — it looked like a render loop and was measured as not one (0 body mutations over 45s).

The fix was a monotonic `hasRealSettings` latch: a first-load failure still shows `ErrorState` behind `Retry`; a background failure can no longer blink the screen away. Discriminator worth remembering: **every failing test WRITES settings, every passing one is read-only.**

Relatedly, the React Query retry policy opts out immediately on `error.message === "UNAUTHENTICATED"` — see [tanstack-react-query.md](tanstack-react-query.md).

### PIN hashing is `argon2`, not bcrypt, and the ladder is fail-closed

`argon2@^0.45.1` with Argon2id (m=64MiB, t=3, p=2 for PIN; p=4 for backup passphrase). `lib/crypto.ts` **throws at module load** when `GATEWAY_SHARED_SECRET` is absent — which is why the Vitest config stubs it. Fail-closed is AGENTS.md §2 Rule 9 + BR-SEC-03.

## Related

- [deno.md](deno.md) — the gateway behind the BFF.
- [libsql.md](libsql.md) — the tenant credentials that come out of `user_metadata`.