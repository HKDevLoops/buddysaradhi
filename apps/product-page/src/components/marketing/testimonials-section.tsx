"use client";

import React from "react";
import { WORKFLOW_HIGHLIGHTS } from "@/content/marketing/testimonials";
import { ShieldCheck, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function TestimonialsSection() {
  return (
    <section id="features-highlights" className="relative z-10 mx-auto max-w-6xl px-6 py-24 border-t border-[var(--border-glass)]">
      <div className="text-center max-w-2xl mx-auto mb-16">
        <span className="chip chip-success mb-4">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
          Engine Guarantees
        </span>
        <h2 className="font-[family-name:var(--font-heading)] text-4xl md:text-5xl font-semibold tracking-tight text-[var(--text-primary)]">
          Built for Private Tutors & Institutes
        </h2>
        <p className="mt-4 text-[var(--text-secondary)]">
          Every engine in BuddySaradhi is engineered to guarantee zero financial drift, instant attendance tracking, and complete offline sovereignty.
        </p>
      </div>

      {/* Workflow Highlights Grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {WORKFLOW_HIGHLIGHTS.map((item: (typeof WORKFLOW_HIGHLIGHTS)[number]) => {
          return (
            <div
              key={item.id}
              className="glass border border-[var(--border-glass)] hover:border-[var(--border-strong)] bg-[var(--surface-glass-faint)] hover:bg-[var(--surface-glass)] transition-all duration-300 rounded-2xl p-6 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="px-2.5 py-1 rounded-md bg-[var(--surface-glass-strong)] text-[var(--accent-cyan)] font-mono text-xs">
                    {item.category}
                  </span>
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-[var(--text-on-accent)]"
                    style={{ background: item.accentColor }}
                  >
                    {item.initials}
                  </div>
                </div>

                <h3 className="font-[family-name:var(--font-heading)] text-xl font-bold text-[var(--text-primary)] mb-2">
                  {item.title}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
                  {item.summary}
                </p>
              </div>

              <div className="border-t border-[var(--border-glass)]/25 pt-4 space-y-2 text-xs">
                <div className="flex items-center gap-2 text-[var(--text-primary)] font-medium">
                  <CheckCircle2 className="w-4 h-4 text-[var(--accent-emerald)] shrink-0" />
                  <span>{item.feature}</span>
                </div>
                <p className="text-[var(--text-muted)] pl-6">{item.benefit}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
