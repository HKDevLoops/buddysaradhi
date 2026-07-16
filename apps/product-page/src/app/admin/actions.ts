"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "../../lib/db";
import { verifyPassword } from "../../lib/adminAuth";
import { createHmac } from "crypto";

const COOKIE_NAME = "bs_admin_session";
const SESSION_SECRET = process.env.GATEWAY_SHARED_SECRET || "buddysaradhi-dev-secret-key-128bits";

function signSessionPayload(username: string): string {
  const payload = JSON.stringify({ username, exp: Date.now() + 24 * 60 * 60 * 1000 });
  const signature = createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${Buffer.from(payload).toString("base64")}.${signature}`;
}

export async function adminLoginAction(prevState: any, formData: FormData) {
  const username = formData.get("username") as string;
  const password = formData.get("password") as string;
  
  if (!username || !password) {
    return { error: "Please enter both username and password." };
  }
  
  try {
    const user = await db.adminUser.findUnique({ where: { username } });
    if (!user || !verifyPassword(password, user.password)) {
      return { error: "Invalid username or password credentials." };
    }
    
    const token = signSessionPayload(username);
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 // 24 hours
    });
  } catch (err) {
    return { error: "An error occurred during authentication verification." };
  }
  
  redirect("/admin/dashboard");
}

export async function adminLogoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  redirect("/admin/login");
}

export async function getAdminSession(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  
  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) return null;
  
  const payloadStr = Buffer.from(payloadBase64, "base64").toString("utf-8");
  const computedSignature = createHmac("sha256", SESSION_SECRET).update(payloadStr).digest("hex");
  if (computedSignature !== signature) return null;
  
  try {
    const payload = JSON.parse(payloadStr);
    if (payload.exp < Date.now()) return null;
    return payload.username;
  } catch {
    return null;
  }
}
