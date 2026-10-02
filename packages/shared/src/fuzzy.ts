// Implements: docs/design/overhaul-plan.md §3 "One search, local only" — a single
// fzf-style ranking engine for every surface. Principle: P5 (offline-first — ranking
// never leaves the client). Rules: AGENTS.md §2 Rule 2 (no network while typing — this
// module has no I/O of any kind), Rule 9 (typed results, no silent failure, no `any`),
// Rule 10 (the UI highlights via the returned positions), §3.4 (no DB access here —
// candidates arrive as plain strings).
//
// ALGORITHM — a TypeScript port of `junegunn/fzf`'s `FuzzyMatchV2`
// (https://raw.githubusercontent.com/junegunn/fzf/master/src/algo/algo.go), the
// Smith-Waterman-style dynamic program with fzf's positional bonuses. The scoring
// constants below are transcribed from that file's `const` block, not approximated:
//
//   scoreMatch = 16, scoreGapStart = -3, scoreGapExtension = -1
//   bonusBoundary = scoreMatch / 2                =  8
//   bonusNonWord = scoreMatch / 2                 =  8
//   bonusCamel123 = bonusBoundary + scoreGapExtension = 7
//   bonusConsecutive = -(scoreGapStart + scoreGapExtension) = 4
//   bonusFirstCharMultiplier = 2
//   bonusBoundaryWhite    = bonusBoundary + 2     = 10   (default scheme)
//   bonusBoundaryDelimiter = bonusBoundary + 1    =  9   (default scheme)
//
// The "consecutive decay" fzf applies is the same line in every path that continues a
// chunk: the bonus of a continuing character is raised to
// max(its own bonus, bonusConsecutive, the bonus at the chunk's first character), and a
// chunk is broken (consecutive reset to 1) when the new character carries a strictly
// larger boundary bonus than the chunk head. fzf's `FuzzyMatchV2` returns
// `Result{Start, End, Score}` plus an optional `[]int` of matched character offsets when
// `withPos` is set; this module returns `{ score, positions }` with the same
// positions semantics, expressed as offsets into the haystack.
//
// Deltas from the Go original, all deliberate and behaviour-preserving for the shapes
// this engine handles:
//   * no fast paths for 1- and 2-character patterns (the prefilter below already makes
//     the non-matching majority cheap, and one code path cannot drift from the other);
//   * work is in Unicode code points with per-code-point case folding (Go's
//     `unicode.ToLower`), so a fold that changes length (e.g. U+0130) leaves the text
//     untouched and never shifts an index;
//   * the DP window is narrowed to [firstIdx, maxIdx) exactly as fzf's phase 1 does,
//     and positions are translated back to haystack code-point indices, then to
//     code-unit offsets for the UI.
// Extended query syntax (`^prefix`, `suffix$`, `'exact`, `'boundary'`, `!inverse`,
// `a|b` OR, space = AND, `"quoted"` groups) follows fzf's documented search-syntax table.

/** A scored match. `positions` are ascending, de-duplicated HAYSTACK offsets. */
export interface FuzzyMatch {
  score: number;
  positions: number[];
}

export interface FuzzyOptions {
  /** Forces an outcome regardless of `smartCase`. */
  caseSensitive?: boolean;
  /**
   * fzf's smart-case (default `true`): case-insensitive unless the query itself
   * contains an uppercase character.
   */
  smartCase?: boolean;
  /** Caps the number of returned candidates. Non-positive means "none". */
  limit?: number;
}

/** A candidate that matched, carrying the score and the highlight positions. */
export interface FuzzyCandidate<T> {
  item: T;
  text: string;
  score: number;
  positions: number[];
}

// --- fzf scoring constants (src/algo/algo.go) -------------------------------

const SCORE_MATCH = 16;
const SCORE_GAP_START = -3;
const SCORE_GAP_EXTENSION = -1;
const BONUS_BOUNDARY = SCORE_MATCH / 2; // 8
const BONUS_NON_WORD = SCORE_MATCH / 2; // 8
const BONUS_CAMEL123 = BONUS_BOUNDARY + SCORE_GAP_EXTENSION; // 7
const BONUS_CONSECUTIVE = -(SCORE_GAP_START + SCORE_GAP_EXTENSION); // 4
const BONUS_FIRST_CHAR_MULTIPLIER = 2;
const BONUS_BOUNDARY_WHITE = BONUS_BOUNDARY + 2; // 10
const BONUS_BOUNDARY_DELIMITER = BONUS_BOUNDARY + 1; // 9

