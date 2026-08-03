# SaaS Tier Limits, Turso Optimizations, Hybrid SSR/CSR & Session Fingerprint Protection Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the multi-tier SaaS model with student and batch limits, enforce session-fingerprint binding for stolen cookie protection, optimize Turso DB connections, and resolve TypeScript/Path errors.

**Architecture:** Enforce limits and session binding at the Hono gateway layer. Manage subscription tier in database settings. Optimize database connection lifecycle. Hybrid client-side and server-side components.

**Tech Stack:** Hono, Next.js, Prisma, SQLite, Zod, Redis, Vitest.

## Global Constraints
* Free version limit of 60 students, 3 batches.
* Growth version limit of 300 students, 10 batches. Price: ₹499/mo.
* Institute version limit of unlimited students, unlimited batches. Price: ₹1,499/mo.
* Bind session token to request's IP and User-Agent signature.
* Mostly Server-Side Rendering (SSR), Client-Side (CSR) for interactive triggers.

---

### Task 1: Fix TypeScript Compile Issues & Module Resolution
**Files:**
- Modify: `apps/web/src/components/settings/profile-section.tsx:14-85`
- Modify: `apps/gateway/src/routes/students.ts:1-10`

- [ ] **Step 1: Fix HNSW imports in gateway route**
  Adjust the imports of `HNSWIndex` and `pseudoEmbed` in `apps/gateway/src/routes/students.ts` to `../../../../reference-implementations/vector-search/hnsw` and `../../../../reference-implementations/vector-search/embedder`.
- [ ] **Step 2: Cast defaultValues and Schema in ProfileSection**
  Cast `currencyCode` and `plan` default values inside `ProfileSection` in `profile-section.tsx` to exactly match their Zod enum types to resolve `SubmitHandler` compatibility.
- [ ] **Step 3: Run typescript compiler check**
  Execute `pnpm --filter web typecheck` and ensure it runs with 0 errors.

### Task 2: Implement SaaS Multi-Tier Limit Verification
**Files:**
- Modify: `apps/gateway/src/routes/students.ts:153-170`
- Modify: `apps/gateway/src/routes/batches.ts` (if exists, or inside gateway route setup)

- [ ] **Step 1: Check student limit in gateway POST handler**
  Confirm the gateway count validation throws `403` when adding students beyond the plan limit.
- [ ] **Step 2: Add batch count validation in POST batches handler**
  Add validation to reject batch creation if active batches exceed the plan limit (3 for free, 10 for growth).

### Task 3: Enforce Session Fingerprint Protection (Hijack Mitigation)
**Files:**
- Modify: `apps/gateway/src/index.ts` (or auth middleware)

- [ ] **Step 1: Store client IP and User-Agent on login**
  In the session registration handler, store the hashed `IP` and `User-Agent` in Redis session metadata.
- [ ] **Step 2: Add session fingerprint verification middleware**
  In the gateway request verification middleware, match the current request IP and User-Agent with the session. Reject if mismatched.
- [ ] **Step 3: Add integration test for stolen cookie protection**
  Write an E2E test verifying a stolen cookie cannot be used from a different IP.
