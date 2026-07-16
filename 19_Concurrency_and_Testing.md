# 19 — Concurrency & Testing

> Two intertwined disciplines that the user named explicitly: *"ensure multithreading for that and test coverage for that."* This file defines (a) the **concurrency model** for the gateway and every service — how cores are saturated, how CPU-bound work is isolated, how races are prevented — and (b) the **test coverage matrix** — what must be tested, on which platform, at what floor, with which tooling, and the concurrency tests that prove the multithreading claims hold under load. Like `18_Microservice_Architecture.md`, this is a Web-phase activity (`16_Platform_Delivery_Sequence.md` §10.1 step 5); a platform cannot clear its Production Gate (G3) without the floors here being green.

---

## 0. The Two Problems This File Solves

1. **"Ensure multithreading."** A Node/Bun JavaScript process is single-threaded by default. Left alone, one CPU-heavy PDF render stalls every concurrent request. The fix is not "rewrite in Rust" — it is a disciplined combination of (a) process-level parallelism (N gateway workers, one per core), (b) thread-level parallelism (`worker_threads` for CPU-bound service work), and (c) event-loop hygiene (never block the main thread on crypto/IO). This file specifies exactly which service uses which, and the tests that prove it.
2. **"Test coverage for that."** Coverage as a single percentage is a vanity metric. What matters is *what* is covered: the ledger invariants at 100% line + 100% branch, the UI at 80%, the glue at 60%. This file defines a **targeted coverage matrix** — per module, per platform — plus the concurrency and contract tests that a line-coverage number can never capture.

---

## 1. Concurrency Model (the whole system on one page)

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                        CONCURRENCY TOPOLOGY                              │
 └──────────────────────────────────────────────────────────────────────────┘

                        ┌──────────────────────┐
                        │   Caddy (goroutines) │  TLS + HTTP/2 multiplex
                        │   one goroutine/req  │  (Rust-threaded under the hood)
                        └──────────┬───────────┘
                                   │ reverse-proxy
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
   ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐  ... N = CPU cores
   │ gw worker 1 │  │ gw worker 2 │  │ gw worker N │   (Bun, one process/core)
   │ (Bun, 1 thr)│  │ (Bun, 1 thr)│  │ (Bun, 1 thr)│   no shared mutable state
   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   except read-only JWKS
          │  route to services (XTransformPort, internal)
          ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                       SERVICE MESH (localhost)                       │
   │                                                                     │
   │  ledger-svc    student-svc   attendance-svc   sync-svc    (1 proc ea)│
   │  (Bun, 1 thr)  (Bun, 1 thr)  (Bun, 1 thr)    (Bun, 1 thr)           │
   │                                                                     │
   │  report-svc    ──▶  worker_threads pool (PDF/charts, CPU-bound)      │
   │  (Bun main)         ┌──┐┌──┐┌──┐┌──┐   size = min(4, cores-1)       │
   │                     │w1││w2││w3││w4│   main thread returns 202+jobURL│
   │                     └──┘└──┘└──┘└──┘                                  │
   │                                                                     │
   │  notification-svc (Bun, 1 thr) — scheduled tick every 60s            │
   │  auth-svc         (Bun, 1 thr)                                       │
   │                                                                     │
   │  event-bus     ──▶  NATS (Rust, fully multithreaded) OR             │
   │                     Bun WS fan-out (1 proc, event-loop)              │
   └─────────────────────────────────────────────────────────────────────┘
