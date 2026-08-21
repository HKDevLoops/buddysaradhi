export interface Testimonial {
  id: string;
  name: string;
  city: string;
  subject: string;
  students: number;
  tier: string;
  quote: string;
  rating: number;
  initials: string;
  gradientStart: string;
  gradientEnd: string;
}

export const WORKFLOW_HIGHLIGHTS = [
  {
    id: "attendance-engine",
    category: "01 / Attendance",
    title: "20-Second Batch Marking",
    summary: "Mark 38 students present in 20 seconds with single-tap batch operations and automatic 24-hour locking.",
    feature: "24-hour lock guarantee",
    benefit: "Prevents post-facto disputes with audit trail",
    accentColor: "var(--accent-emerald)",
    initials: "✓",
  },
  {
    id: "ledger-engine",
    category: "02 / Ledger",
    title: "Zero-Drift Finance",
    summary: "Integer-paise ledger with HMAC-SHA256 chain — every fee maps to exact receipts, voids as new rows.",
    feature: "Append-only immutable",
    benefit: "No reconcile drift, even at 200 students",
    accentColor: "var(--accent-cyan)",
    initials: "₹",
  },
  {
    id: "sovereign-engine",
    category: "03 / Sovereign",
    title: "Offline-First Sync",
    summary: "Every mutation writes to sync_outbox in same transaction — works offline, syncs on reconnect.",
    feature: "Offline-first + sovereign",
    benefit: "No data loss when phone is stolen",
    accentColor: "var(--accent-violet)",
    initials: "◈",
  },
];

export const TESTIMONIALS: Testimonial[] = [
  {
    id: "riya-sharma",
    name: "Riya Sharma",
    city: "Nagpur, MH",
    subject: "Mathematics (Class 8–10 CBSE)",
    students: 38,
    tier: "Pro",
    quote: "I used to spend 3 hours every month reconciling fees in Excel. With Buddysaradhi, it's 20 minutes. The receipt with the hash — parents cannot argue with that.",
    rating: 5,
    initials: "RS",
    gradientStart: "--accent-emerald",
    gradientEnd: "--accent-cyan"
  },
  {
    id: "kabir-khan",
    name: "Kabir Khan",
    city: "Indore, MP",
    subject: "Physics + Chemistry (JEE)",
    students: 180,
    tier: "Pro",
    quote: "My co-tutors actually use this. The old ERP, they refused. Buddysaradhi takes 20 seconds to mark attendance, not 2 minutes. That's the difference.",
    rating: 5,
    initials: "KK",
    gradientStart: "--accent-amber",
    gradientEnd: "--accent-flare"
  },
  {
    id: "ananya-iyer",
    name: "Ananya Iyer",
    city: "Bangalore, KA",
    subject: "Spoken English (1-on-1)",
    students: 12,
    tier: "Free",
    quote: "I don't need batches. I have 12 students across India and the Gulf. Buddysaradhi handles them as individuals, with per-session attendance and per-session fees.",
    rating: 5,
    initials: "AI",
    gradientStart: "--accent-cyan",
    gradientEnd: "--accent-violet"
  },
  {
    id: "meena-pillai",
    name: "Meena Pillai",
    city: "Kochi, KL",
    subject: "Mathematics + Science (ICSE)",
    students: 54,
    tier: "Pro",
    quote: "The 24-hour attendance lock saved me twice. A parent tried to claim their child was present on a day I marked absent — the audit trail showed the entry was locked within 24 hours.",
    rating: 5,
    initials: "MP",
    gradientStart: "--accent-emerald",
    gradientEnd: "--accent-cyan"
  },
  {
    id: "vikram-deshpande",
    name: "Vikram Deshpande",
    city: "Pune, MH",
    subject: "NEET Biology",
    students: 92,
    tier: "Pro",
    quote: "I run a small institute with 3 co-tutors. We tried 4 different apps in 2 years. Buddysaradhi is the first one we all use, every day. The Pro tier at ₹299/mo is 1/6 of what we paid the school ERP.",
    rating: 5,
    initials: "VD",
    gradientStart: "--accent-cyan",
    gradientEnd: "--accent-violet"
  }
];
