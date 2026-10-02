// Implements: 02_Core_Logic.md §12.4; BR-SEC-03; EC-SEC-01; 08_Settings.md EC-03.

import { describe, it, expect } from "vitest";
import {
  PIN_LOCKOUT_30S_MS,
  PIN_LOCKOUT_5MIN_MS,
  evaluatePinLockout,
  isPinLockoutActive,
  pinLockoutCode,
} from "./pin-lockout";

describe("pin-lockout ladder (02 §12.4 / BR-SEC-03)", () => {
  it("1–4 fails: forgiving toast with attempts left, no lock", () => {
    for (let fails = 0; fails <= 4; fails++) {
      const state = evaluatePinLockout(fails);
      expect(state.locked).toBe(false);
      expect(state.wipeRequired).toBe(false);
      expect(state.attemptsLeft).toBe(5 - fails);
      expect(pinLockoutCode(state)).toBeNull();
    }
  });

  it("5–9 fails: 30-second lockout", () => {
    for (let fails = 5; fails <= 9; fails++) {
      const state = evaluatePinLockout(fails);
      expect(state.locked).toBe(true);
      expect(state.lockoutMs).toBe(PIN_LOCKOUT_30S_MS);
      expect(state.wipeRequired).toBe(false);
      expect(pinLockoutCode(state)).toBe("PIN_LOCKED");
    }
  });

  it("10–14 fails: 5-minute lockout", () => {
    for (let fails = 10; fails <= 14; fails++) {
      const state = evaluatePinLockout(fails);
      expect(state.locked).toBe(true);
      expect(state.lockoutMs).toBe(PIN_LOCKOUT_5MIN_MS);
      expect(state.wipeRequired).toBe(false);
      expect(pinLockoutCode(state)).toBe("PIN_LOCKED");
    }
  });

  it("15+ fails: wipe required (cloud intact, force re-login)", () => {
    for (const fails of [15, 16, 100]) {
      const state = evaluatePinLockout(fails);
      expect(state.locked).toBe(true);
      expect(state.wipeRequired).toBe(true);
      expect(pinLockoutCode(state)).toBe("PIN_WIPE_REQUIRED");
    }
  });

  it("clamps negative / fractional counts", () => {
    expect(evaluatePinLockout(-3).attemptsLeft).toBe(5);
    expect(evaluatePinLockout(4.9).locked).toBe(false);
  });

  it("locked_until gates attempts until the window elapses", () => {
    expect(isPinLockoutActive(null, "2026-01-01T00:00:00.000Z")).toBe(false);
    expect(isPinLockoutActive("2026-01-01T00:01:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(true);
    expect(isPinLockoutActive("2026-01-01T00:00:00.000Z", "2026-01-01T00:01:00.000Z")).toBe(false);
  });
});
