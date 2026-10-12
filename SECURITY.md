# Security Policy

> This is the GitHub community-standard security policy for the Buddysaradhi
> monorepo. The normative in-repo security specification is `10_Security.md`
> and the cross-platform enforcement plan is `23_Security_Harness_Plan.md`.
> Where this file and those specs disagree, the specs win and this file is
> corrected.

## Supported Versions

Versions below were read directly from the `package.json` files in this
repository on 2026-10-12. Security fixes are provided only for the `main`
branch at `HEAD`.

| Component | Package | Version (verified) | Supported |
|---|---|---|---|
| Web app (Next.js 16, `apps/web`) | `web` | `1.0.0` | ✅ Supported — the only In-Flight platform |
| Edge gateway (Deno 2, `apps/gateway`) | `@buddysaradhi/gateway` | `1.0.0` | ✅ Supported — canonical backend for all platforms |
| Product page (`apps/product-page`) | `product-page` | `2.0.0` | ✅ Supported |
| Mobile (`apps/mobile`) | — | scaffold only, **LOCKED** | ❌ Not supported — no security fixes until `WEB-PROD-GATE` |
| Desktop (`apps/desktop`) | — | scaffold only, **LOCKED** | ❌ Not supported — no security fixes until `MOBILE-PROD-GATE` |

> **Unverifiable / not stated here:** whether any numbered release (e.g. `v1.0.0`
> tag) has been cut — no release tag was verified for this table. "Supported"
> therefore means "fixed on `main`", not "backported to a release line". There
> is no LTS line at the time of writing.

Supporting stack facts (verified from repo-root `package.json`): Node
`>= 22`, `pnpm@11.15.0`, Prisma `6.2.1`, `apps/web` on Next `16.2.12` /
React `19.2.4`, `apps/product-page` on Next `16.3.3`.

## Reporting a Vulnerability

**Do not open a public GitHub issue for a suspected vulnerability.**

Report it privately to the owner:

- **Contact (SECURITY-ONLY, placeholder — owner to fill in before
  publishing):** `[SECURITY-EMAIL-PLACEHOLDER — e.g. security@example.com]`
- **PGP (optional):** `[PGP-FINGERPRINT-PLACEHOLDER — optional; if the owner
  publishes a key, its fingerprint will appear here]`. Encryption is
  appreciated but not required.

### What to include

- A description of the vulnerability and its suspected impact (which tutor
  data, money, or credential is at risk).
- Steps to reproduce, ideally minimal (route, request shape, or screen flow).
- The commit SHA you tested against (`git rev-parse HEAD`) and which
  component is affected (`apps/web`, `apps/gateway`, `apps/product-page`).
- Whether the finding touches the ledger (`ledger_entries`), money math
  (paise), auth/PIN, crypto/backup envelope, or sync — these are the
  highest-blast-radius areas (see `AGENTS.md` §2) and help triage.
- Any logs or screenshots that do **not** contain real credentials or real
  tutor data.

### What NOT to do

- Do **not** exploit the vulnerability beyond what is necessary to demonstrate
  it. Do not read, modify, or delete another tutor's data.
- Do **not** run destructive actions (e.g. the secure-erase endpoint) against
  any deployment you do not own.
- Do **not** disclose the issue publicly — including in issues, PRs,
  discussions, or social media — until the maintainers have confirmed a fix
  and its rollout.
- Do **not** commit proof-of-concept credentials, tokens, or keys to the
  repository (even to demonstrate the finding). If you accidentally commit a
  secret, say so in your report so rotation can be scheduled — deletion alone
  does not un-leak it (`AGENTS.md` §9.1).

## Response SLAs (PROPOSED — not yet ratified)

> The windows below are **PROPOSED** by this policy and have **not** been
> ratified by the owner. They are targets, not commitments, until the owner
> approves them.

| Stage | Proposed window |
|---|---|
| Acknowledgement of your report | Within **2 business days** |
| Triage / confirmation (valid or not, severity assigned) | Within **7 calendar days** |
| Fix for a **Critical** finding (ledger integrity, RLS bypass, live credential, auth bypass) | Within **14 calendar days** of confirmation |
| Fix for **High / Medium / Low** findings | Next scheduled milestone, or within **30 / 60 / 90 calendar days** respectively |
| Public disclosure / advisory | After a fix is available and deployed; coordinated with the reporter |

If a report is accepted, you will be credited (or kept anonymous — your
choice) in the fix's changelog entry.

## Scope

### In scope

