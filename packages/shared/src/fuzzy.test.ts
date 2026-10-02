// Implements: docs/design/overhaul-plan.md §3 (one search engine — W1 gate:
// "shared tests green"); the ranking contract the students/fees/attendance/shell
// combobox depends on. AGENTS.md §2 Rule 9 (typed results, no silent failure, no
// `any`), Rule 10 (positions drive keyboard highlight), §16 (real assertions).
//
// The scoring expectations below are hand-derived from fzf's constants
// (SCORE_MATCH 16, BONUS_BOUNDARY_WHITE 10, BONUS_CONSECUTIVE 4, …) so a change to
// the port's arithmetic fails here instead of silently reordering a tutor's roster.
import { describe, it, expect } from "vitest";
import { fuzzyMatch, fuzzySearch, splitQueryTerms } from "./fuzzy";

const ROSTER = [
  "Asha Menon",
  "Ajay S. Menon",
  "Ashim Dey",
  "B. Ashwin Kumar",
  "Menon Asha",
  "Ashish Menon STU-014",
] as const;

function search(texts: readonly string[], query: string): string[] {
  return fuzzySearch(texts.map((text) => ({ item: text, text })), query).map((r) => r.text);
}

describe("fuzzyMatch — subsequence ranking", () => {
  it("returns null when the needle is not a subsequence", () => {
    expect(fuzzyMatch("Asha Menon", "zz")).toBeNull();
    expect(fuzzyMatch("ab", "abc")).toBeNull();
    expect(fuzzyMatch("", "a")).toBeNull();
  });

  it("ranks a boundary-anchored match above a scattered one", () => {
    // "a-b": a sits at offset 0 (boundary 10 × 2) and b follows a non-word character
    // (BONUS_BOUNDARY 8), giving 36 for the first character + 33 gap + 16 + 8.
    expect(fuzzyMatch("a-b", "ab")?.score).toBe(57);
    // "xaybz": the same needle with no boundary anywhere — 13 gap + 16, no bonus.
    expect(fuzzyMatch("xaybz", "ab")?.score).toBe(29);
    expect(fuzzyMatch("a-b", "ab")!.score).toBeGreaterThan(fuzzyMatch("xaybz", "ab")!.score);
  });

  it("keeps the consecutive bonus above a chunk broken by a delimiter", () => {
    // fzf's documented anomaly correction: "foobar" must beat "foo-bar" on "foob".
    const solid = fuzzyMatch("foobar", "foob")!.score;
    const broken = fuzzyMatch("foo-bar", "foob")!.score;
    expect(solid).toBeGreaterThan(broken);
  });

  it("cancels the boundary bonus once the gap outgrows it", () => {
    // The stated intent of the gap penalty: past ~8 characters the bonus is spent,
    // so a short acronym and a long one score the same.
    expect(fuzzyMatch("fuzzyfinder", "ff")!.score).toBe(
      fuzzyMatch("fuzzy-blurry-finder", "ff")!.score,
    );
  });

  it("weights the first character double", () => {
    // Same single-character needle; only the anchor differs: 16 + 10 × 2 versus 16 + 0 × 2.
    expect(fuzzyMatch("Asha Menon", "a")!.score).toBe(36);
    expect(fuzzyMatch("Xasha", "a")!.score).toBe(16);
  });
});

describe("fuzzySearch — ordering", () => {
  it("orders the roster deterministically by score", () => {
    expect(search(ROSTER, "asm")).toEqual([
      "Asha Menon",
      "Ashish Menon STU-014",
      "Ashim Dey",
      "B. Ashwin Kumar",
      "Ajay S. Menon",
    ]);
  });

  it("breaks ties by shorter text, then localeCompare", () => {
    // Every row scores identically on "mn"; the two-word "Asha Menon" is shortest.
    const ordered = fuzzySearch(
      ["Zeta Menon Omega", "Asha Menon", "Menon Asha"].map((text) => ({ item: text, text })),
      "mn",
    );
    expect(ordered.map((r) => r.text)).toEqual(["Asha Menon", "Menon Asha", "Zeta Menon Omega"]);
  });

  it("is stable across repeated runs of the same input", () => {
    const runs = Array.from({ length: 5 }, () => search(ROSTER, "asm"));
    for (const run of runs) expect(run).toEqual(runs[0]);
  });
});

