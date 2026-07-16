# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: Build a secure and highly responsive Admin Dashboard inside the `product-page` application to manage tutor data and manually process subscription upgrades.

**Architecture**: Implement a secure server-side app router validation flow. User authentication and DB changes execute entirely server-side, utilizing Next.js Server Actions and secure HTTP-only cookies, with Direct Turso/SQLite Prisma updates.

**Tech Stack**: Next.js 16 (App Router), Prisma, Tailwind CSS, Lucide icons, Node.js Native Crypto.

## Global Constraints
* Every mutation to setting/plan details must validate session cookies on the server before mutating.
* Accents must follow the bioluminescent palette (`emerald`, `cyan`, `flare`, `amber`, `violet`), never standard indigo or blue.
* All money display should be formatted correctly from paise to standard ₹.

---

### Task 1: Seed Admin Credentials & Password Utilities

**Files**:
* Create: `apps/product-page/src/lib/db.ts`
* Create: `apps/product-page/src/lib/adminAuth.ts`
* Create: `apps/product-page/src/lib/seedAdmin.ts`
* Modify: `apps/product-page/package.json`

**Interfaces**:
* Produces: `hashPassword(password: string): string`
* Produces: `verifyPassword(password: string, stored: string): boolean`
* Produces: `seedAdminUser(): Promise<void>`

- [ ] **Step 1: Set up product-page Prisma client helper**
  Create file `apps/product-page/src/lib/db.ts`:
  ```typescript
  import { PrismaClient } from "@prisma/client";
  
  const globalForPrisma = global as unknown as { prisma: PrismaClient };
  
  export const db = globalForPrisma.prisma || new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || "file:D:/Projects/buddysaradhi/buddysaradhi/prisma/dev.db"
      }
    }
  });
  
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
  ```

- [ ] **Step 2: Create hashing and verification utilities**
  Create file `apps/product-page/src/lib/adminAuth.ts`:
  ```typescript
  import { scryptSync, randomBytes } from "crypto";
  
  export function hashPassword(password: string): string {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
  }
  
  export function verifyPassword(password: string, stored: string): boolean {
    const parts = stored.split(":");
    if (parts.length !== 2) return false;
    const [salt, hash] = parts;
    const testHash = scryptSync(password, salt, 64).toString("hex");
    return testHash === hash;
  }
  ```

- [ ] **Step 3: Create admin seed helper script**
  Create file `apps/product-page/src/lib/seedAdmin.ts`:
  ```typescript
  import { db } from "./db";
  import { hashPassword } from "./adminAuth";
  
  export async function seedAdminUser() {
    const adminUsername = "hkdevs";
    const adminPassword = "$thisisHKdevs@22$";
    
    const existing = await db.adminUser.findUnique({
      where: { username: adminUsername }
    });
    
    if (!existing) {
      const hashedPassword = hashPassword(adminPassword);
      await db.adminUser.create({
        data: {
          username: adminUsername,
          password: hashedPassword
        }
      });
      console.log(`[Admin Seeding] Successfully seeded admin user: ${adminUsername}`);
    }
  }
  ```

- [ ] **Step 4: Hook seeding to landing page load**
  Modify `apps/product-page/src/app/page.tsx` to call `seedAdminUser()` inside the rendering flow:
  ```typescript
  import { seedAdminUser } from "@/lib/seedAdmin";
  // Call before rendering landing page
  await seedAdminUser();
  ```

- [ ] **Step 5: Run tests and verify**
  Run compilation check to make sure database paths and packages resolve:
  Run: `bun run build` inside `apps/product-page`
  Expected: Successful client compilation.

- [ ] **Step 6: Commit**
  ```bash
  git add apps/product-page/src/lib/ apps/product-page/src/app/page.tsx
  git commit -m "feat: implement password hash tools and seed admin account"
  ```

---

### Task 2: Admin Login Page & Server Actions

**Files**:
* Create: `apps/product-page/src/app/admin/actions.ts`
* Create: `apps/product-page/src/app/admin/login/page.tsx`

**Interfaces**:
* Produces: `adminLoginAction(formData: FormData)`
* Produces: `adminLogoutAction()`

- [ ] **Step 1: Write Server Actions for login and session state**
  Create file `apps/product-page/src/app/admin/actions.ts`:
  ```typescript
  "use server";
  
  import { cookies } from "next/headers";
  import { redirect } from "next/navigation";
  import { db } from "@/lib/db";
  import { verifyPassword } from "@/lib/adminAuth";
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
  ```

