# SaaS Tier Limits, Turso Optimizations, Hybrid SSR/CSR & Session Hijacking Mitigation Design Spec

This specification governs the implementation of the multi-tier SaaS model, session hijacking protection, Turso database optimization, and SSR/CSR rendering model for BuddySaradhi.

---

## 1. SaaS Tiers and Limits

The subscription tier is stored in the `plan` field of the `Setting` model:

* **`"free"`**:
  * Max Students: 60
  * Max Batches: 3
  * Features: Standard SQL search, basic reports.
* **`"growth"`**:
  * Max Students: 300
  * Max Batches: 10
  * Features: HNSW vector search, automated reminders, multi-device sync.
  * Price: ₹499/mo
* **`"institute"`**:
  * Max Students: Unlimited
  * Max Batches: Unlimited
  * Features: Advanced reports, multi-tutor roles, priority sync.
  * Price: ₹1,499/mo

---

## 2. Gateway Enforcement (Limits & Session Binding)

### 2.1 Limit Enforcement
All mutations checks occur in-process in the gateway (`apps/gateway/src/routes/`):
* `POST /api/v1/students`: Verify total active student count under the tenant's current plan.
* `POST /api/v1/batches`: Verify total active batch count under the tenant's current plan.

### 2.2 Session Binding (Stolen Cookie Protection)
When a session is established, the gateway binds the session token to the client's `IP` and `User-Agent` signature.
On every request:
1. Extract current request `Client-IP` (via `X-Forwarded-For` or connection info) and `User-Agent`.
2. Compare with session values cached in Redis under `session:${token}:meta`.
3. If they do not match, destroy the session (delete from Redis) and return `401 Unauthorized` (hijack detected).

---

## 3. Turso Database Optimization

* **Pooled Connection Reuse**: Retain and reuse libSQL driver clients in an LRU cache inside the gateway.
* **Scoped Tokens**: Issue token sessions that expire in 1 hour.
* **Batch Transactions**: Bundle multiple queries into a single database transaction `db.$transaction` to reduce round-trip load on the server.

---

## 4. SSR / CSR Hybrid Rendering

* **Server-Side Rendered (SSR)**: Standard Next.js server actions handle initial data fetch and render key lists.
* **Client-Side Components (CSR)**: Interactive forms, sheets, attendance triggers, and command palettes use client-side hydration for responsive, glassmorphic UI interactions.

---

## 5. Testing & Verification

* **Unit Tests**: Assert that the limit check throws a `403` status when the student count exceeds the plan limits.
* **Integration Tests**: Verify session hijacking mitigation by simulating a request with a stolen cookie from a mismatched IP.
