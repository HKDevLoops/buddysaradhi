// Implements: RFC-003 workstream E §4 (anti-tamper parity — no secret/token
// echo in responses; no stacks/SQL in errors; Rule 9) + 10_Security.md §1/§3.4
// (tenant_secret and pin_hash never leave the DB in plaintext).
//
// Runs the production settings handler against in-memory SQLite (AGENTS.md
// §7.3 — real DB, never mocked).
import { describe, expect, it } from "vitest";
import { handleSettings } from "../routes/settings.ts";
import type { DB } from "../lib/db.ts";
import { createLedgerFixture, type LedgerFixture } from "./sqlite-db.ts";

interface ApiBody {
  success: boolean;
  data?: Record<string, unknown> | null;
  error?: string;
  details?: string;
}

const SECRET_KEYS = [
  "pin_hash",
  "pinHash",
  "panic_pin_hash",
  "panicPinHash",
  "tenant_secret",
  "tenantSecret",
  "backup_passphrase_hash",
  "backupPassphraseHash",
];

function seedSecrets(fixture: LedgerFixture): void {
  fixture.db.raw
    .prepare(
      `UPDATE settings SET pin_hash = ?, backup_passphrase_hash = ?, institute_name = ? WHERE tenant_id = ?`,
    )
    .run("argon2id-seeded-pin-hash", "seeded-backup-hash", "Fixture Tuition", fixture.tenantId);
}

async function getSettings(fixture: LedgerFixture): Promise<{ status: number; body: ApiBody }> {
  const req = new Request("https://api.buddysaradhi.app/api/v1/settings", { method: "GET" });
  const res = await handleSettings(
    req,
    // SAFETY: the SQLite fixture satisfies `SqlHandle` (lib/sql.ts), which is
    // the only capability the route uses at runtime.
    fixture.db as unknown as DB,
    fixture.tenantId,
    "/api/v1/settings",
    "GET",
    new URL(req.url),
    {},
  );
  if (!res) throw new Error("no route matched GET /api/v1/settings");
  return { status: res.status, body: (await res.json()) as ApiBody };
}

async function patchSettings(
  fixture: LedgerFixture,
  body: Record<string, unknown>,
): Promise<{ status: number; body: ApiBody }> {
  const req = new Request("https://api.buddysaradhi.app/api/v1/settings", {
    method: "PATCH",
    // RFC-004 C1 — the gateway is fail-closed on keyless mutations.
    headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const res = await handleSettings(
    req,
    // SAFETY: same SqlHandle substitution as above.
    fixture.db as unknown as DB,
    fixture.tenantId,
    "/api/v1/settings",
    "PATCH",
    new URL(req.url),
    {},
  );
  if (!res) throw new Error("no route matched PATCH /api/v1/settings");
  return { status: res.status, body: (await res.json()) as ApiBody };
}

describe("no secret echo — settings GET/PATCH (10_Security.md §1/§3.4)", () => {
  it("GET never returns pin_hash / tenant_secret / backup hash", async () => {
    const f = createLedgerFixture();
    seedSecrets(f);
    const res = await getSettings(f);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    for (const key of SECRET_KEYS) {
      expect(raw).not.toContain(key);
    }
    expect(raw).not.toContain("argon2id-seeded-pin-hash");
    expect(raw).not.toContain("seeded-backup-hash");
    // The tenant pepper stays server-side only (it signs the hash chain).
    expect(raw).not.toContain(f.tenantSecret);
    // Non-secret profile fields still served.
    expect(raw).toContain("Fixture Tuition");
  });

  it("PATCH response never echoes secrets", async () => {
    const f = createLedgerFixture();
    seedSecrets(f);
    const res = await patchSettings(f, { instituteName: "Sharma Tuitions" });
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    for (const key of SECRET_KEYS) {
      expect(raw).not.toContain(key);
    }
    expect(raw).toContain("Sharma Tuitions");
  });

  it("PATCH rejects a body of only secret fields (allowlist strips them)", async () => {
    const f = createLedgerFixture();
    const res = await patchSettings(f, { pin_hash: "attacker-supplied" });
    expect(res.status).toBe(400);
    const row = f.db.query("SELECT pin_hash FROM settings WHERE tenant_id = ?", [f.tenantId])[0];
    expect(row?.pin_hash).toBeNull();
  });

  it("typed errors carry no secret material, stacks, or SQL", async () => {
    const f = createLedgerFixture();
    seedSecrets(f);
    const bad = await patchSettings(f, { grace_days: "not-a-number" });
    expect(bad.status).toBe(400);
    const raw = JSON.stringify(bad.body);
    expect(raw).not.toContain("argon2id-seeded-pin-hash");
    expect(raw).not.toMatch(/at\s+\w+\s*\(/);
    expect(raw).not.toMatch(/SELECT|INSERT|UPDATE|sqlite/i);
  });
});