- [ ] **Step 2: Create Admin Login Page UI**
  Create file `apps/product-page/src/app/admin/login/page.tsx`:
  ```typescript
  "use client";
  
  import React, { useActionState } from "react";
  import { adminLoginAction } from "../actions";
  import { Shield, Key, User, Loader2 } from "lucide-react";
  
  export default function AdminLoginPage() {
    const [state, formAction, isPending] = useActionState(adminLoginAction, null);
    
    return (
      <main className="relative min-h-screen w-full flex items-center justify-center bg-[#060414] px-6">
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute top-[20%] left-[10%] w-[35vw] h-[35vw] rounded-full filter blur-[120px] opacity-[0.1] bg-[#00FF9D]" />
          <div className="absolute bottom-[20%] right-[10%] w-[35vw] h-[35vw] rounded-full filter blur-[120px] opacity-[0.1] bg-[#00F0FF]" />
        </div>
        
        <div className="relative z-10 w-full max-w-md glass-strong border border-[var(--border-glass)]/25 rounded-3xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] font-[family-name:var(--font-heading)]">Admin Portal</h1>
            <p className="text-xs text-[var(--text-muted)] mt-1">BuddySaradhi Core Subscription Management</p>
          </div>
          
          <form action={formAction} className="space-y-4">
            {state?.error && (
              <div className="p-3 bg-[var(--accent-flare)]/10 border border-[var(--accent-flare)]/30 rounded-xl text-xs text-[var(--accent-flare)] text-center">
                {state.error}
              </div>
            )}
            
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Username</label>
              <div className="relative">
                <input
                  type="text"
                  name="username"
                  required
                  placeholder="hkdevs"
                  className="neumo-inset w-full pl-10 pr-4 py-3 text-sm text-[var(--text-primary)] bg-transparent border border-transparent rounded-xl outline-none focus:border-[var(--accent-emerald)] transition"
                />
                <User className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-3.5" />
              </div>
            </div>
            
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Password</label>
              <div className="relative">
                <input
                  type="password"
                  name="password"
                  required
                  placeholder="••••••••"
                  className="neumo-inset w-full pl-10 pr-4 py-3 text-sm text-[var(--text-primary)] bg-transparent border border-transparent rounded-xl outline-none focus:border-[var(--accent-emerald)] transition"
                />
                <Key className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-3.5" />
              </div>
            </div>
            
            <button
              type="submit"
              disabled={isPending}
              className="w-full neumo-raised py-3.5 rounded-xl text-sm font-bold text-[var(--accent-emerald)] shadow-[0_0_12px_rgba(0,255,157,0.15)] hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-6"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying Credentials...
                </>
              ) : (
                "Authorize Login"
              )}
            </button>
          </form>
        </div>
      </main>
    );
  }
  ```

- [ ] **Step 3: Commit**
  ```bash
  git add apps/product-page/src/app/admin/actions.ts apps/product-page/src/app/admin/login/page.tsx
  git commit -m "feat: complete login Server Action validation and Neumorphic Form UI"
  ```

---

### Task 3: Admin Dashboard Layout & Tutor Analytics

**Files**:
* Create: `apps/product-page/src/app/admin/dashboard/page.tsx`
* Create: `apps/product-page/src/app/admin/dashboard/actions.ts`

**Interfaces**:
* Produces: `updateTutorPlanAction(tenantId: string, plan: string)`

- [ ] **Step 1: Implement Plan Mutation Server Action**
  Create file `apps/product-page/src/app/admin/dashboard/actions.ts`:
  ```typescript
  "use server";
  
  import { db } from "@/lib/db";
  import { getAdminSession } from "../actions";
  import { revalidatePath } from "next/cache";
  
  export async function updateTutorPlanAction(tenantId: string, plan: string) {
    const session = await getAdminSession();
    if (!session) {
      throw new Error("Unauthorized access to dashboard actions.");
    }
    
    await db.setting.update({
      where: { tenantId },
      data: { plan }
    });
    
    revalidatePath("/admin/dashboard");
  }
  ```

