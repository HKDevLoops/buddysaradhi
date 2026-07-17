"use client";

import React, { useState, useMemo } from "react";
import { FAQ_CATEGORIES, FAQ_TOP_FIVE, FAQItem } from "@/content/marketing/faq";
import Fuse from "fuse.js";
import { Search, ChevronDown, Mail, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function FAQSection() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("top-5");
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});

  // Flatten all FAQs for search
  const allFaqs = useMemo(() => {
    return FAQ_CATEGORIES.flatMap((c) => c.items);
  }, []);

  // Set up Fuse.js for fuzzy search
  const fuse = useMemo(() => {
    return new Fuse(allFaqs, {
      keys: ["question", "answer", "category"],
      threshold: 0.35,
    });
  }, [allFaqs]);

  // Determine which items to display
  const displayedItems = useMemo(() => {
    if (searchQuery.trim()) {
      return fuse.search(searchQuery).map((r) => r.item);
    }
    if (activeCategory === "top-5") {
      return FAQ_TOP_FIVE;
    }
    const cat = FAQ_CATEGORIES.find((c) => c.id === activeCategory);
    return cat ? cat.items : [];
  }, [searchQuery, activeCategory, fuse]);

  const toggleOpen = (id: string) => {
    setOpenIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <section id="faq" className="relative z-10 mx-auto max-w-4xl px-6 py-24 border-t border-[var(--border-glass)]">
      <div className="text-center max-w-2xl mx-auto mb-16">
        <span className="chip chip-neutral mb-4">FAQ</span>
        <h2 className="font-[family-name:var(--font-heading)] text-4xl md:text-5xl font-semibold tracking-tight text-[var(--text-primary)]">
          Questions, answered
        </h2>
        <p className="mt-4 text-[var(--text-secondary)]">
          Everything you need to know about pricing, security, offline support, batch handling, and more.
        </p>
      </div>

      {/* FAQ Search Bar */}
      <div className="relative max-w-lg mx-auto mb-12">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-[var(--text-muted)]">
          <Search className="w-5 h-5" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            // Switch away from Top 5 if searching, to show all matches
            if (activeCategory === "top-5" && e.target.value) {
              setActiveCategory("all");
            }
          }}
          placeholder="Search questions (e.g. offline, backup, cost)..."
          className="w-full pl-12 pr-4 py-3 bg-[var(--surface-glass)] border border-[var(--border-glass)] hover:border-[var(--border-strong)] focus:border-[var(--accent-cyan)]/60 text-sm text-[var(--text-primary)] placeholder-gray-500 rounded-2xl outline-none transition-all focus:ring-1 focus:ring-[var(--accent-cyan)]/25"
        />
      </div>

      {/* Category Tabs (Hidden if search query is active) */}
      {!searchQuery && (
        <div className="flex flex-wrap justify-center gap-2 mb-10 overflow-x-auto pb-2">
          <button
            onClick={() => setActiveCategory("top-5")}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-semibold transition-all border",
              activeCategory === "top-5"
                ? "bg-[var(--accent-cyan)] text-[var(--text-on-accent)] border-[var(--accent-cyan)]"
                : "bg-[var(--surface-glass-faint)] text-[var(--text-secondary)] border-[var(--border-glass)] hover:border-[var(--border-strong)]"
            )}
          >
            ⭐ Top 5 Questions
          </button>
          {FAQ_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                "px-4 py-2 rounded-full text-xs font-semibold transition-all border",
                activeCategory === cat.id
                  ? "bg-[var(--accent-cyan)] text-[var(--text-on-accent)] border-[var(--accent-cyan)]"
                  : "bg-[var(--surface-glass-faint)] text-[var(--text-secondary)] border-[var(--border-glass)] hover:border-[var(--border-strong)]"
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Accordion Component */}
      <div className="space-y-4 max-w-3xl mx-auto">
        {displayedItems.length > 0 ? (
          displayedItems.map((item) => {
            const isOpen = !!openIds[item.id];
            return (
              <div
                key={item.id}
                className={cn(
                  "glass rounded-2xl border transition-all duration-300 overflow-hidden",
                  isOpen
                    ? "border-[var(--accent-cyan)]/40 bg-[var(--surface-glass-strong)] shadow-[0_4px_16px_rgba(0,240,255,0.06)]"
                    : "border-[var(--border-glass)] hover:border-[var(--border-strong)] bg-[var(--surface-glass-faint)]"
                )}
              >
                <button
                  onClick={() => toggleOpen(item.id)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between px-6 py-4.5 text-left font-medium text-sm md:text-base text-[var(--text-primary)] hover:text-[var(--accent-cyan)] focus:outline-none"
                >
                  <span>{item.question}</span>
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 text-[var(--text-muted)] transition-transform duration-300 shrink-0 ml-4",
                      isOpen && "rotate-180 text-[var(--accent-cyan)]"
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="px-6 pb-5 pt-1 text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border-glass)]/30 animate-in fade-in duration-300">
                    <p>{item.answer}</p>
                    {item.linkSpec && (
                      <span className="block mt-3 text-[10px] tracking-wider text-[var(--text-muted)] font-mono">
                        Ref: {item.linkSpec}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="glass p-8 rounded-2xl border border-[var(--border-glass)] text-center max-w-md mx-auto space-y-4">
            <AlertCircle className="w-8 h-8 mx-auto text-[var(--accent-flare)]" />
            <h4 className="font-semibold text-lg text-[var(--text-primary)]">No matching questions</h4>
            <p className="text-xs text-[var(--text-secondary)]">
              We couldn&apos;t find an answer matching &ldquo;{searchQuery}&rdquo;. Drop us an email and we&apos;ll reply in under 4 hours.
            </p>
            <a
              href="mailto:hello@buddysaradhi.app"
              className="inline-flex items-center gap-1.5 text-xs text-[var(--accent-cyan)] hover:underline font-semibold"
            >
              <Mail className="w-4 h-4" />
              hello@buddysaradhi.app
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