```

### 1.1 Why This Shape

- **Process-level parallelism (gateway workers):** Bun is single-threaded per process. To use all cores, run N Bun workers (N = core count) behind Caddy. Each is fully isolated — they share nothing mutable (JWKS + contract are read-mostly, refreshed on a timer). This is cheaper and safer than `worker_threads` for the I/O-bound gateway, because processes can't share a corrupted heap.
- **Thread-level parallelism (report-svc):** Where a single request is CPU-bound (PDF), the service's main thread offloads to a `worker_threads` pool. The main thread stays responsive (it just enqueues + polls); the worker does the heavy loop. This is the one place threads are mandatory — a PDF render on the main thread would stall every other report request.
- **Event-loop hygiene (every service):** No service may call a synchronous crypto/FS/compression routine on its main thread. AES-256-GCM (backup envelope), zstd, sha256-of-large-blob all run in `worker_threads` or via the async native APIs. A `eslint-plugin-no-sync` rule fails the build on `cryptoSync`, `fsSync`, `gzipSync` in a request path.
- **The genuinely multithreaded component:** the event-bus. If NATS, it's Rust-native multithreaded. If the Bun fallback, it's single-threaded but I/O-only (fan-out), so it's fine.

### 1.2 The Three Concurrency Rules (CI-enforced)

| # | Rule | Enforcement |
|---|---|---|
| C1 | **No synchronous blocking call in a request path.** No `fsSync`, `cryptoSync`, `gzipSync`, `bcryptSync`, `Atomics.wait` on the main thread. | ESLint `no-sync` + custom rule; fails the build. |
| C2 | **CPU-bound work (>5 ms estimate) goes to `worker_threads`.** PDF render, chart raster, backup encrypt, CSV of >10k rows. | Code review + the concurrency load test (§3) flags any request with >50 ms event-loop stall. |
| C3 | **No shared mutable state across processes.** Gateway workers share only read-only caches (JWKS, contract). Writes go through the DB or the bus. | Architectural review; a `shared-state-detector` lint flags module-level `let`/`var` in service code (only `const` + immutable refs allowed at module scope). |

---

## 2. Test Pyramid (per platform)

```
   ┌─────────────────────────────────────────────────────────────────┐
   │                    E2E  (few, golden-path)                      │  ← Playwright / Detox / Tauri-e2e
   ├─────────────────────────────────────────────────────────────────┤
   │              INTEGRATION  (more, contract + service)            │  ← contract tests, svc-to-svc
   ├─────────────────────────────────────────────────────────────────┤
   │            COMPONENT  (most, per-module isolated)               │  ← Vitest / Jest, RTL
   ├─────────────────────────────────────────────────────────────────┤
   │                UNIT  (foundational, pure logic)                 │  ← ledger math, calc utils
   ├─────────────────────────────────────────────────────────────────┤
   │        PROPERTY  (invariants, fuzzed inputs)                    │  ← fast-check, ledger invariants
   └─────────────────────────────────────────────────────────────────┘
```

### 2.1 Coverage Floors (per platform, per module-type)

| Module type | Web | Mobile | Desktop | Tool |
|---|---|---|---|---|
| `packages/core` (ledger engine) | **100% line / 100% branch** | 100% / 100% | 100% / 100% | Vitest + fast-check |
| `packages/shared` (Zod + calc) | 95% / 90% | 95% / 90% | 95% / 90% | Vitest |
| Service request handlers | 90% / 85% | — | — | Vitest + supertest |
| Service concurrency paths | 100% (race tests) | — | — | Vitest + `tinybench` |
| UI components (`packages/ui`) | 85% / 80% | 80% / 75% | 80% / 75% | Vitest + RTL / RNTL |
| Screen routes | 80% / 75% | 75% / 70% | 75% / 70% | Vitest + RTL |
| **Platform overall floor (G3)** | **80%** | **75%** | **70%** | c8 / istanbul |

The ledger at 100% is non-negotiable — it's the spine (`AGENTS.md` §7.2 "never mock the ledger"). The overall floor is a *minimum*; the targeted floors above it are what actually matter. A platform at 82% overall but with the ledger at 70% **fails** G3.

### 2.2 The Never-Mock-the-Ledger Rule (extends `AGENTS.md` §7.3)

Any test that exercises the ledger uses a real in-memory SQLite (`:memory:`) with the real migrations applied — never a mock. A mocked ledger test passes while the real ledger burns money. CI rejects PRs that `vi.mock('packages/core/ledger')` outside of explicitly-allowlisted UI-storybook tests.

---

## 3. Concurrency Test Harness

This is the "ensure multithreading … test coverage for that" half. Three layers:

### 3.1 Layer A — Event-loop stall detector (per service)

Every service runs a background timer that measures event-loop lag every 50 ms. Under the load test (§3.2), the max lag must stay < 50 ms p99. A lag spike means a synchronous block snuck in (C1/C2 violation). The test fails loudly.

```
   service under load (autocannon, 200 RPS for 60s)
     │
     ├─ request latency p99 < 100 ms         ✅
     ├─ event-loop lag p99 < 50 ms            ✅  (the multithreading proof)
     ├─ error rate < 0.1%                     ✅
     └─ no "MaxListenersExceeded" / unhandled rejection  ✅