// --- fzf character classes (src/algo/algo.go) -------------------------------

const CHAR_WHITE = 0;
const CHAR_NON_WORD = 1;
const CHAR_DELIMITER = 2;
const CHAR_LOWER = 3;
const CHAR_UPPER = 4;
const CHAR_LETTER = 5;
const CHAR_NUMBER = 6;
const CHAR_CLASS_COUNT = 7;

/** fzf's `initialCharClass`: position 0 reads as "after whitespace". */
const INITIAL_CHAR_CLASS = CHAR_WHITE;

const WHITE_CHARS = new Set([" ", "\t", "\n", "\v", "\f", "\r", "\u0085", "\u00a0"]);
const DELIMITER_CHARS = new Set([..."/,:;|"]);
const WHITE_REGEX = /\s/u;
const LOWER_REGEX = /\p{Ll}/u;
const UPPER_REGEX = /\p{Lu}/u;
const LETTER_REGEX = /\p{L}/u;
const NUMBER_REGEX = /\p{N}/u;

const asciiCharClass: Uint8Array = (() => {
  const table = new Uint8Array(128).fill(CHAR_NON_WORD);
  for (let cp = 0; cp < 128; cp++) {
    const ch = String.fromCharCode(cp);
    if (ch >= "a" && ch <= "z") table[cp] = CHAR_LOWER;
    else if (ch >= "A" && ch <= "Z") table[cp] = CHAR_UPPER;
    else if (ch >= "0" && ch <= "9") table[cp] = CHAR_NUMBER;
    else if (WHITE_CHARS.has(ch)) table[cp] = CHAR_WHITE;
    else if (DELIMITER_CHARS.has(ch)) table[cp] = CHAR_DELIMITER;
  }
  return table;
})();

// Non-ASCII classification needs four Unicode property escapes; a code point only
// ever needs classifying once per process, so the answers are memoised.
const nonAsciiCharClass = new Map<number, number>();

function charClassOfNonAscii(cp: number): number {
  const cached = nonAsciiCharClass.get(cp);
  if (cached !== undefined) return cached;
  const ch = String.fromCodePoint(cp);
  let cls: number;
  if (LOWER_REGEX.test(ch)) cls = CHAR_LOWER;
  else if (UPPER_REGEX.test(ch)) cls = CHAR_UPPER;
  else if (NUMBER_REGEX.test(ch)) cls = CHAR_NUMBER;
  else if (LETTER_REGEX.test(ch)) cls = CHAR_LETTER;
  else if (WHITE_REGEX.test(ch)) cls = CHAR_WHITE;
  else if (DELIMITER_CHARS.has(ch)) cls = CHAR_DELIMITER;
  else cls = CHAR_NON_WORD;
  nonAsciiCharClass.set(cp, cls);
  return cls;
}

function charClassOf(ch: string): number {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return CHAR_NON_WORD;
  return cp < 128 ? asciiCharClass[cp] : charClassOfNonAscii(cp);
}

/**
 * fzf's `bonusFor`, precomputed as the 7×7 class-pair matrix it is always read
 * through. The chain is fzf's, in fzf's order: a boundary bonus when the current
 * class is a word-ish class, then the edge-triggered camelCase / letter+digit bonus,
 * then the non-word and whitespace defaults.
 */
