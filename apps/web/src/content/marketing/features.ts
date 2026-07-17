import { LucideIcon, LayoutDashboard, Users, CalendarCheck, IndianRupee, Settings, Search, Bell, BookOpen, FileText, Smartphone, RefreshCw, Shield } from "lucide-react";

export type Accent = "emerald" | "cyan" | "amber" | "flare" | "violet";

export interface FeatureScreen {
  id: string;
  name: string;
  eyebrow: string;
  lead: string;
  accent: Accent;
  icon: LucideIcon;
  bullets: string[];
  link: string;
  screenshot: string;
}

export interface EngineFeature {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  specLink: string;
}

export const SCREENS: FeatureScreen[] = [
  {
    id: "dashboard",
    name: "Dashboard",
    eyebrow: "THE FIRST SCREEN YOU SEE",
    lead: "Open Buddysaradhi and the dashboard answers three questions: how much did I collect this month, how many students showed up this week, and what's on today. No menus. No setup. Just answers.",
    accent: "emerald",
    icon: LayoutDashboard,
    bullets: [
      "Today at a glance — batches, attendance, fees collected.",
      "Monthly KPIs — ₹1,24,500 collected, 33/38 present, 3 upcoming dues.",
      "Sparkline trend — last 12 weeks, one look."
    ],
    link: "/dashboard",
    screenshot: "/dashboard-demo.png"
  },
  {
    id: "students",
    name: "Students",
    eyebrow: "EVERY STUDENT, ONE TAP AWAY",
    lead: "A searchable, sortable list of every student you teach — across batches, across years. Tap once to mark attendance. Tap once to record a fee. Tap once to see their full history.",
    accent: "cyan",
    icon: Users,
    bullets: [
      "Smart search — name, phone, parent, batch, any field.",
      "Per-student timeline — attendance, fees, notes, all in one view.",
      "Bulk import — CSV from your existing sheet, 100 students in 30 seconds."
    ],
    link: "/students",
    screenshot: "/students-demo.png"
  },
  {
    id: "attendance",
    name: "Attendance",
    eyebrow: "38 STUDENTS, 20 SECONDS",
    lead: "Tap once per student. Present, absent, late, excused. The ledger writes itself. Locked after 24 hours — your records are tamper-evident. Works without internet.",
    accent: "cyan", 
    icon: CalendarCheck,
    bullets: [
      "One-tap marking — present, absent, late, excused.",
      "24-hour lock — no silent edits after the window closes.",
      "Offline-first — mark in a basement with no WiFi, sync when you're back."
    ],
    link: "/attendance",
    screenshot: "/attendance-demo.png"
  },
  {
    id: "fees",
    name: "Fees & Payments",
    eyebrow: "EVERY FEE. EVERY RECEIPT. ONE LEDGER.",
    lead: "Record a payment, get a receipt with a tamper-evident hash. Void a wrong entry, the ledger keeps the audit trail. Export a month's collection in one click. No spreadsheet ever again.",
    accent: "emerald",
    icon: IndianRupee,
    bullets: [
      "Append-only ledger — payments are recorded, never silently edited.",
      "Receipts with hashes — screenshot, forward on WhatsApp, prove it was paid.",
      "Void with reason — corrections are auditable, not hidden."
    ],
    link: "/fees",
    screenshot: "/fees-demo.png"
  },
  {
    id: "settings",
    name: "Settings",
    eyebrow: "YOUR DATA, YOUR RULES",
    lead: "Configure batches, fee structures, academic year. Export an encrypted backup to a pen drive. Restore on a new device. Toggle biometric login. Change your reminder cadence. Everything in one place.",
    accent: "violet",
    icon: Settings,
    bullets: [
      "Encrypted backup — AES-256-GCM, Argon2id password, .buddysaradhi file.",
      "Biometric login — fingerprint or Face ID, never a password to forget.",
      "Reminder cadence — daily, weekly, or 'leave me alone.'"
    ],
    link: "/settings",
    screenshot: "/settings-demo.png"
  }
];

export const ENGINES: EngineFeature[] = [
  {
    id: "search",
    name: "Search",
    description: "Indexed search across students, batches, ledger entries — any field, sub-50ms.",
    icon: Search,
    specLink: "#"
  },
  {
    id: "reminder",
    name: "Reminder",
    description: "Local push notifications for fees-due-tomorrow, attendance-not-marked, low-balance.",
    icon: Bell,
    specLink: "#"
  },
  {
    id: "ledger",
    name: "Ledger",
    description: "Append-only, hash-chained fees ledger. VOIDs not edits. Tamper-evident.",
    icon: BookOpen,
    specLink: "#"
  },
  {
    id: "report",
    name: "Report",
    description: "One-click PDF/CSV exports — monthly collection, attendance summary, student history.",
    icon: FileText,
    specLink: "#"
  },
  {
    id: "notification",
    name: "Notification",
    description: "Local notifications only, no server push. Privacy-preserving by design.",
    icon: Smartphone,
    specLink: "#"
  },
  {
    id: "sync",
    name: "Sync",
    description: "30-second libSQL HTTP polling, last-write-wins for non-ledger, append-only for ledger.",
    icon: RefreshCw,
    specLink: "#"
  },
  {
    id: "security",
    name: "Security",
    description: "Biometric at rest, AES-256-GCM backups, no telemetry, no third-party APIs.",
    icon: Shield,
    specLink: "#"
  }
];