```

### 3.2 Layer B — Load profiles (per service, via autocannon/k6)

| Service | Profile | Assert |
|---|---|---|
| gateway | 500 RPS mixed, 60 s | p99 < 150 ms, 0 errors, all 6 services routed |
| ledger-svc | 200 RPS postEntry + 400 RPS balance read, 60 s | p99 < 80 ms; integer-paise invariant holds (post-test reconciliation = 0) |
| student-svc | 300 RPS list + 100 RPS get, 60 s | p99 < 60 ms; cache hit-rate > 70% after warmup |
| sync-svc | 500 concurrent WebSocket, 10 msgs/sec each, 5 min | 0 drops; outbox drains within 1 s; no memory growth > 50 MB |
| report-svc | 20 concurrent PDF renders (each ~2 s CPU) | main-thread latency p99 < 30 ms (it's just enqueueing); all 20 complete < 8 s |
| notification-svc | schedule 10k reminders, tick processes 1k/s | drain < 12 s; no duplicate deliveries |
| event-bus | 10k msg/sec fan-out to 3 subscribers | p99 fan-out < 5 ms; 0 lost |

### 3.3 Layer C — Race condition tests (the ledger spine)

The ledger is the one place a race is catastrophic (double-spend, lost reversal). Property-based + explicit race tests:

| Test | What it proves |
|---|---|
| `ledger.concurrent-postEntry.test.ts` | 1000 concurrent `postEntry` on the same tutor → sum of balances == sum of entry amounts, exactly. No lost write. |
| `ledger.concurrent-void.test.ts` | An entry voided while being read 1000× → the reversal is atomic; no reader sees a half-voided state. |
| `ledger.secure-erase-under-load.test.ts` | `secureErase` while 100 concurrent reads → either the read sees pre-erase data or gets `409`, never a partial set. |
| `ledger.property.balances.test.ts` (fast-check) | For any sequence of postEntry/voidEntry: `sum(balances) == sum(posted) - sum(voided)`, integer paise, always. |
| `ledger.property.append-only.test.ts` (fast-check) | No operation ever produces an `UPDATE` or `DELETE` on a `ledger_entries` row (except secure-erase, which is gated). |
| `sync.conflict-resolution.test.ts` | Two clients push the same `updatedAt` row → LWW picks one deterministically; ledger entries never conflict (append-only). |

These run on every PR and nightly. A flaky race test is a P0 — it indicates a real race, not a test problem. Race tests are never `skip`ped.

---

## 4. Contract Tests (the gateway + SDK seam)

Because `17_API_Gateway_System.md` makes the contract the source of truth, the contract test is the most important integration test. Two directions:

### 4.1 Provider-side (gateway honours the contract)

`contracts/openapi.json` is loaded; for every operation, a contract test sends a valid request and asserts the response matches the schema — and sends deliberately-invalid requests and asserts a `400 contract_violation`. This runs against the live gateway on every PR. If a service drifts from the contract, stage 8 (response-shape validation) catches it; the contract test catches it again in CI.

### 4.2 Consumer-side (the SDK matches the contract)

The generated `packages/shared/sdk` is tested against the same `openapi.json` — every SDK function's request shape matches an operation, every response type matches a schema. A regenerated SDK that drifts from the contract fails CI. This is what guarantees a client "literally cannot construct an out-of-contract request" (`17_API_Gateway_System.md` §2).

### 4.3 Cross-platform contract parity

One test suite, run in three contexts:

```
   contracts/openapi.json
        │
        ├──▶ web contract test      (Vitest, calls gateway via SDK)
        ├──▶ mobile contract test   (Jest, calls gateway via the SAME SDK)
        └──▶ desktop contract test  (Vitest in Tauri, calls gateway via SAME SDK)

   all three must pass against contracts/v1.0.0 (the pinned tag).
   a contract change that passes web but fails mobile = the contract broke mobile →
   major version bump, mobile stays on v1.0.0 until it migrates.