const bonusMatrix: Int16Array = (() => {
  const matrix = new Int16Array(CHAR_CLASS_COUNT * CHAR_CLASS_COUNT);
  for (let prev = 0; prev < CHAR_CLASS_COUNT; prev++) {
    for (let cls = 0; cls < CHAR_CLASS_COUNT; cls++) {
      let bonus = 0;
      let resolved = false;
      if (cls >= CHAR_NON_WORD) {
        if (prev === CHAR_WHITE) {
          bonus = BONUS_BOUNDARY_WHITE;
          resolved = true;
        } else if (prev === CHAR_DELIMITER) {
          bonus = BONUS_BOUNDARY_DELIMITER;
          resolved = true;
        } else if (prev === CHAR_NON_WORD) {
          bonus = BONUS_BOUNDARY;
          resolved = true;
        }
      }
      if (!resolved && (prev === CHAR_LOWER && cls === CHAR_UPPER || (prev !== CHAR_NUMBER && cls === CHAR_NUMBER))) {
        bonus = BONUS_CAMEL123;
        resolved = true;
      }
      if (!resolved && (cls === CHAR_NON_WORD || cls === CHAR_DELIMITER)) {
        bonus = BONUS_NON_WORD;
        resolved = true;
      }
      if (!resolved && cls === CHAR_WHITE) {
        bonus = BONUS_BOUNDARY_WHITE;
        resolved = true;
      }
      matrix[prev * CHAR_CLASS_COUNT + cls] = bonus;
    }
  }
  return matrix;
})();

function bonusFor(prevClass: number, cls: number): number {
  return bonusMatrix[prevClass * CHAR_CLASS_COUNT + cls];
}

// --- text preparation -------------------------------------------------------

/**
 * Per-code-point lowercase that never changes length. `String.prototype.toLowerCase`
 * can expand (U+0130 → "i̇"), which would desynchronise every offset recorded so
 * far; such a code point keeps its original form instead — the same conservative
 * choice Go's per-rune `unicode.ToLower` makes for the indexing.
 */
function lowerPoint(ch: string): string {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return ch;
  if (cp >= 65 && cp <= 90) return String.fromCharCode(cp + 32);
  const folded = ch.toLowerCase();
  return folded.length === 1 ? folded : ch;
}

interface Prepared {
  /** Code points of the haystack, in order. */
  points: string[];
  /** `points` folded for comparison (identical to `points` when case-sensitive). */
  keys: string[];
  /** Haystack class per code point, used for the bonus matrix. */
  classes: Int16Array;
  /** Code-unit offset of each code point; `null` for pure-ASCII (offsets are identity). */
  offsets: number[] | null;
}

function prepare(text: string, caseSensitive: boolean): Prepared {
  const points = Array.from(text);
  const keys = new Array<string>(points.length);
  const classes = new Int16Array(points.length);
  let ascii = true;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point.length > 1) ascii = false;
    classes[i] = charClassOf(point);
    keys[i] = caseSensitive ? point : lowerPoint(point);
  }
  if (ascii) return { points, keys, classes, offsets: null };
  const offsets: number[] = new Array<number>(points.length);
  let cursor = 0;
  for (let i = 0; i < points.length; i++) {
    offsets[i] = cursor;
    cursor += (points[i]).length;
  }
  return { points, keys, classes, offsets };
}

function toCodeUnitOffset(prepared: Prepared, pointIndex: number): number {
  if (prepared.offsets === null) return pointIndex;
  return prepared.offsets[pointIndex];
}

function sortUniqueAscending(values: number[]): number[] {
  if (values.length < 2) return values;
  values.sort((a, b) => a - b);
  let write = 1;
  for (let read = 1; read < values.length; read++) {
    if (values[read] === values[write - 1]) continue;
    values[write] = values[read];
    write++;
  }
  values.length = write;
  return values;
}

// --- extended query syntax --------------------------------------------------

interface Variant {
  /** `'foo` — the term must equal the haystack. */
  exact: boolean;
  /** `^foo` — the haystack must start with the term. */
  prefix: boolean;
  /** `foo$` — the haystack must end with the term. */
  suffix: boolean;
  text: string;
}

interface Term {
  /** `!foo` — the term excludes instead of requiring. */
  inverse: boolean;
  variants: Variant[];
}

/**
 * A parsed term with each variant's text already folded into comparison keys. The
 * syntax markers (`^`, `$`, `'`, `!`, `|`) live in the flags, never in the keys, so a
 * compiled variant can be matched against any haystack without re-parsing.
 */
interface CompiledVariant {
  exact: boolean;
  prefix: boolean;
  suffix: boolean;
  keys: string[];
}

interface CompiledTerm {
  inverse: boolean;
  variants: CompiledVariant[];
}

const QUERY_WHITESPACE = new Set([" ", "\t", "\n", "\v", "\f", "\r"]);

