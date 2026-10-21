// Implements: AGENTS.md §3.4 (the ORM surface binds an `in` list as SQL
// variables) — SQLite's `SQLITE_MAX_VARIABLE_NUMBER` is 32,766 on modern
// builds but only 999 on older ones, and exceeding it is a HARD error
// ("too many SQL variables"), not a truncation.
//
// 500 sits comfortably inside both ceilings, so a chunked `IN (...)` list
// works on every SQLite the product can meet.
//
// It lives in its own module because TWO dialects need it: the ORM fee
// dialect (`feesPrisma.ts`) and the ORM void dialect (`ledger.ts`) both bind
// a credit id list, and a second copy of the ceiling is a second number to
// get wrong.

/**
 * The most bound parameters one statement may carry.
 */
export const MAX_SQL_VARIABLES_PER_STATEMENT = 500;

/** Split a list into chunks of at most `size` entries. */
export function chunkIds(
  ids: string[],
  size: number = MAX_SQL_VARIABLES_PER_STATEMENT,
): string[][] {
  if (ids.length === 0) return [];
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}
