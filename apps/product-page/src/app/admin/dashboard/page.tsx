import React from "react";
import { db } from "../../../lib/db";
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
      
      <header className="relative z-10 border-b border-[var(--border-glass)]/25 flex items-center justify-between px-8 py-4 backdrop-blur-md">
        <div className="flex items-center gap-2 font-bold text-lg">
          <Shield className="w-5 h-5 text-[var(--accent-emerald)]" />
          <span>BuddySaradhi Admin Panel</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-[var(--text-muted)] font-mono">Logged as: {adminUser}</span>
          <form action={adminLogoutAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[var(--accent-flare)] bg-transparent hover:bg-[var(--accent-flare)]/10 rounded-xl border border-[var(--accent-flare)]/20 cursor-pointer transition"
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