function emptyVariant(): Variant {
  return { exact: false, prefix: false, suffix: false, text: "" };
}

function parseQuery(query: string): Term[] {
  const terms: Term[] = [];
  let variants: Variant[] = [];
  let inverse = false;
  let variant = emptyVariant();
  let body = "";
  let hasContent = false;
  let inQuote = false;

  const endVariant = (): void => {
    if (!hasContent) {
      variant = emptyVariant();
      return;
    }
    variants.push({ ...variant, text: body });
    variant = emptyVariant();
    body = "";
    hasContent = false;
  };

  const endTerm = (): void => {
    endVariant();
    if (variants.length > 0) terms.push({ inverse, variants });
    variants = [];
    inverse = false;
  };

  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (inQuote) {
      if (ch === '"') inQuote = false;
      else {
        body += ch;
        hasContent = true;
      }
      continue;
    }
    if (ch === '"') {
      inQuote = true;
      continue;
    }
    if (QUERY_WHITESPACE.has(ch)) {
      endTerm();
      continue;
    }
    if (ch === "|") {
      // OR between the alternatives of the term being built; the `!` flag covers
      // the whole term in fzf, so it survives the switch.
      endVariant();
      continue;
    }
    if (body.length === 0) {
      if (ch === "!") {
        inverse = true;
        continue;
      }
      if (ch === "'") {
        variant.exact = true;
        continue;
      }
      if (ch === "^") {
        variant.prefix = true;
        continue;
      }
    }
    if (ch === "$") {
      variant.suffix = true;
      continue;
    }
    body += ch;
    hasContent = true;
  }
  endTerm();
  return terms;
}

/**
 * The AND-level terms of a query, with quoting unwrapped and the syntax markers
 * (`!`, `'`, `^`, `$`) stripped from their edges. `|` alternatives stay joined inside
 * one entry because they share a term's flags and score.
 */
export function splitQueryTerms(query: string): string[] {
  return parseQuery(query).map((term) => {
    const negation = term.inverse ? "!" : "";
    return `${negation}${term.variants.map((v) => v.text).join("|")}`;
  });
}

/** Folds each variant's text into comparison keys once per query, not per candidate. */
function compileQuery(query: string, caseSensitive: boolean): CompiledTerm[] {
  return parseQuery(query).map((term) => ({
    inverse: term.inverse,
    variants: term.variants.map((variant) => ({
      exact: variant.exact,
      prefix: variant.prefix,
      suffix: variant.suffix,
      keys: prepareNeedle(variant.text, caseSensitive),
    })),
  }));
}

// --- matchers ---------------------------------------------------------------

/** fzf's `calculateScore` over a known matching range — used by exact/prefix/suffix. */
function scoreRange(
  hay: Prepared,
  needleKeys: string[],
  start: number,
  end: number,
): FuzzyMatch | null {
  let pidx = 0;
  let score = 0;
  let inGap = false;
  let consecutive = 0;
  let firstBonus = 0;
  const positions: number[] = [];
  let prevClass = start > 0 ? (hay.classes[start - 1]) : INITIAL_CHAR_CLASS;

  for (let idx = start; idx < end; idx++) {
    const cls = hay.classes[idx];
    if (pidx < needleKeys.length && hay.keys[idx] === needleKeys[pidx]) {
      positions.push(toCodeUnitOffset(hay, idx));
      score += SCORE_MATCH;
      let bonus = bonusFor(prevClass, cls);
      if (consecutive === 0) {
        firstBonus = bonus;
      } else {
        if (bonus >= BONUS_BOUNDARY && bonus > firstBonus) firstBonus = bonus;
        bonus = Math.max(bonus, firstBonus, BONUS_CONSECUTIVE);
      }
      score += pidx === 0 ? bonus * BONUS_FIRST_CHAR_MULTIPLIER : bonus;
      inGap = false;
      consecutive++;
      pidx++;
    } else {
      score += inGap ? SCORE_GAP_EXTENSION : SCORE_GAP_START;
      inGap = true;
      consecutive = 0;
      firstBonus = 0;
    }
    prevClass = cls;
  }
  if (pidx !== needleKeys.length) return null;
  return { score, positions };
}

