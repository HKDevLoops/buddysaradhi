"use client";

import React from "react";
import { TESTIMONIALS, Testimonial } from "@/content/marketing/testimonials";
import { Star, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export function TestimonialsSection() {
  return (
    <section id="testimonials" className="relative z-10 mx-auto max-w-6xl px-6 py-24 border-t border-[var(--border-glass)]">
      <div className="text-center max-w-2xl mx-auto mb-16">
        <span className="chip chip-success mb-4">
          <span className="chip-dot" aria-hidden="true" />
          Tutor Trust
        </span>
        <h2 className="font-[family-name:var(--font-heading)] text-4xl md:text-5xl font-semibold tracking-tight text-[var(--text-primary)]">
          Join 1,000+ tutors across India
        </h2>
        <p className="mt-4 text-[var(--text-secondary)]">
          Tutors, NEET/JEE coaches, and academy owners share how BuddySaradhi simplifies their daily batch management, ledger bookkeeping, and student records.
        </p>
      </div>

      {/* Grid Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {TESTIMONIALS.map((t) => {
          return (
            <div
              key={t.id}
              className="glass border border-[var(--border-glass)] hover:border-[var(--border-strong)] bg-[var(--surface-glass-faint)] hover:bg-[var(--surface-glass)] transition-all duration-300 rounded-2xl p-6 flex flex-col justify-between"
            >
              <div>
                {/* Rating & Initials */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex gap-1">
                    {Array.from({ length: t.rating }).map((_, idx) => (
                      <Star key={idx} className="w-4 h-4 fill-[var(--accent-amber)] text-[var(--accent-amber)]" />
                    ))}
                  </div>
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-[var(--text-on-accent)]"
                    )}
                    style={{
                      background: `linear-gradient(135deg, var(${t.gradientStart}), var(${t.gradientEnd}))`,
                    }}
                  >
                    {t.initials}
                  </div>
                </div>

                {/* Quote */}
                <p className="text-sm md:text-base text-[var(--text-secondary)] leading-relaxed italic mb-6">
                  &ldquo;{t.quote}&rdquo;
                </p>
              </div>

              {/* Profile details */}
              <div className="border-t border-[var(--border-glass)]/25 pt-4 flex justify-between items-center text-xs">
                <div>
                  <h4 className="font-bold text-[var(--text-primary)]">{t.name}</h4>
                  <p className="text-[var(--text-muted)]">{t.city}</p>
                </div>
                <div className="text-right">
                  <span className="inline-block px-2 py-0.5 rounded-full bg-[var(--surface-glass-strong)] text-[var(--accent-cyan)] font-semibold text-[10px] tracking-wide mb-1">
                    {t.tier}
                  </span>
                  <p className="text-[var(--text-muted)] font-medium">{t.students} students</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