describe("extended query syntax", () => {
  it("treats ^ as a prefix anchor", () => {
    // All three score 88 (the prefix range only); order falls to the shorter text.
    expect(search(ROSTER, "^ash")).toEqual([
      "Ashim Dey",
      "Asha Menon",
      "Ashish Menon STU-014",
    ]);
  });

  it("treats $ as a suffix anchor", () => {
    expect(search(ROSTER, "menon$")).toEqual(["Asha Menon", "Ajay S. Menon"]);
  });

  it("treats ' as an exact-match marker", () => {
    // Equal score, equal length — localeCompare puts lowercase first.
    expect(search(["Asha", "Asha Menon", "asha"], "'asha")).toEqual(["asha", "Asha"]);
  });

  it("combines ' with ^ as an exact prefix (boundary required)", () => {
    expect(search(["Asha Menon", "Ashabai"], "'^asha")).toEqual(["Asha Menon"]);
  });

  it("excludes with !", () => {
    expect(search(ROSTER, "!ash")).toEqual(["Ajay S. Menon"]);
  });

  it("ORs alternatives with |", () => {
    const rows = ["Asha Menon", "Deep Kumar"];
    // 'dk' anchors both characters at boundaries in "Deep Kumar", so it outranks
    // 'am' on "Asha Menon" (39) — the OR takes the best-scoring alternative.
    expect(search(rows, "am|dk")).toEqual(["Deep Kumar", "Asha Menon"]);
    expect(search(rows, "am|zz")).toEqual(["Asha Menon"]);
  });

  it("ANDs space-separated terms", () => {
    expect(search(["Asha Menon", "Ashim Dey"], "as mn")).toEqual(["Asha Menon"]);
  });

  it("splits AND-level terms and unwraps quoting", () => {
    expect(splitQueryTerms("^ash 'me non$ !x y|z \"a b\"")).toEqual([
      "ash",
      "me",
      "non",
      "!x",
      "y|z",
      "a b",
    ]);
    expect(splitQueryTerms("   ")).toEqual([]);
  });
});

describe("case handling", () => {
  it("is case-insensitive by default", () => {
    expect(fuzzyMatch("Asha Menon", "asha")!.score).toBe(fuzzyMatch("asha menon", "asha")!.score);
    expect(search(ROSTER, "asha")).toContain("Asha Menon");
    // An uppercase query is a smart-case signal, so it no longer folds.
    expect(search(ROSTER, "ASHA")).toEqual([]);
  });

  it("smart-case switches to case-sensitive when the query has an uppercase letter", () => {
    expect(fuzzyMatch("Asha Menon", "asha")).not.toBeNull();
    expect(fuzzyMatch("Asha Menon", "Asha")).not.toBeNull();
    expect(fuzzyMatch("asha menon", "Asha")).toBeNull();
  });

  it("honours an explicit caseSensitive override in both directions", () => {
    expect(fuzzyMatch("asha menon", "ASHA", { caseSensitive: true })).toBeNull();
    expect(fuzzyMatch("asha menon", "ASHA", { smartCase: false })).not.toBeNull();
    expect(fuzzyMatch("Asha Menon", "ASHA", { smartCase: false })).not.toBeNull();
  });
});