- [ ] **Step 2: Build Glassmorphic Admin Dashboard Page**
  Create file `apps/product-page/src/app/admin/dashboard/page.tsx`:
  ```typescript
  import React from "react";
  import { db } from "@/lib/db";
  import { getAdminSession, adminLogoutAction } from "../actions";
  import { updateTutorPlanAction } from "./actions";
  import { Shield, LogOut, Users, Settings, Database, Activity, RefreshCw } from "lucide-react";
  import { redirect } from "next/navigation";
  
  export default async function AdminDashboardPage() {
    const adminUser = await getAdminSession();
    if (!adminUser) {
      redirect("/admin/login");
    }
    
    // Fetch stats and lists
    const tutors = await db.setting.findMany({
      orderBy: { createdAt: "desc" }
    });
    
    const totalTutors = tutors.length;
    const freeCount = tutors.filter((t) => t.plan === "free").length;
    const growthCount = tutors.filter((t) => t.plan === "growth").length;
    const instituteCount = tutors.filter((t) => t.plan === "institute").length;
    
    const studentsCount = await db.student.count();
    const batchesCount = await db.batch.count();
    
    return (
      <main className="relative min-h-screen bg-[#060414] text-[var(--text-primary)]">
        {/* Animated Blobs */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute top-[5%] left-[5%] w-[45vw] h-[45vw] rounded-full filter blur-[120px] opacity-[0.08] bg-[#00FF9D]" />
          <div className="absolute bottom-[5%] right-[5%] w-[45vw] h-[45vw] rounded-full filter blur-[120px] opacity-[0.08] bg-[#00F0FF]" />
        </div>
        
        <header className="relative z-10 topbar border-b border-[var(--border-glass)]/25 flex items-center justify-between px-8 py-4 backdrop-blur-md">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Shield className="w-5 h-5 text-[var(--accent-emerald)]" />
            <span>BuddySaradhi Admin Panel</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-[var(--text-muted)] font-mono">Logged as: {adminUser}</span>
            <form action={adminLogoutAction}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[var(--accent-flare)] glass rounded-xl border border-[var(--accent-flare)]/20 hover:bg-[var(--accent-flare)]/10 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign Out
              </button>
            </form>
          </div>
        </header>
        
        <section className="relative z-10 max-w-6xl mx-auto px-6 py-10">
          {/* Metrics Grid */}
          <div className="grid gap-6 md:grid-cols-4 mb-10">
            <div className="glass-strong border border-[var(--border-glass)]/25 rounded-2xl p-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Total Tutors</p>
                  <p className="text-3xl font-bold mt-2">{totalTutors}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
              </div>
            </div>
            
            <div className="glass-strong border border-[var(--border-glass)]/25 rounded-2xl p-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Platform Students</p>
                  <p className="text-3xl font-bold mt-2">{studentsCount}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] flex items-center justify-center">
                  <Database className="w-5 h-5" />
                </div>
              </div>
            </div>
            
            <div className="glass-strong border border-[var(--border-glass)]/25 rounded-2xl p-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Total Batches</p>
                  <p className="text-3xl font-bold mt-2">{batchesCount}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-[var(--accent-violet)]/10 text-[var(--accent-violet)] flex items-center justify-center">
                  <Settings className="w-5 h-5" />
                </div>
              </div>
            </div>
            
            <div className="glass-strong border border-[var(--border-glass)]/25 rounded-2xl p-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Plan Breakdown</p>
                  <p className="text-xs font-mono text-[var(--text-secondary)] mt-2">
                    Free: {freeCount} | Growth: {growthCount} | Inst: {instituteCount}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] flex items-center justify-center">
                  <Activity className="w-5 h-5" />
                </div>
              </div>
            </div>
          </div>
          
          {/* Tutors Table */}
          <div className="glass-strong border border-[var(--border-glass)]/25 rounded-3xl p-6 overflow-hidden">
            <h2 className="text-xl font-bold mb-6 font-[family-name:var(--font-heading)]">Registered Tutors Console</h2>
            
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm text-[var(--text-secondary)]">
                <thead>
                  <tr className="border-b border-[var(--border-glass)]/20 text-[var(--text-muted)] uppercase text-xs tracking-wider">
                    <th className="py-4 px-4 font-semibold">Tutor ID</th>
                    <th className="py-4 px-4 font-semibold">Institute Name</th>
                    <th className="py-4 px-4 font-semibold">Contact</th>
                    <th className="py-4 px-4 font-semibold">Current Plan</th>
                    <th className="py-4 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-glass)]/10">
                  {tutors.map((tutor) => (
                    <tr key={tutor.tenantId} className="hover:bg-white/5 transition-colors">
                      <td className="py-4 px-4 font-mono text-xs">{tutor.tenantId.slice(0, 8)}...</td>
                      <td className="py-4 px-4 font-semibold text-[var(--text-primary)]">{tutor.instituteName}</td>
                      <td className="py-4 px-4">
                        <div className="text-xs">{tutor.instituteEmail || "No Email"}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">{tutor.institutePhone || "No Phone"}</div>
                      </td>
                      <td className="py-4 px-4">
                        <span className={`chip ${
                          tutor.plan === "free" ? "chip-neutral" : tutor.plan === "growth" ? "chip-info" : "chip-success"
                        }`}>
                          {tutor.plan.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <form action={async (fd: FormData) => {
                          "use server";
                          const plan = fd.get("plan") as string;
                          await updateTutorPlanAction(tutor.tenantId, plan);
                        }} className="inline-flex items-center gap-2">
                          <select
                            name="plan"
                            defaultValue={tutor.plan}
                            className="bg-[#141225] border border-[var(--border-glass)] text-xs text-[var(--text-primary)] px-2.5 py-1.5 rounded-xl outline-none"
                          >
                            <option value="free">Free</option>
                            <option value="growth">Growth</option>
                            <option value="institute">Institute</option>
                          </select>
                          <button
                            type="submit"
                            className="inline-flex p-2 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] rounded-xl border border-[var(--accent-emerald)]/25 hover:bg-[var(--accent-emerald)]/20 cursor-pointer"
                            aria-label="Update subscription plan"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    );
  }
  ```

- [ ] **Step 3: Run full typecheck and build**
  Run: `pnpm --filter product-page typecheck` (or build compiler checks)
  Expected: Build succeeds with 0 type errors.

- [ ] **Step 4: Commit**
  ```bash
  git add apps/product-page/src/app/admin/dashboard/
  git commit -m "feat: design visual liquid glass admin dashboard with direct plan updates"
  ```
