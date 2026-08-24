"use client";

import React, { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, MessageSquare, Loader2, ArrowLeft, CheckCircle, Send, AlertTriangle } from "lucide-react";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const BILLING_EMAIL = "billing@buddysaradhi.app";

function CheckoutContent() {
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan") || "growth";
  const tenantId = searchParams.get("tenantId") || "";

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(
    `Hello, I would like to upgrade my BuddySaradhi subscription to the ${
      plan === "growth" ? "Growth" : "Institute"
    } plan. Please contact me with the payment link.`
  );

  const planName = plan === "growth" ? "Growth Plan" : "Institute Plan";
  const planPrice = plan === "growth" ? "₹499" : "₹1,499";
  const planLimit = plan === "growth" ? "Up to 300 students" : "Unlimited students";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !message) {
      alert("Please fill in all fields.");
      return;
    }

    setLoading(true);

    // Manual upgrades only: hand the request to the tutor's mail client
    // addressed to billing. No server round-trip — this page is force-static.
    const subject = encodeURIComponent(`Upgrade request: ${planName}`);
    const body = encodeURIComponent(
      `${message}\n\n—\nName: ${name}\nEmail: ${email}\nPlan: ${planName}${tenantId ? `\nAccount ID: ${tenantId}` : ""}`
    );
    window.location.href = `mailto:${BILLING_EMAIL}?subject=${subject}&body=${body}`;

    await new Promise((r) => setTimeout(r, 800));
    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-in fade-in duration-500">
        <CheckCircle className="w-16 h-16 text-[var(--accent-emerald)] mb-4 animate-pulse" />
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">Request Ready!</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-2 max-w-sm">
          Your email client should have opened with the upgrade request addressed to {BILLING_EMAIL}.
          If it did not, email us manually at{" "}
          <a href={`mailto:${BILLING_EMAIL}`} className="text-[var(--accent-emerald)] underline">
            {BILLING_EMAIL}
          </a>
          .
        </p>
        <a
          href={`${APP_URL}/?screen=settings`}
          className="inline-flex min-h-[44px] items-center px-6 mt-6 rounded-xl bg-[var(--accent-emerald)] text-black font-bold text-sm no-underline hover:brightness-110 transition-all"
        >
          Return to Settings
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-md w-full mx-auto glass-strong border border-[var(--border-glass)] rounded-3xl p-8 relative overflow-hidden shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
      
      {/* Glow effect */}
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full filter blur-[60px] opacity-10 bg-[var(--accent-emerald)]" />
      
      <button
        onClick={() => window.location.href = `${APP_URL}/?screen=settings`}
        className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Cancel & Return
      </button>

      <div className="mb-6">
        <span className="chip chip-warning mb-2 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> Online Payments Disabled
        </span>
        <h2 className="text-2xl font-bold text-[var(--text-primary)] font-[family-name:var(--font-heading)]">{planName}</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">{planLimit}</p>
        <div className="text-3xl font-extrabold text-[var(--accent-emerald)] mt-3">
          {planPrice}
          <span className="text-xs font-normal text-[var(--text-muted)] font-[family-name:var(--font-body)]">/month</span>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-4 mb-6 border border-[var(--border-glass)] text-xs text-[var(--text-secondary)] leading-relaxed">
        <p className="font-semibold text-[var(--text-primary)] mb-1">Manual Upgrades Only:</p>
        Online checkout is currently disabled. Please submit the form below to contact us and complete your plan upgrade.
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Your Name</label>
          <input
            type="text"
            required
            placeholder="Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="neumo-inset w-full px-4 py-3 text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-emerald)] focus:ring-1 focus:ring-[var(--accent-emerald)]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Email Address</label>
          <div className="relative">
            <input
              type="email"
              required
              placeholder="tutor@academy.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="neumo-inset w-full pl-10 pr-4 py-3 text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-emerald)] focus:ring-1 focus:ring-[var(--accent-emerald)]"
            />
            <Mail className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-3.5" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Request details</label>
          <div className="relative">
            <textarea
              required
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="neumo-inset w-full pl-10 pr-4 py-3 text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-emerald)] focus:ring-1 focus:ring-[var(--accent-emerald)]"
            />
            <MessageSquare className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-3.5" />
          </div>
        </div>

        <div className="pt-4">
          <button
            type="submit"
            disabled={loading}
            className="w-full neumo-raised py-3.5 rounded-xl text-base font-bold text-[var(--accent-emerald)] shadow-[0_0_14px_rgba(0,255,157,0.25)] hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Opening Email Client...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Submit Request (Upgrade to {planName})
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <main className="relative min-h-screen w-full flex items-center justify-center bg-[var(--bg-cosmic)] px-6 py-12">
      {/* Liquid Glass Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 bg-[#060414]">
        <div className="absolute top-[10%] left-[10%] w-[35vw] h-[35vw] rounded-full filter blur-[100px] opacity-[0.12] bg-[#00FF9D]" />
        <div className="absolute bottom-[10%] right-[10%] w-[40vw] h-[40vw] rounded-full filter blur-[120px] opacity-[0.12] bg-[#00F0FF]" />
      </div>

      <div className="relative z-10 w-full">
        <Suspense fallback={
          <div className="flex flex-col items-center justify-center min-h-[40vh]">
            <Loader2 className="w-10 h-10 animate-spin text-[var(--accent-emerald)]" />
          </div>
        }>
          <CheckoutContent />
        </Suspense>
      </div>
    </main>
  );
}