```

This is the mechanical guarantee behind `16_Platform_Delivery_Sequence.md` G2 (contract-frozen): the three platforms literally share one test suite, so a break is immediately visible.

---

## 5. Per-Platform E2E (the golden path)

Each platform has exactly **one** golden-path e2e — the canonical user flow. It is the G4 "real-env verified" evidence.

| Platform | Tool | Golden path |
|---|---|---|
| Web | Playwright | signup (OTP) → land on /dashboard → create student → mark attendance → record fee → view ledger → sticky-footer check on short + long page |
| Mobile | Detox (iOS + Android) | login → Dashboard → create student → mark attendance (haptic) → record fee → offline 30 s → reconnect → sync green → ledger intact |
| Desktop | Tauri WebDriver + Playwright | login → Dashboard → create student → record fee → trigger secure-erase → confirm DB empty → updater check (install v1.0.1 patch) |

The e2e suite runs on every PR (web) and nightly (mobile/desktop, because of device/build cost). A flaky e2e is a P1.

---

## 6. The Coverage Gate in CI

```
   PR opened
     │
     ├─ lint (ESLint, incl. no-sync, no-hardcoded-ingress, no-parallel-platform)
     ├─ typecheck (tsc --noEmit)
     ├─ unit + property (Vitest, c8 coverage)
     │     └─ FAIL if packages/core < 100% line OR platform overall < floor
     ├─ integration (contract tests, svc-to-svc)
     ├─ concurrency (autocannon profiles, race tests)  [nightly, on PR if ledger touched]
     ├─ e2e golden path (Playwright)  [on PR for web]
     └─ security lint (10_Security.md §18)
            └─ FAIL if any high/critical finding

   all green ─▶ mergeable
```

Coverage is reported as a diff-comment: `packages/core 100.0% (floor 100%) ✅ · web overall 82.1% (floor 80%) ✅ · ledger races 12/12 ✅`. A drop below a floor blocks merge.

---

## 7. What Is NOT Tested (Anti-Patterns)

| Anti-pattern | Why forbidden |
|---|---|
| Mocking the ledger in a balance test | `AGENTS.md` §7.3; the real ledger is the only honest oracle |
| Skipping a race test because it's "flaky" | Flaky race = real race; fix the race, not the test |
| Coverage chasing (writing tests to hit lines, not behaviours) | A 90% suite that doesn't test the invariants is worse than a 70% suite that does |
| E2E for every screen | E2E is expensive + brittle; one golden path per platform; the rest is component/integration |
| Load-testing in a unit-test loop | Load tests need a real process + real sockets; keep them in the concurrency harness, not Vitest |
| Testing only the happy path | Every operation must have a `400/401/403/409/429/503` test; the error contract (`17_API_Gateway_System.md` §8) is part of the contract |

---

## 8. Implementation Order (within Web phase, `16_Platform_Delivery_Sequence.md` §10.1 step 5)

```
   CONCURRENCY + TESTING BUILD-OUT (part of P1: WEB IN-FLIGHT):

   1. Add the lints: no-sync, no-hardcoded-ingress, no-parallel-platform, shared-state-detector
   2. Stand up the Vitest + c8 harness; set the floors; wire to CI
   3. Write the ledger property + race tests (fast-check)  ← the spine, first
   4. Write the contract tests (provider + consumer) against contracts/v1.0.0
   5. Stand up the autocannon/k6 concurrency harness; add the per-service profiles
   6. Wire the event-loop stall detector into every service
   7. Write the Playwright golden path
   8. Hit the Web floor (80% overall, 100% ledger); concurrency profiles green
   ─── G3 of the Web Production Gate clears; web continues to W5–W7 ───