function isBoundaryClass(cls: number): boolean {
  return cls <= CHAR_DELIMITER;
}

/**
 * fzf's `EqualMatch` score: a flat per-character award plus the boundary bonus of the
 * first and last characters, so an equal match can outrank a longer fuzzy one.
 */
function equalMatchScore(length: number): number {
  return (SCORE_MATCH + BONUS_BOUNDARY_WHITE) * length +
    (BONUS_FIRST_CHAR_MULTIPLIER - 1) * BONUS_BOUNDARY_WHITE;
}

function trimmedBounds(hay: Prepared): { start: number; end: number } {
  let start = 0;
  let end = hay.keys.length;
  while (start < end && hay.classes[start] === CHAR_WHITE) start++;
  while (end > start && hay.classes[end - 1] === CHAR_WHITE) end--;
  return { start, end };
}

/**
 * fzf's `FuzzyMatchV2`: phases 1–4 over the narrowed window.
 * Returns `null` when the needle is not a subsequence of the haystack.
 */
function fuzzyV2(hay: Prepared, needleKeys: string[]): FuzzyMatch | null {
  const n = hay.keys.length;
  const m = needleKeys.length;
  if (m === 0) return { score: 0, positions: [] };
  if (m > n) return null;

  // Phase 1 — locate the first occurrence of each needle character. This doubles as
  // the reject-or-accept prefilter: a needle that is not a subsequence never reaches
  // the O(n·m) matrix, which is what keeps a 2000-candidate sweep cheap.
  let firstIdx = 0;
  let lastIdx = -1;
  let cursor = 0;
  for (let p = 0; p < m; p++) {
    const key = needleKeys[p];
    let found = -1;
    for (let i = cursor; i < n; i++) {
      if (hay.keys[i] === key) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    if (p === 0 && found > 0) firstIdx = found - 1;
    lastIdx = found;
    cursor = found + 1;
  }
  const lastKey = needleKeys[m - 1];
  let maxIdx = lastIdx + 1;
  for (let i = lastIdx + 1; i < n; i++) {
    if (hay.keys[i] === lastKey) maxIdx = i + 1;
  }
  const width = maxIdx - firstIdx;
  const bonus = new Int16Array(width);
  const row0H = new Int16Array(width);
  const row0C = new Int16Array(width);
  const firstOccurrence = new Int32Array(m);

  // Phase 2 — bonus per position, first occurrence per needle character, and row 0.
  let maxScore = 0;
  let maxScorePos = 0;
  let matched = 0;
  let scanLastIdx = 0;
  let needleChar = needleKeys[0];
  const needleFirst = needleChar;
  let prevRow0 = 0;
  let prevClass = INITIAL_CHAR_CLASS;
  let inGap = false;

  for (let off = 0; off < width; off++) {
    const cls = hay.classes[firstIdx + off];
    const at = bonusFor(prevClass, cls);
    bonus[off] = at;
    prevClass = cls;
    const key = hay.keys[firstIdx + off];
    if (key === needleChar) {
      if (matched < m) {
        firstOccurrence[matched] = off;
        matched++;
        needleChar = needleKeys[Math.min(matched, m - 1)];
      }
      scanLastIdx = off;
    }
    if (key === needleFirst) {
      const score = SCORE_MATCH + at * BONUS_FIRST_CHAR_MULTIPLIER;
      row0H[off] = score;
      row0C[off] = 1;
      if (m === 1 && score > maxScore) {
        maxScore = score;
        maxScorePos = off;
      }
      inGap = false;
    } else {
      row0H[off] = Math.max(prevRow0 + (inGap ? SCORE_GAP_EXTENSION : SCORE_GAP_START), 0);
      row0C[off] = 0;
      inGap = true;
    }
    prevRow0 = row0H[off];
  }
  if (matched !== m) return null;
  if (m === 1) {
    return { score: maxScore, positions: [toCodeUnitOffset(hay, firstIdx + maxScorePos)] };
  }

  // Phase 3 — one row per remaining needle character, each starting at that
  // character's first occurrence (`firstOccurrence` is strictly increasing, so a row
  // never reads left of its own start).
  const f0 = firstOccurrence[0];
  const matrixWidth = scanLastIdx - f0 + 1;
  const scores = new Int16Array(matrixWidth * m);
  const consecutives = new Int16Array(matrixWidth * m);
  scores.set(row0H.subarray(f0, scanLastIdx + 1), 0);
  consecutives.set(row0C.subarray(f0, scanLastIdx + 1), 0);

  for (let p = 1; p < m; p++) {
    const startCol = firstOccurrence[p];
    const needleCharAtRow = needleKeys[p];
    const row = p * matrixWidth;
    const rowOffset = startCol - f0;
    const length = scanLastIdx - startCol + 1;
    let rowInGap = false;

    for (let k = 0; k < length; k++) {
      const col = startCol + k;
      const cell = rowOffset + k;
      let diagonal = 0;
      const left: number = (scores[row + cell - 1]) +
        (rowInGap ? SCORE_GAP_EXTENSION : SCORE_GAP_START);
      let consecutive = 0;

      if (needleCharAtRow === hay.keys[firstIdx + col]) {
        diagonal = (scores[row + cell - 1 - matrixWidth]) + SCORE_MATCH;
        let at = bonus[col];
        consecutive = (consecutives[row + cell - 1 - matrixWidth]) + 1;
        if (consecutive > 1) {
          const chunkHead = bonus[col - consecutive + 1];
          if (at >= BONUS_BOUNDARY && at > chunkHead) consecutive = 1;
          else at = Math.max(at, BONUS_CONSECUTIVE, chunkHead);
        }
        if (diagonal + at < left) {
          diagonal += bonus[col];
          consecutive = 0;
        } else {
          diagonal += at;
        }
      }
      consecutives[row + cell] = consecutive;
      rowInGap = diagonal < left;
      const score = Math.max(diagonal, left, 0);
      if (p === m - 1 && score > maxScore) {
        maxScore = score;
        maxScorePos = col;
      }
      scores[row + cell] = score;
    }
  }

  // Phase 4 — backtrace the winning cell for the matched offsets. `preferMatch`
  // reproduces fzf's tie-break so the same haystack/needle always yields the same
  // offsets. The iteration bound is a hang-proof net (Rule 9): the DP reaches a
  // match cell within m + matrixWidth steps, so this is not an expected path.
  const positions: number[] = [];
  let i = m - 1;
  let j = maxScorePos;
  let preferMatch = true;
  const stepsLeft = m + matrixWidth + 2;
  for (let step = 0; step < stepsLeft; step++) {
    const rowBase = i * matrixWidth;
    const column = j - f0;
    const here = scores[rowBase + column];
    let diagonal = 0;
    let left = 0;
    if (i > 0 && j >= (firstOccurrence[i])) diagonal = scores[rowBase - matrixWidth + column - 1];
    if (j > (firstOccurrence[i])) left = scores[rowBase + column - 1];
    const rowIndex = i;
    if (here > diagonal && (here > left || (here === left && preferMatch))) {
      positions.push(toCodeUnitOffset(hay, firstIdx + j));
      if (i === 0) break;
      i--;
    }
    preferMatch =
      (consecutives[rowBase + column]) > 1 ||
      (rowIndex + 1 < m &&
        j < scanLastIdx &&
        j + 1 >= (firstOccurrence[rowIndex + 1]) &&
        (consecutives[rowBase + matrixWidth + column + 1]) > 0);
    j--;
  }

  return { score: maxScore, positions: sortUniqueAscending(positions) };
}

function matchVariant(hay: Prepared, variant: CompiledVariant): FuzzyMatch | null {
  const needleKeys = variant.keys;
  if (!variant.exact && !variant.prefix && !variant.suffix) return fuzzyV2(hay, needleKeys);

  const n = hay.keys.length;
  const m = needleKeys.length;
  if (m === 0) return null;

  if (variant.exact && !variant.prefix && !variant.suffix) {
    const { start, end } = trimmedBounds(hay);
    if (end - start !== m) return null;
    for (let i = 0; i < m; i++) {
      if (hay.keys[start + i] !== needleKeys[i]) return null;
    }
const positions: number[] = [];
    for (let i = start; i < end; i++) positions.push(toCodeUnitOffset(hay, i));
    return { score: equalMatchScore(m), positions };
  }

  if (variant.prefix) {
    if (n < m) return null;
    for (let i = 0; i < m; i++) {
      if (hay.keys[i] !== needleKeys[i]) return null;
    }
    if (variant.exact && n > m && !isBoundaryClass(hay.classes[m])) return null;
    return scoreRange(hay, needleKeys, 0, m);
  }

  const offset = n - m;
  if (offset < 0) return null;
  for (let i = 0; i < m; i++) {
    if (hay.keys[offset + i] !== needleKeys[i]) return null;
  }
  return scoreRange(hay, needleKeys, offset, n);
}

function matchTerm(hay: Prepared, term: CompiledTerm): FuzzyMatch | null {
  if (term.inverse) {
    for (const variant of term.variants) {
      if (matchVariant(hay, variant) !== null) return null;
    }
    return { score: 0, positions: [] };
  }
  let best: FuzzyMatch | null = null;
  for (const variant of term.variants) {
    const found = matchVariant(hay, variant);
    if (found === null) continue;
    if (best === null || found.score > best.score) best = found;
  }
  return best;
}

function matchQuery(hay: Prepared, terms: CompiledTerm[]): FuzzyMatch | null {
  let score = 0;
  let positions: number[] = [];
  for (const term of terms) {
    const found = matchTerm(hay, term);
    if (found === null) return null;
    score += found.score;
    for (const at of found.positions) positions.push(at);
  }
  return { score, positions: sortUniqueAscending(positions) };
}

/**
 * fzf's smart-case resolution: an explicit `caseSensitive` wins; otherwise smart-case
 * (on by default) makes the query case-sensitive as soon as it contains an uppercase
 * character.
 */
function resolveCaseSensitive(query: string, options: FuzzyOptions | undefined): boolean {
  if (options?.caseSensitive !== undefined) return options.caseSensitive;
  if (options?.smartCase === false) return false;
  return UPPER_REGEX.test(query);
}

function prepareNeedle(needle: string, caseSensitive: boolean): string[] {
  const points = Array.from(needle);
  const keys = new Array<string>(points.length);
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    keys[i] = caseSensitive ? point : lowerPoint(point);
  }
  return keys;
}