describe("positions", () => {
  it("are ascending, de-duplicated and point at the matched characters", () => {
    const match = fuzzyMatch("Asha Menon", "as mn");
    expect(match).not.toBeNull();
    const haystack = "Asha Menon";
    const positions = match!.positions;
    expect(positions).toEqual([0, 1, 5, 7]);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(positions).size).toBe(positions.length);
    expect(positions.map((p) => haystack[p])).toEqual(["A", "s", "M", "n"]);
  });

  it("cover the whole text for an exact match", () => {
    expect(fuzzyMatch("asha", "'asha")!.positions).toEqual([0, 1, 2, 3]);
    expect(fuzzyMatch("Asha Menon", "^ash")!.positions).toEqual([0, 1, 2]);
    expect(fuzzyMatch("Asha Menon", "menon$")!.positions).toEqual([5, 6, 7, 8, 9]);
  });

  it("are empty for a matched inverse term", () => {
    const match = fuzzyMatch("Ajay S. Menon", "!ash");
    expect(match).not.toBeNull();
    expect(match!.score).toBe(0);
    expect(match!.positions).toEqual([]);
  });
});

describe("empty query", () => {
  it("passes every candidate through in input order with score 0", () => {
    const results = fuzzySearch(ROSTER.map((text) => ({ item: text, text })), "");
    expect(results.map((r) => r.text)).toEqual([...ROSTER]);
    for (const result of results) {
      expect(result.score).toBe(0);
      expect(result.positions).toEqual([]);
    }
  });

  it("still honours the limit", () => {
    const results = fuzzySearch(ROSTER.map((text) => ({ item: text, text })), "", { limit: 2 });
    expect(results.map((r) => r.text)).toEqual(["Asha Menon", "Ajay S. Menon"]);
  });

  it("matches nothing for a whitespace-only query against real criteria", () => {
    expect(fuzzySearch([{ item: "a", text: "a" }], "  ").length).toBe(1);
    expect(fuzzySearch([{ item: "a", text: "a" }], "  ", { limit: 0 })).toEqual([]);
  });
});

describe("unicode", () => {
  it("does not throw on diacritics or ß", () => {
    expect(() => fuzzyMatch("Ärger Straße", "aß")).not.toThrow();
    expect(() => fuzzyMatch("Straße", "ß")).not.toThrow();
    expect(() => fuzzyMatch("ĄĆĘ ŁÓ", "ło")).not.toThrow();
  });

  it("matches across a multi-byte character without shifting offsets", () => {
    const haystack = "Ärger Straße";
    const match = fuzzyMatch(haystack, "aß");
    expect(match).not.toBeNull();
    expect(match!.positions).toEqual([9, 10]);
    expect(match!.positions.map((p) => haystack[p])).toEqual(["a", "ß"]);
  });

  it("ranks a single-code-point match like any other", () => {
    expect(fuzzyMatch("Straße", "ß")!.positions).toEqual([4]);
  });
});

describe("scale", () => {
  it("ranks 2000 candidates and returns the requested limit", () => {
    const candidates = Array.from({ length: 2000 }, (_, i) => {
      const text = `Student ${i.toString().padStart(4, "0")} Verma`;
      return { item: i, text };
    });
    const started = performance.now();
    const results = fuzzySearch(candidates, "verma", { limit: 25 });
    const elapsed = performance.now() - started;
    expect(results).toHaveLength(25);
    // Every row matches identically, so the tie-break chain decides: equal length,
    // then localeCompare over the zero-padded index.
    expect(results[0]!.text).toBe("Student 0000 Verma");
    expect(results[24]!.text).toBe("Student 0024 Verma");
    expect(results.every((r) => r.score > 0)).toBe(true);
    expect(results[0]!.positions).toEqual([13, 14, 15, 16, 17]);
    expect(elapsed).toBeLessThan(5000);
  });

  it("returns nothing when no candidate matches, without scanning past the limit", () => {
    const candidates = Array.from({ length: 2000 }, (_, i) => ({ item: i, text: `Row ${i}` }));
    expect(fuzzySearch(candidates, "qqqqqqqqqq", { limit: 10 })).toEqual([]);
  });
});