import { makeApi, Zodios, type ZodiosOptions } from "@zodios/core";
import { z } from "zod";

const LedgerEntry = z
  .object({
    id: z.string(),
    tutorId: z.string(),
    studentId: z.string(),
    batchId: z.string().optional(),
    kind: z.enum(["fee_due", "fee_paid", "discount", "refund", "void"]),
    amountPaise: z.number().int(),
    reversesEntryId: z.string().optional(),
    notes: z.string().optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .passthrough();
const ApiError = z
  .object({
    code: z.enum([
      "unauthenticated",
      "forbidden",
      "contract_violation",
      "not_found",
      "conflict",
      "rate_limited",
      "storage_unavailable",
      "upstream_violation",
      "internal",
    ]),
    message: z.string(),
    retryAfterMs: z.number().int().optional(),
    operationId: z.string(),
    traceId: z.string(),
  })
  .passthrough();
const ledgerPostEntry_Body = z
  .object({
    tutorId: z.string(),
    studentId: z.string(),
    batchId: z.string().optional(),
    kind: z.enum(["fee_due", "fee_paid", "discount", "refund"]),
    amountPaise: z.number().int(),
    notes: z.string().optional(),
  })
  .passthrough();
const ledgerVoidEntry_Body = z
  .object({ tutorId: z.string(), reason: z.string() })
  .passthrough();
const secureErase_Body = z
  .object({ tutorId: z.string(), confirm: z.string() })
  .passthrough();

export const schemas = {
  LedgerEntry,
  ApiError,
  ledgerPostEntry_Body,
  ledgerVoidEntry_Body,
  secureErase_Body,
};

const endpoints = makeApi([
  {
    method: "get",
    path: "/ledger",
    alias: "ledgerListEntries",
    requestFormat: "json",
    parameters: [
      {
        name: "tutorId",
        type: "Query",
        schema: z.string(),
      },
      {
        name: "since",
        type: "Query",
        schema: z.string().datetime({ offset: true }).optional(),
      },
    ],
    response: z.array(LedgerEntry),
  },
  {
    method: "post",
    path: "/ledger",
    alias: "ledgerPostEntry",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: ledgerPostEntry_Body,
      },
    ],
    response: LedgerEntry,
  },
  {
    method: "post",
    path: "/ledger/:id/void",
    alias: "ledgerVoidEntry",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: ledgerVoidEntry_Body,
      },
      {
        name: "id",
        type: "Path",
        schema: z.string(),
      },
    ],
    response: LedgerEntry,
  },
  {
    method: "get",
    path: "/ledger/balance",
    alias: "ledgerComputeBalance",
    requestFormat: "json",
    parameters: [
      {
        name: "tutorId",
        type: "Query",
        schema: z.string(),
      },
      {
        name: "studentId",
        type: "Query",
        schema: z.string(),
      },
    ],
    response: z.object({ balancePaise: z.number().int() }).passthrough(),
  },
  {
    method: "post",
    path: "/security/erase",
    alias: "secureErase",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: secureErase_Body,
      },
    ],
    response: z.object({ success: z.boolean() }).partial().passthrough(),
  },
]);

export const api = new Zodios(endpoints);

export function createApiClient(baseUrl: string, options?: ZodiosOptions) {
  return new Zodios(baseUrl, endpoints, options);
}
