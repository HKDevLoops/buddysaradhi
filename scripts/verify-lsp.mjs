// Verifies each configured LSP server actually completes an LSP `initialize`
// handshake and advertises the capabilities diagnostics depend on. A server that
// starts but never answers is worse than one that is absent, because it looks
// configured while surfacing nothing.
//
// WHY tsls is pointed at TypeScript 5.9.3 AND NOT AT THE WORKSPACE'S 7.0.2
// ─────────────────────────────────────────────────────────────────────────
// The workspace runs TypeScript 7 (the native port). `node_modules/typescript/lib`
// contains only `tsc.js`, `getExePath.js` and `version.cjs` — there is NO
// `typescript.js` language service to load. `typescript-language-server` loads
// exactly that file, so against TS 7 it exits during `initialize` with
// "Could not find a valid TypeScript installation".
//
// So the LSP is wired to the 5.9.3 language service, which this workspace already
// has (it is `packages/design-system`'s compiler). That yields real diagnostics
// for every .ts/.tsx edit. TS 7.0.2 `tsc --noEmit` remains the GATE — it is the
// authority and it is what CI runs. The LSP is a fast second pair of eyes, not a
// replacement, and a disagreement between them means TS 7 is right.
//
// Run: node scripts/verify-lsp.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(".").replace(/\\/g, "/");

/** The 5.9 language service directory, discovered from the pnpm store. */
function findTsLanguageService() {
  const candidates = [
    "node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib",
    "node_modules/.pnpm/typescript@5.9.2/node_modules/typescript/lib",
    "node_modules/design-system/node_modules/typescript/lib",
  ];
  return candidates.find((c) => existsSync(`${c}/typescript.js`));
}

const TS_LIB = findTsLanguageService();
const TSLS_CLI =
  "C:/Users/haris/AppData/Roaming/npm/node_modules/typescript-language-server/lib/cli.mjs";

const SERVERS = [
  {
    name: "typescript-language-server",
    // Spawned as `node <cli> --stdio`, NOT via the npm `.cmd` shim. On Windows a
    // `.cmd` cannot be spawned by a child process without a shell (EINVAL —
    // AGENTS.md §15 FM-18), and the shim also buffers stdio, which stalls the
    // handshake. Both the config and this script avoid shims for that reason.
    command: process.execPath,
    args: [TSLS_CLI, "--stdio"],
    initializationOptions: TS_LIB
      ? { tsserver: { path: TS_LIB }, preferences: { includeInlayParameterNameHints: "none" } }
      : undefined,
    // `textDocumentSync` is what makes diagnostics arrive at all; without it the
    // server can answer initialize and still never report a problem.
    mustAdvertise: ["textDocumentSync"],
  },
  {
    name: "deno lsp",
    command: "C:/Users/haris/scoop/shims/deno.exe",
    args: ["lsp"],
    mustAdvertise: ["textDocumentSync"],
  },
];

function probe(server) {
  return new Promise((resolve) => {
    for (const required of [server.command, ...server.args.filter((a) => a.includes("/"))]) {
      if (required.includes(":") && !existsSync(required)) {
        resolve({ ...server, ok: false, why: `not found: ${required}` });
        return;
      }
    }
    const proc = spawn(server.command, server.args, {
      cwd: ROOT,
      shell: false,
      env: { ...process.env, ...(server.env ?? {}) },
    });
    let buf = "";
    let settled = false;

    const finish = (ok, why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      resolve({ ...server, ok, why });
    };

    const timer = setTimeout(() => finish(false, "no initialize response within 60s"), 60_000);

    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      // Surface a JSON-RPC error frame: tsls reports "no valid TypeScript
      // installation" this way, and it is invisible without looking.
      if (buf.includes('"error"') && !buf.includes('"result"')) {
        const at = buf.indexOf('"error"');
        finish(false, `initialize returned an error: ${buf.slice(at, at + 220)}`);
        return;
      }
      if (!buf.includes("serverInfo") && !buf.includes("textDocumentSync")) return;
      const missing = server.mustAdvertise.filter((c) => !buf.includes(c));
      finish(missing.length === 0, missing.length ? `missing capabilities: ${missing.join(", ")}` : "");
    });
    proc.stderr.on("data", (chunk) => {
      buf += chunk.toString();
    });
    proc.on("exit", (code) => finish(false, `exited early with code ${code}`));

    const params = {
      processId: null,
      rootUri: `file:///${ROOT}`,
      capabilities: {},
      workspaceFolders: [{ uri: `file:///${ROOT}`, name: "buddysaradhi" }],
    };
    if (server.initializationOptions) {
      params.initializationOptions = server.initializationOptions;
    }
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params });
    proc.stdin.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
  });
}

if (!TS_LIB) {
  console.error(
    "FAIL  no TypeScript 5.x language service found — tsls cannot start against TS 7",
  );
  process.exit(1);
}
console.log(`using TypeScript language service: ${TS_LIB.replace(ROOT, "<root>")}`);

let failures = 0;
for (const server of SERVERS) {
  const result = await probe(server);
  if (result.ok) {
    console.log(`OK    ${result.name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${result.name} — ${result.why}`);
  }
}
process.exit(failures === 0 ? 0 : 1);