# ReasoningBank (isolated dev tooling)

An adaptive-learning vector store for **agent trajectories** — the patterns that
worked, so the next session can recall them instead of rediscovering them.

**This is development tooling. It is not part of Buddysaradhi.** Nothing in
`apps/web`, `apps/gateway`, `packages/*` or any product bundle imports it, and no
tutor data ever reaches it.

---

## The isolation contract

This package sits **outside** the pnpm workspace. `pnpm-workspace.yaml` lists only:

```
apps/*  ·  apps/services/*  ·  apps/gateway  ·  packages/*
```

`tools/` is not a member, so this tree has its own `package.json` and its own
lockfile. Verified after install: the root `pnpm-lock.yaml` hash was **byte-identical**
before and after, and `git status` showed **zero** dirty files outside `tools/`.

| Guarantee | How it is held |
|---|---|
| Rule 2 — no network calls that process user data | Embeddings are **local**. `scripts/smoke.mjs` supplies its own deterministic embedder and makes no outbound request. |
| Rule 3 — no telemetry / analytics SDK | Nothing here phones home. |
| Rule 11 — one directory, one deployment target | Nothing here is deployed. |
| Never in a product bundle | Outside the workspace; no workspace package depends on it. |
| Never committed | `node_modules/`, `.agentdb/` and `*.db` are git-ignored. |

## Why agentdb is pinned to exactly 1.6.1

`agentic-flow@2.1.4` declares `agentdb` as an **exact** pin on `3.0.0-alpha.20` —
no caret, no range. Installing `agentic-flow` therefore forces the alpha, and that
tree drags in:

```
express · gun · axios · http-proxy-middleware · @supabase/supabase-js
@anthropic-ai/sdk · @anthropic-ai/claude-agent-sdk · @google/genai
```

Two HTTP servers, an HTTP proxy, and three external AI-API clients — the exact
shape `AGENTS.md` Rules 2 and 3 forbid, in a repo that carefully scopes Supabase
credentials. Overriding back to `1.6.1` under `agentic-flow` would be a **two-major
jump across an alpha API**, which is the class of change that appears to work and
fails silently later. Rejected.

`agentdb@1.6.1` is 1.5 MB and depends on `zod · chalk · sql.js · commander ·
hnswlib-node · @xenova/transformers · @modelcontextprotocol/sdk`. No servers, no
external AI SDKs.

**And it was not a downgrade in capability.** agentdb@1.6.1 ships `ReasoningBank`
natively — so nothing from `agentic-flow` was ever needed. Verified exports:

```
ReasoningBank · HNSWIndex · WASMVectorSearch · EmbeddingService
ContextSynthesizer · MMRDiversityRanker · ExplainableRecall · ReflexionMemory
SkillLibrary · LearningSystem · CausalMemoryGraph · CausalRecall · NightlyLearner
```

Trajectory storage, verdict retrieval, context synthesis, diversity ranking and
memory optimisation are all present.

## The API is not what the skill documents

The ReasoningBank skill describes the `agentic-flow` adapter
(`createAgentDBAdapter`, `pattern_data`, `type`/`domain`, `retrieveWithReasoning`).
agentdb's own controller uses a flatter schema. **Use the source, not the docs** —
this was read from `node_modules/agentdb/dist/controllers/ReasoningBank.js`:

```js
const db = await createDatabase({ path: ":memory:" });      // returns a Promise
const rb = new ReasoningBank(db, { embed });                 // embedder needs .embed(text)

// storePattern embeds `${taskType}: ${approach}` for you
await rb.storePattern({
  taskType: "debugging",
  approach: "null deref in UserService: reproduce, guard the missing row, 404",
  successRate: 1.0, uses: 1, avgReward: 1.0,
  tags: ["null-pointer"], metadata: { commit: "745bb80" },
});

// searchPatterns returns camelCase fields and a `similarity`
const hits = await rb.searchPatterns({
  taskEmbedding: embed("debugging null deref 404"),
  k: 5, threshold: 0, filters: { tags: [] },
});
```

## Local embeddings

`scripts/smoke.mjs` uses a deterministic hashed bag-of-words into a 128-dim vector.
It is **not** a semantic model and does not pretend to be one — its only job is to
prove store → persist → retrieve works with no network and no API key.

For real semantic similarity, `@xenova/transformers` is already in the tree and
runs **locally**. Note it downloads its model once on first use — a one-time
fetch, not a per-query one. Pre-cache the model to make the first run offline.

## Verify it

```bash
cd tools/reasoningbank
npm run smoke     # 7/7 — store, retrieve, rank, stats, round-trip
```

The smoke test asserts two *separate* retrieval properties on purpose:

1. a **paraphrase** query ranks the right pattern first (similarity ~0.72)
2. an **exact** `${taskType}: ${approach}` query scores ~1.0

Asserting ~1.0 on a paraphrase is wrong for a hashed bag-of-words embedder, and
collapsing the two would hide that.

## Install note

npm blocks native build scripts by default. `hnswlib-node`, `better-sqlite3`,
`sharp` and `protobufjs` need approving or the vector index silently fails to
load — `agentdb` throws `this.db.exec is not a function` at import. If you see
that, the build scripts were blocked:

```bash
npm install-scripts approve hnswlib-node better-sqlite3 sharp protobufjs
npm rebuild hnswlib-node sharp
```

## Review status

Added under `AGENTS.md` §18.3(g) — a new dependency is a documented stop-and-ask.
This install was reviewed and approved for **isolated, dev-only, local-embedding**
use. It inherits the supply-chain review tracked in `.planning/ROADMAP.md` Phase 2
alongside CI action pinning and credential hygiene.

**Not approved for:** use inside any workspace package, any hosted embedding
provider, or anything that ships.