/**
 * Ranks one haystack against a full query, honouring fzf's extended syntax.
 * Returns `null` when the haystack does not satisfy every term.
 */
export function fuzzyMatch(
  haystack: string,
  needle: string,
  options?: FuzzyOptions,
): FuzzyMatch | null {
  const caseSensitive = resolveCaseSensitive(needle, options);
  const terms = compileQuery(needle, caseSensitive);
  if (terms.length === 0) return { score: 0, positions: [] };
  return matchQuery(prepare(haystack, caseSensitive), terms);
}

/**
 * Ranks candidates against a query. Order is deterministic: score descending, then the
 * shorter haystack, then `localeCompare` — the same input always produces the same
 * order. An empty query returns every candidate in input order with score 0 and no
 * positions, which is how the UI renders "no filter applied".
 */
export function fuzzySearch<T>(
  candidates: readonly { item: T; text: string }[],
  query: string,
  options?: FuzzyOptions,
): FuzzyCandidate<T>[] {
  const limit = options?.limit;
  if (limit !== undefined && limit <= 0) return [];

  const caseSensitive = resolveCaseSensitive(query, options);
  const terms = compileQuery(query, caseSensitive);
  if (terms.length === 0) {
    const passthrough: FuzzyCandidate<T>[] = [];
    for (const candidate of candidates) {
      if (limit !== undefined && passthrough.length >= limit) break;
      passthrough.push({ item: candidate.item, text: candidate.text, score: 0, positions: [] });
    }
    return passthrough;
  }

  const matched: FuzzyCandidate<T>[] = [];
  for (const candidate of candidates) {
    const found = matchQuery(prepare(candidate.text, caseSensitive), terms);
    if (found === null) continue;
    matched.push({
      item: candidate.item,
      text: candidate.text,
      score: found.score,
      positions: found.positions,
    });
  }
  matched.sort(
    (a, b) => b.score - a.score || a.text.length - b.text.length || a.text.localeCompare(b.text),
  );
  return limit === undefined ? matched : matched.slice(0, limit);
}
