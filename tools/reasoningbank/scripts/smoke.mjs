// Smoke test: proves the isolated ReasoningBank store works END TO END.
//
// Implements: the isolation contract documented in ../package.json — this file
// must never make a network call. It supplies its own LOCAL embedder so the test
// needs no model download, no provider API key, and no outbound connection.
//
// IMPORTANT — this is written against agentdb@1.6.1's REAL API, not the shape
// the ReasoningBank skill documents. The skill describes the `agentic-flow`
// adapter (`createAgentDBAdapter`, `pattern_data`, `type`/`domain`); agentdb's own
// ReasoningBank controller uses a different, flatter schema. Verified by reading
// node_modules/agentdb/dist/controllers/ReasoningBank.js rather than by trial.
//
//   constructor(db, embedder)   embedder must expose .embed(text) -> Float32Array
//   storePattern({ taskType, approach, successRate, uses, avgReward, tags, metadata })
//   searchPatterns({ taskEmbedding, k, threshold, filters: { tags } })
//
// Run: npm run smoke   (from tools/reasoningbank)

import { ReasoningBank, createDatabase } from "agentdb";

const DIM = 128;

/**
 * Deterministic LOCAL embedding: a hashed bag of words into a fixed vector.
 * Deliberately not a semantic model and it does not pretend to be one — its only
 * job is to prove store -> persist -> retrieve works without leaving the machine.
 * Swap this for @xenova/transformers (already in the tree, still local) when
 * semantic similarity is actually needed; note that it downloads its model on
 * first use, which is a one-time network fetch, not a per-query one.
 */
function embed(text) {
  const v = new Float32Array(DIM);
  for (const word of String(text).toLowerCase().split(/\W+/).filter(Boolean)) {
    let h = 0;
    for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
    v[h % DIM] += 1;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);

const db = await createDatabase({ path: ":memory:" });
const rb = new ReasoningBank(db, { embed });
check("constructor(db, embedder)", !!rb, "schema initialised in constructor");

const patterns = [
  {
    taskType: "debugging",
    approach: "null deref in UserService: reproduce, guard the missing row, return 404",
    successRate: 1.0,
    uses: 1,
    avgReward: 1.0,
    tags: ["null-pointer", "guard"],
    metadata: { error_rate_before: 0.31, error_rate_after: 0.0, commit: "745bb80" },
  },
  {
    taskType: "testing",
    approach: "flaky suite under load: raise the per-test budget, keep every assertion intact, add no skip",
    successRate: 1.0,
    uses: 1,
    avgReward: 1.0,
    tags: ["flake", "timeout"],
    metadata: { flake_rate_before: 0.25, flake_rate_after: 0.0, commit: "745bb80" },
  },
];

const ids = [];
for (const p of patterns) ids.push(await rb.storePattern(p));
check("storePattern x2", ids.every((i) => Number.isInteger(i)), `row ids ${ids.join(", ")}`);

const hits = await rb.searchPatterns({
  taskEmbedding: embed("debugging null deref guard 404"),
  k: 5,
  threshold: 0,
  filters: { tags: [] },
});
check("searchPatterns returns rows", Array.isArray(hits) && hits.length > 0, `${hits.length} hit(s)`);

const top = hits?.[0];
// Field names here are camelCase (`taskType`), which is what the controller
// actually returns — verified against a live query, not assumed.
check(
  "top hit is the debugging pattern",
  top?.taskType === "debugging",
  `got taskType=${top?.taskType ?? "(none)"} similarity=${top?.similarity?.toFixed?.(3) ?? "n/a"}`,
);

// Two distinct retrieval properties, because conflating them hides a real bug:
//  1. PARAPHRASE ranks the right pattern first (lower similarity, still top hit).
//  2. EXACT query — the very string `storePattern` embeds, `${taskType}: ${approach}` —
//     scores ~1.0. Asserting ~1.0 on a paraphrase is wrong: this embedder is a
//     hashed bag of words, so a differently-worded query legitimately scores lower.
const exact = await rb.searchPatterns({
  taskEmbedding: embed("debugging: null deref in UserService: reproduce, guard the missing row, return 404"),
  k: 5,
  threshold: 0,
  filters: { tags: [] },
});
check(
  "exact `${taskType}: ${approach}` query scores ~1.0",
  typeof exact?.[0]?.similarity === "number" && exact[0].similarity > 0.99,
  `similarity=${exact?.[0]?.similarity?.toFixed?.(4)}`,
);

const stats = rb.getPatternStats();
check("getPatternStats", !!stats, JSON.stringify(stats).slice(0, 90));

const one = await rb.getPattern(ids[1]);
check(
  "getPattern round-trips metadata",
  !!one && JSON.stringify(one).includes("flake_rate_before"),
  one ? "payload intact" : "no row",
);

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);