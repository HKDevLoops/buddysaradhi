"use client";

import { HelpCircle, Book, MessageCircle, Lightbulb } from "lucide-react";

export function HelpSection() {
  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-[var(--text-secondary)]" />
          Support & Resources
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <a href="/faq" target="_blank" rel="noopener noreferrer" className="glass-card p-5 rounded-xl flex items-start gap-4 btn-glass bg-[var(--surface-inset)] border border-[var(--border-default)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] hover:border-[color-mix(in srgb,var(--success)_35%,transparent)] text-left transition-all cursor-pointer group">
            <div className="w-10 h-10 rounded-lg bg-[var(--success)]/10 flex items-center justify-center shrink-0">
              <Book className="w-5 h-5 text-[var(--success)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--success)] transition-colors">Documentation</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Read the user manual and guides on how to use BuddySaradhi.</p>
            </div>
          </a>
          
          <a href="/faq#requests" target="_blank" rel="noopener noreferrer" className="glass-card p-5 rounded-xl flex items-start gap-4 btn-glass bg-[var(--surface-inset)] border border-[var(--border-default)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] hover:border-[color-mix(in srgb,var(--info)_35%,transparent)] text-left transition-all cursor-pointer group">
            <div className="w-10 h-10 rounded-lg bg-[var(--info)]/10 flex items-center justify-center shrink-0">
              <Lightbulb className="w-5 h-5 text-[var(--info)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--info)] transition-colors">Feature Requests</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Have an idea? Let us know what we should build next.</p>
            </div>
          </a>
          
          <a href="/faq#community" target="_blank" rel="noopener noreferrer" className="glass-card p-5 rounded-xl flex items-start gap-4 btn-glass bg-[var(--surface-inset)] border border-[var(--border-default)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] hover:border-[color-mix(in srgb,var(--info)_35%,transparent)] text-left transition-all cursor-pointer group">
            <div className="w-10 h-10 rounded-lg bg-[var(--info)]/10 flex items-center justify-center shrink-0">
              <MessageCircle className="w-5 h-5 text-[var(--info)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--info)] transition-colors">Community Forum</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Connect with other tutors and share best practices.</p>
            </div>
          </a>
        </div>
      </div>
    </section>
  );
}
