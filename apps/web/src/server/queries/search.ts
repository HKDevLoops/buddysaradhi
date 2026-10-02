// Implements: docs/design/overhaul-plan.md §3 "One search, local only" — the local
// candidate source for the students toolbar, the Fees/Attendance filters and the shell
// ⌘K palette. Principle: P5 (offline-first). Rules: AGENTS.md §2 Rule 2 (no gateway call
// while typing — this query is the tutor's OWN database, reached through the ORM surface
// only) and §3.4 ORM-ONLY (`getAuthenticatedPrisma().student.findMany`, no SQL text); the
// ranking itself is `packages/shared/src/fuzzy.ts`.
//
// The projection is deliberately minimal and non-financial: identity + contact only. A
// balance, a due amount or a fee plan must never ride along with a search result — the
// search path is the one place a typo in a query string could page a tutor's money into
// a client payload, and `07_Fees_and_Payments.md` keeps money reads on the fees screen.

"use server";

import { cache } from "react";
import { getAuthenticatedPrisma } from "@/server/get-db";
import {
  DEFAULT_REFERENCE_TTL_MS,
  getCached,
  toTypedQueryError,
} from "@/server/cache";
import { log } from "@/lib/logger";

/**
 * Hard cap on the candidate set. A single tutor's roster is far below this; the bound
 * exists so the query stays inside the metered-tier budgets in `web/02_State_and_Data_Flow.md`
 * §5 and so the client's O(candidates × needle) ranking stays imperceptible. Roster
 * order is stabilised by `orderBy lastName` so equal scores tie-break identically on
 * every read.
 */
const SEARCH_CANDIDATE_LIMIT = 2000;

/** Cache key — tenant-scoped by `getCached`, and not one of the money-bearing prefixes. */
const SEARCH_CANDIDATES_CACHE_KEY = "search:student-candidates";

/**
 * Exactly this projection leaves the ORM — id, name, code, phone, status. A balance, a
 * due amount or a fee plan is never selected, so no financial value can reach a client
 * payload through the search path.
 */
const SEARCH_CANDIDATE_SELECT: Readonly<Record<string, true>> = {
  id: true,
  firstName: true,
  lastName: true,
  code: true,
  phone: true,
  status: true,
};

export interface StudentSearchCandidate {
  id: string;
  first_name: string;
  last_name: string | null;
  code: string | null;
  phone: string | null;
  status: string;
}

interface StudentCandidateRow {
  id: string;
  firstName: string;
  lastName: string | null;
  code: string | null;
  phone: string | null;
  status: string;
}

function toCandidate(row: StudentCandidateRow): StudentSearchCandidate {
  return {
    id: row.id,
    first_name: row.firstName,
    last_name: row.lastName,
    code: row.code,
    phone: row.phone,
    status: row.status,
  };
}

/**
 * The whole searchable roster, read once and ranked locally. Cached per tenant for the
 * reference-data TTL (`server/cache.ts`); roster churn is higher than settings churn, so
 * this is invalidated with the rest of the tenant reference cache rather than being
 * request-scoped. Never tenant-cacheable keys prefixed `ledger:`/`balance:` are involved
 * — nothing financial is read here.
 */
export const getSearchCandidates = cache(async (): Promise<{
  success: boolean;
  data?: StudentSearchCandidate[];
  error?: string;
}> => {
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const rows = await getCached(
      tenantId,
      SEARCH_CANDIDATES_CACHE_KEY,
      async () =>
        (await db.student.findMany({
          where: { tenantId },
          orderBy: { lastName: "asc" },
          take: SEARCH_CANDIDATE_LIMIT,
          select: { ...SEARCH_CANDIDATE_SELECT },
        })) as StudentCandidateRow[],
      DEFAULT_REFERENCE_TTL_MS,
    );
    return { success: true, data: rows.map(toCandidate) };
  } catch (error) {
    const typed = toTypedQueryError(error);
    log.error("search_candidates_failed", typed);
    return { success: false, error: typed };
  }
});