```

---

## 9. Cross-References

- `16_Platform_Delivery_Sequence.md` G3 (quality bar) — the floors here are G3.
- `17_API_Gateway_System.md` §2 (contract) + §7 (concurrency summary) + §8 (error contract) — the contract tests prove these.
- `18_Microservice_Architecture.md` §8 (concurrency model per service) — the load profiles here verify it.
- `10_Security.md` §18 (security lint) — runs in the same CI gate, §6.
- `12_Business_Rules.md` §3 (ledger invariants) — the property tests encode these.
- `AGENTS.md` §7 (testing conventions), §7.3 (never mock the ledger) — this file specialises them.
- **`21_Automation_Testing.md`** — the companion surface-testing spec. This file (19) covers the **spine**: unit, property, concurrency, contract, coverage floors. `21` covers the **surface**: E2E automation (36 flows across web/app/desktop/product), visual regression, a11y, performance, and the AI bug-resolution loop. §5's golden-path E2E is expanded by `21` §4 (12+8+6+10 flows). No overlap — the two files are complementary.
- **`22_Redundancy_Audit.md`** §5 — if this file and `21` appear to disagree on E2E scope, `22` §5 (precedence) rules: 19 defines the coverage *floors*, 21 defines the *flows* that prove them.

---

## 10. ASCII Mockup Suite (§20 Compliance)

### 10.1 The Coverage Comment (what CI posts on a PR)

```
╔══════════════════════════════════════════════════════════════════════╗
║  Coverage Report — PR #142                                            ║
╠══════════════════════════════════════════════════════════════════════╣
║  packages/core   (ledger)   100.0% line / 100.0% branch   ✅ floor 100║
║  packages/shared (zod/calc)  96.4% / 91.2%                ✅ floor 95 ║
║  service handlers           91.8% / 86.5%                ✅ floor 90 ║
║  UI components              85.7% / 80.3%                ✅ floor 85 ║
║  web overall                82.1%                        ✅ floor 80 ║
║                                                                      ║
║  Concurrency:                                                        ║
║    ledger races        12 / 12   ✅                                   ║
║    event-loop lag p99  38 ms     ✅ (< 50)                           ║
║    gateway 500 RPS     0 errors  ✅                                   ║
║                                                                      ║
║  Contract:  provider 48/48 ✅   consumer 48/48 ✅                     ║
║  E2E:       golden path ✅                                            ║
║  Security:  0 high / 0 critical ✅                                    ║
║                                                                      ║
║  G3 QUALITY BAR: ✅ CLEAR                                            ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 10.2 The Event-Loop Stall Detector (what "multithreading proof" looks like)

```
   report-svc under load (20 concurrent PDFs, 60s)

   latency (main thread, enqueues only):
   ┌─────────────────────────────────────────────┐
   │ p50   4 ms   ████████                        │
   │ p90   9 ms   ███████████                     │
   │ p99  27 ms   ████████████████                │  ✅ < 100 ms
   │ max  41 ms   ██████████████████              │
   └─────────────────────────────────────────────┘

   event-loop lag (the multithreading proof):
   ┌─────────────────────────────────────────────┐
   │ p50  2 ms   ██                               │
   │ p90  6 ms   ███                              │
   │ p99 18 ms   █████                            │  ✅ < 50 ms  (C1/C2 hold)
   │ max 31 ms   ███████                          │
   └─────────────────────────────────────────────┘

   worker pool (the actual CPU work):
   ┌─────────────────────────────────────────────┐
   │ w1 busy 92%  ┃ PDF renders: 184              │
   │ w2 busy 89%  ┃ PDF renders: 178              │
   │ w3 busy 91%  ┃ PDF renders: 181              │
   │ w4 busy 88%  ┃ PDF renders: 176              │  ← all 4 cores used
   └─────────────────────────────────────────────┘

   verdict: main thread never stalled; CPU work saturated the pool. ✅
```

### 10.3 The Race Test (what "concurrent postEntry" proves)

```
   ledger.concurrent-postEntry.test.ts

   setup:  1 tutor, 0 balance
   action: 1000 concurrent postEntry({ amount: 100 paise })  // Promise.all
   expect: balance == 100 * 1000 == 100000 paise   (exactly)

   run 1: 100000  ✅
   run 2: 100000  ✅
   run 3: 100000  ✅
   ...
   run 100 (fast-check shrink): 100000  ✅

   property (fast-check, 1000 arbitrary sequences of postEntry/voidEntry):
     ∀ seq: sum(balances) == sum(posted) - sum(voided)   ✅
     ∀ seq: no UPDATE/DELETE on ledger_entries (except secure-erase)  ✅

   verdict: the ledger is race-safe under the concurrency model. ✅
```
