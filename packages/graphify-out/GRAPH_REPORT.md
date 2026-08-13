# Graph Report - packages  (2026-07-13)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 317 nodes · 417 edges · 15 communities (14 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]

## God Nodes (most connected - your core abstractions)
1. `CancelablePromise` - 19 edges
2. `compilerOptions` - 17 edges
3. `DefaultService` - 10 edges
4. `compilerOptions` - 9 edges
5. `ApiRequestOptions` - 9 edges
6. `BaseHttpRequest` - 9 edges
7. `OpenAPIConfig` - 9 edges
8. `compilerOptions` - 9 edges
9. `ApiError` - 8 edges
10. `cn()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `BuddysaradhiSDK` --references--> `BaseHttpRequest`  [EXTRACTED]
  shared/sdk/BuddysaradhiSDK.ts → shared/sdk/core/BaseHttpRequest.ts
- `BuddysaradhiSDK` --references--> `DefaultService`  [EXTRACTED]
  shared/sdk/BuddysaradhiSDK.ts → shared/sdk/services/DefaultService.ts
- `ApiError` --references--> `ApiRequestOptions`  [EXTRACTED]
  shared/sdk/core/ApiError.ts → shared/sdk/core/ApiRequestOptions.ts
- `FetchHttpRequest` --inherits--> `BaseHttpRequest`  [EXTRACTED]
  shared/sdk/core/FetchHttpRequest.ts → shared/sdk/core/BaseHttpRequest.ts
- `sendRequest()` --calls--> `OnCancel`  [EXTRACTED]
  shared/sdk/core/request.ts → shared/sdk/core/CancelablePromise.ts

## Import Cycles
- None detected.

## Communities (15 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.10
Nodes (18): ApiError, ApiRequestOptions, ApiResult, BaseHttpRequest, CancelablePromise, CancelError, FetchHttpRequest, Headers (+10 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (46): AppState, AppStateSchema, AttendanceRecord, AttendanceRecordSchema, AttendanceSession, AttendanceSessionSchema, AuditLog, AuditLogSchema (+38 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (20): BatchInvoiceConfig, InvoiceResult, generateReport(), ReportConfig, runCsvWorker(), SearchResult, isLockedOut(), lockoutCache (+12 more)

### Community 3 - "Community 3"
Cohesion: 0.11
Nodes (17): cn(), BarChart, BarChartProps, Chip, ChipProps, GlassPanel, GlassPanelProps, GlassTier (+9 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (17): AttendanceRecord, AttendanceRecordSchema, AttendanceSession, AttendanceSessionSchema, AttendanceStatus, AttendanceStatusSchema, StudentAttendanceRow, StudentAttendanceRowSchema (+9 more)

### Community 5 - "Community 5"
Cohesion: 0.17
Nodes (15): OnCancel, base64(), getHeaders(), getQueryString(), getRequestBody(), getResponseHeader(), getUrl(), isBlob() (+7 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (18): dependencies, zod, @zodios/core, devDependencies, openapi-typescript-codegen, openapi-zod-client, swagger-parser, typescript (+10 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+10 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (17): dependencies, clsx, tailwind-merge, devDependencies, react, react-dom, @types/react, @types/react-dom (+9 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (15): dependencies, @libsql/client, zod, devDependencies, fast-check, @types/node, typescript, @vitest/coverage-v8 (+7 more)

### Community 10 - "Community 10"
Cohesion: 0.18
Nodes (10): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, module, outDir, skipLibCheck, strict (+2 more)

### Community 11 - "Community 11"
Cohesion: 0.18
Nodes (10): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, module, outDir, skipLibCheck, strict (+2 more)

### Community 12 - "Community 12"
Cohesion: 0.20
Nodes (8): api, ApiError, endpoints, LedgerEntry, ledgerPostEntry_Body, ledgerVoidEntry_Body, schemas, secureErase_Body

## Knowledge Gaps
- **177 isolated node(s):** `name`, `version`, `main`, `types`, `build` (+172 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CancelablePromise` connect `Community 0` to `Community 5`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `OpenAPIConfig` connect `Community 0` to `Community 5`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `name`, `version`, `main` to the rest of the system?**
  _177 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.09551020408163265 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06606606606606606 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.11076923076923077 - nodes in this community are weakly interconnected._