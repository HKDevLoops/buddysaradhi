"use server";

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { log } from "@/lib/logger";

const APP_COOKIES = new Set(["buddysaradhi_session"]);
const isSupabaseAuthCookie = (name: string) =>
  name.startsWith("sb-") || name.includes("auth-token") || name.includes("supabase");

export type SignOutResult = { ok: true; redirectTo: string } | { ok: false; error: string };

export async function signOutAction(): Promise<SignOutResult> {
  const supabase = await createSupabaseServer();
  const url = new URL("/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");

  let accessToken: string | null = null;
  let cookiesToClear: { name: string }[] = [];

  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    const all = store.getAll();
    cookiesToClear = all.filter(
      (c) => isSupabaseAuthCookie(c.name) || APP_COOKIES.has(c.name),
    );
    for (const c of all) {
      if (isSupabaseAuthCookie(c.name)) {
        accessToken = c.value;
        break;
      }
    }
  } catch (err) {
    log.warn("signout_cookie_read_failed", err instanceof Error ? err.message : String(err));
  }

  if (accessToken) {
    try {
      const { data } = await supabase.auth.getUser(accessToken);
      if (data.user?.id) {
        await supabase.auth.signOut({ scope: "global" });
      }
    } catch (err) {
      log.error("signout_supabase_failed", err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    for (const c of cookiesToClear) {
      try {
        store.delete(c.name);
      } catch (err) {
        log.warn("signout_cookie_delete_failed", err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    log.warn("signout_cookie_clear_failed", err instanceof Error ? err.message : String(err));
  }

  redirect(url.pathname + url.search);
}