- **Web app** (`apps/web`) — the five screens (Dashboard, Students,
  Attendance, Fees & Payments, Settings), server actions, API routes, and the
  local-first SQLite/Prisma data layer.
- **Edge gateway** (`apps/gateway`, canonical name `@apps/gateway`) — REST
  (`/api/v1/*`), GraphQL (`/graphql`), provisioning, auth middleware,
  audited SQL builders, and the shared API contract (`contracts/openapi.yaml`).
- **Product page** (`apps/product-page`) — the public marketing surface, to
  the extent a finding there affects tutor data or credentials.
- **Shared packages** (`packages/core`, `packages/shared`, `packages/ui`,
  `packages/design-system`) — the ledger engine, Zod schemas/money utils,
  and shared components, insofar as they ship through an in-scope app.

### Explicitly OUT of scope

- **Mobile (`apps/mobile`) and desktop (`apps/desktop`) — LOCKED.**
  Per the `worklog.md` Current Platform State block and `AGENTS.md` §9.3 /
  `16_Platform_Delivery_Sequence.md` §7, exactly one platform is In-Flight
  (`WEB`); mobile and desktop scaffolds exist but **no edits are allowed
  until `WEB-PROD-GATE`** (mobile) and `MOBILE-PROD-GATE` (desktop)
  respectively. Vulnerability reports against these scaffolds will be logged
  and deferred — they are not actionable until their platform unlocks.
- **Third-party infrastructure** (Turso/libSQL control plane, Supabase
  control plane, Vercel, Cloudflare, GitHub Actions runners) — report those
  to the respective vendor; we will happily coordinate where our integration
  is involved.
- **Social engineering, physical attacks, and denial-of-service volume
  testing** against any live deployment.
- **Automated scanner output without a demonstrated impact** — a raw
  tool finding with no reproduction or blast-radius analysis will be closed
  as informational.

## Safe Harbor

> Standard GitHub safe-harbor wording:

We consider security research conducted in accordance with this policy to be
authorized. We will not pursue civil action against researchers who follow
this policy, and we will regard their activity as authorized under applicable
anti-hacking laws (such as the U.S. Computer Fraud and Abuse Act). If a third
party initiates legal action against you for activity conducted under this
policy, we will take steps to make it known that your actions were conducted
in compliance with this policy.

This protection applies only to activity that stays within the Scope above
and respects the "What NOT to do" rules — in particular, no data destruction,
no exfiltration of tutor data, no privilege escalation beyond demonstrating
the issue, and no public disclosure before a coordinated fix.

## Known issues awaiting rotation

> **Status: rotation pending owner action. Nothing in this section is fixed
> by code changes in this repo — only provider-side rotation retires these
> credentials.**

Full details: [`docs/security/credential-exposure-2026-10.md`](docs/security/credential-exposure-2026-10.md)
(verified against history at commit `773c0512`; companion runbook:
`docs/security/TURSO-ROTATION-RUNBOOK.md`).

- **Turso database auth tokens in git history (CRITICAL).** Four
  file-location findings of a live-format Turso JWT (EdDSA, read-write, no
  `exp`) — `scratch/test-turso-web.{ts,js}`, `supabase/functions/gateway/lib/db.ts`,
  `apps/gateway/lib/db.ts`. The exposure document further establishes these
  four findings are one distinct token value replicated across ~183 commits.
  History-only (absent from the current tree) — but history was pushed, so
  **rotation at Turso is the only remedy**.
- **Supabase `service_role` key in git history (CRITICAL).** A live
  `service_role` JWT (RLS-bypassing, `exp` 2036) committed in CI workflow
  files (`.github/workflows/{lint,test,web-prod-gate}.yml`). History-only at
  `HEAD` (workflows now read `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}`) —
  but **rotation in the Supabase project is the only remedy**.
- Also recorded in the same document (same rotation operation): the paired
  Supabase `anon` key (LOW, public by design — rotate alongside the
  `service_role` key) and a plaintext E2E account password with its email
  and production URL (HIGH — change the account password and audit what it
  can reach).

Until the owner confirms rotation, the gitleaks CI gate **deliberately stays
red on these historical findings** rather than allowlisting them — a green
tick over known live credentials would be a lie (see `.gitleaks.toml` and the
exposure document §3).

---

*Policy version: 1.0 (2026-10-12). Contact placeholders marked
`PLACEHOLDER` must be filled by the owner before this policy is published.
SLA windows marked `PROPOSED` require owner ratification.*
