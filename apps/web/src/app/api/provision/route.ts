// apps/web/src/app/api/provision/route.ts
// Implements: 18_Microservice_Architecture.md — provision-db service
//
// Called by the /signup/provision page to:
//   1. Create a real per-tenant Turso database via Turso API
//   2. Store db_url + db_token in Supabase user_metadata via service role
//   3. Fall back to shared env DB if Turso API is unavailable (dev/staging)
//
// Security: validates the caller's Supabase JWT before touching anything.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TURSO_API_TOKEN = process.env.TURSO_API_TOKEN;
const TURSO_ORGANISATION_SLUG = process.env.TURSO_ORGANISATION_SLUG || process.env.TURSO_ORGANISATION_NAME;
const TURSO_SHARED_URL = process.env.TURSO_DATABASE_URL;
const TURSO_SHARED_TOKEN = process.env.TURSO_AUTH_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Attempt to create a Turso database for a given user ID.
 * Returns { url, token } on success or null on failure.
 */
async function createTursoDb(userId: string): Promise<{ url: string; token: string } | null> {
  if (!TURSO_API_TOKEN || !TURSO_ORGANISATION_SLUG) return null;

  const dbName = `buddysaradhi-${userId.slice(0, 16)}`;

  try {
    // Create DB — use the "buddysaradhi" group that exists in the org
    const createRes = await fetch(
      `https://api.turso.tech/v1/organizations/${TURSO_ORGANISATION_SLUG}/databases`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TURSO_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: dbName, group: "buddysaradhi" }),
      }
    );

    // 422 = already exists (idempotent); other errors are real failures
    if (!createRes.ok && createRes.status !== 422) {
      const errText = await createRes.text();
      console.error("Turso create DB failed:", createRes.status, errText);
      return null;
    }

    // Get the created DB's hostname from the response
    let dbHostname: string | null = null;
    if (createRes.ok) {
      const createData = (await createRes.json()) as { database?: { Hostname?: string } };
      dbHostname = createData.database?.Hostname ?? null;
    }

    // Generate a token for this DB
    const tokenRes = await fetch(
      `https://api.turso.tech/v1/organizations/${TURSO_ORGANISATION_SLUG}/databases/${dbName}/auth/tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TURSO_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiration: "never", authorization: "full-access" }),
      }
    );

    if (!tokenRes.ok) {
      console.error("Turso generate token failed:", tokenRes.status, await tokenRes.text());
      return null;
    }

    const tokenData = (await tokenRes.json()) as { jwt?: string };
    if (!tokenData.jwt) return null;

    // Use hostname from API response or construct it
    const hostname = dbHostname ?? `${dbName}-${TURSO_ORGANISATION_SLUG}.aws-ap-south-1.turso.io`;
    const url = `libsql://${hostname}`;
    return { url, token: tokenData.jwt };
  } catch (err) {
    console.error("Turso API error:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    // Validate the caller's Supabase JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // Use admin client to validate JWT and get user
    const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userErr } = await adminSupabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return NextResponse.json({ success: false, error: "Invalid session" }, { status: 401 });
    }

    const user = userData.user;
    const existingDbUrl = user.user_metadata?.db_url as string | undefined;

    // If user already has a real (non-dummy) DB URL provisioned, return immediately
    if (
      existingDbUrl &&
      !existingDbUrl.includes("dummy-local-dev-url") &&
      !existingDbUrl.includes("file:")
    ) {
      return NextResponse.json({
        success: true,
        message: "already_provisioned",
        dbUrl: existingDbUrl,
      });
    }

    // Step 1: Try to create a real per-user Turso database
    let dbUrl: string | null = null;
    let dbToken: string | null = null;
    let method = "turso";

    const tursoResult = await createTursoDb(user.id);
    if (tursoResult) {
      dbUrl = tursoResult.url;
      dbToken = tursoResult.token;
    } else {
      // Step 2: Fall back to shared environment database
      // This is used in development, staging, or when Turso API is unavailable
      if (TURSO_SHARED_URL && TURSO_SHARED_TOKEN) {
        dbUrl = TURSO_SHARED_URL;
        dbToken = TURSO_SHARED_TOKEN;
        method = "shared";
      }
    }

    if (!dbUrl || !dbToken) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to provision database. Please contact support.",
        },
        { status: 503 }
      );
    }

    // Step 3: Store credentials in Supabase user_metadata via admin API
    const { error: updateErr } = await adminSupabase.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        db_url: dbUrl,
        db_token: dbToken,
        provisioned_at: new Date().toISOString(),
        provision_method: method,
      },
    });

    if (updateErr) {
      console.error("Failed to update user metadata:", updateErr);
      return NextResponse.json(
        { success: false, error: "Failed to store database credentials." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: "provisioned", method });
  } catch (err) {
    console.error("Provision API error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error during provisioning." },
      { status: 500 }
    );
  }
}
