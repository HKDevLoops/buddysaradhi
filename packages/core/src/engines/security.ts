import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

// In-memory brute-force tracker for PIN lockouts
const lockoutCache: Record<
  string,
  { attempts: number; lockedUntil: number | null }
> = {};
const MAX_ATTEMPTS = 15;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export async function verifyPin(
  db: PrismaClient,
  tenantId: string,
  pin: string,
): Promise<boolean> {
  const isLocked = await isLockedOut(db, tenantId);
  if (isLocked) {
    throw new Error(
      "Account is temporarily locked due to too many failed attempts.",
    );
  }

  const setting = await db.setting.findUnique({
    where: { tenantId },
  });

  if (!setting || !setting.pinHash) {
    return false;
  }

  const isValid = await argon2.verify(setting.pinHash, pin);

  if (!isValid) {
    // Increment attempts
    const state = lockoutCache[tenantId] || { attempts: 0, lockedUntil: null };
    state.attempts += 1;

    if (state.attempts >= MAX_ATTEMPTS) {
      state.lockedUntil = Date.now() + LOCKOUT_MS;
      // Also update DB app_state for cross-process lockout
      await db.appState.update({
        where: { tenantId },
        data: {
          appLockState: "locked",
          appLockUntil: new Date(state.lockedUntil),
        },
      });
    }
    lockoutCache[tenantId] = state;
    return false;
  }

  // Success, reset attempts
  if (lockoutCache[tenantId]) {
    lockoutCache[tenantId] = { attempts: 0, lockedUntil: null };
  }
  return true;
}

export async function isLockedOut(
  db: PrismaClient,
  tenantId: string,
): Promise<boolean> {
  // Check memory cache first
  const state = lockoutCache[tenantId];
  if (state && state.lockedUntil && state.lockedUntil > Date.now()) {
    return true;
  }

  // Check DB state
  const appState = await db.appState.findUnique({
    where: { tenantId },
  });

  if (appState && appState.appLockState === "locked" && appState.appLockUntil) {
    if (appState.appLockUntil.getTime() > Date.now()) {
      return true;
    } else {
      // Lock expired, unlock it
      await db.appState.update({
        where: { tenantId },
        data: {
          appLockState: "unlocked",
          appLockUntil: null,
        },
      });
    }
  }

  return false;
}

export async function setPin(
  db: PrismaClient,
  tenantId: string,
  pin: string,
): Promise<void> {
  const pinHash = await argon2.hash(pin, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MiB
    timeCost: 3,
    parallelism: 2,
  });

  await db.setting.update({
    where: { tenantId },
    data: { pinHash },
  });
}
