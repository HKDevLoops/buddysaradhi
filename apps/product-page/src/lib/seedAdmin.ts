import { db } from "./db";
import { hashPassword } from "./adminAuth";
import { logInfo, logError } from "./logger";

// Admin seed credentials are sourced from environment variables ONLY.
// Never hardcode credentials in source code.
// Ref: Rule 9 (no silent failures), 10_Security.md §12 (SECRETS-1)
function getAdminSeedCreds(): { username: string; password: string } {
  const username = process.env.ADMIN_SEED_USERNAME;
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!username || !password) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ADMIN_SEED_USERNAME and ADMIN_SEED_PASSWORD must be set as environment variables. " +
        "Never use hardcoded credentials in production. " +
        "Set them in your Vercel project environment variables."
      );
    }
    // Dev-only guard: surface clearly but don't use hardcoded values
    throw new Error(
      "Missing ADMIN_SEED_USERNAME or ADMIN_SEED_PASSWORD. " +
      "Add them to .env.local:\n" +
      "  ADMIN_SEED_USERNAME=your-admin-username\n" +
      "  ADMIN_SEED_PASSWORD=your-secure-password"
    );
  }

  return { username, password };
}

export async function seedAdminUser() {
  const { username, password } = getAdminSeedCreds();

  const existing = await db.adminUser.findUnique({
    where: { username },
  });

  if (!existing) {
    const hashedPassword = hashPassword(password);
    await db.adminUser.create({
      data: {
        username,
        password: hashedPassword,
      },
    });
    logInfo("admin.seed_success", { username });
  }
}
