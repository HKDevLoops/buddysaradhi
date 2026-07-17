export interface FAQItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  linkSpec?: string;
}

export interface FAQCategory {
  id: string;
  name: string;
  items: FAQItem[];
}

export const FAQ_TOP_FIVE: FAQItem[] = [
  {
    id: "faq-pb-1",
    category: "Pricing & Billing",
    question: "Is the Free tier really free forever?",
    answer: "Yes. Free forever, up to 25 students, all features. No card. No trial. No \"upgrade to keep using.\" You will not be asked to pay until you cross 25 students — and even then, you can stay on Free with 25 students forever. We make money when you grow, not when you sign up.",
    linkSpec: "05_Pricing_and_Plans.md §1.1"
  },
  {
    id: "faq-sb-1",
    category: "Sync & Backup",
    question: "Does it work without internet?",
    answer: "Yes. Buddysaradhi is offline-first. Every write (add student, mark attendance, record fee, void entry, change setting) goes to your local database first. The sync engine pushes changes to Turso when you reconnect — every 30 seconds on web/desktop, every 30 seconds when foregrounded on mobile.",
    linkSpec: "01_Product_Principles.md P5"
  },
  {
    id: "faq-dp-2",
    category: "Data & Privacy",
    question: "Is my data safe? Do you sell it?",
    answer: "Your data is yours. We do not sell it, do not share it with third parties, do not run analytics on it. Backups are AES-256-GCM encrypted. The only network call is to your per-user database on Turso (Mumbai region).",
    linkSpec: "10_Security.md §17"
  },
  {
    id: "faq-dp-5",
    category: "Data & Privacy",
    question: "Can I export my data if I stop using Buddysaradhi?",
    answer: "Yes. Settings → Backup → Export. You get a .buddysaradhi file — a single encrypted envelope containing your entire database. The file is AES-256-GCM encrypted with a password you choose. You can restore from it on a new device.",
    linkSpec: "09_Backup_and_Import_Export.md"
  },
  {
    id: "faq-pd-1",
    category: "Platforms & Downloads",
    question: "What platforms does it work on?",
    answer: "Five: web (any modern browser), macOS, Windows, Android, iOS. All five sync to the same per-user database. Pick the platform you use most — you can switch any time.",
    linkSpec: "00_Vision.md §16"
  }
];

export const FAQ_CATEGORIES: FAQCategory[] = [
  {
    id: "getting-started",
    name: "Getting Started",
    items: [
      {
        id: "faq-gs-1",
        category: "Getting Started",
        question: "What is Buddysaradhi?",
        answer: "Buddysaradhi is the operating system for private tutors and small coaching institutes. Five screens — Dashboard, Students, Attendance, Fees, Settings. Seven engines under the hood. One append-only ledger. Zero servers to manage.",
        linkSpec: "01_Product_Positioning.md §1"
      },
      {
        id: "faq-gs-2",
        category: "Getting Started",
        question: "How is this different from a school ERP?",
        answer: "School ERPs are built for principals — 200 features, 12 modules, 4-week onboarding. Buddysaradhi is built for tutors — 5 screens, 7 engines, 90-second onboarding. A school ERP does timetabling, transport, parent portals with 500 logins. Buddysaradhi does attendance, fees, receipts — and does them well.",
        linkSpec: "01_Product_Positioning.md §4.1"
      },
      {
        id: "faq-gs-4",
        category: "Getting Started",
        question: "How long does it take to set up?",
        answer: "About 90 seconds. Sign up with your email + OTP. You land on an empty Dashboard. Add your first student. Mark today's attendance. Record your first fee. You are now using Buddysaradhi. No configuration, no batch setup — those happen inline when you need them.",
        linkSpec: "web/03_Auth_and_Provisioning.md"
      }
    ]
  },
  {
    id: "pricing-billing",
    name: "Pricing & Billing",
    items: [
      {
        id: "faq-pb-1",
        category: "Pricing & Billing",
        question: "Is the Free tier really free forever?",
        answer: "Yes. Free forever, up to 25 students, all features. No card. No trial. No \"upgrade to keep using.\" You will not be asked to pay until you cross 25 students — and even then, you can stay on Free with 25 students forever. We make money when you grow, not when you sign up.",
        linkSpec: "05_Pricing_and_Plans.md §1.1"
      },
      {
        id: "faq-pb-2",
        category: "Pricing & Billing",
        question: "What happens when I cross 25 students on Free?",
        answer: "On adding your 26th student, a paywall modal appears: \"You've reached the Free tier limit. Upgrade to Pro for ₹299/mo for unlimited students.\" You can upgrade or skip (the 26th student is not added; your 25 existing students continue working).",
        linkSpec: "05_Pricing_and_Plans.md §4.4"
      },
      {
        id: "faq-pb-3",
        category: "Pricing & Billing",
        question: "Can I cancel anytime? Is there a refund?",
        answer: "Yes and yes. Cancel anytime from Settings → Billing → Cancel. Within 7 days of payment, full refund, no questions — email hello@buddysaradhi.app or use the \"Request refund\" button in Settings → Billing.",
        linkSpec: "05_Pricing_and_Plans.md §3.3"
      }
    ]
  },
  {
    id: "data-privacy",
    name: "Data & Privacy",
    items: [
      {
        id: "faq-dp-2",
        category: "Data & Privacy",
        question: "Is my data safe? Do you sell it?",
        answer: "Your data is yours. We do not sell it, do not share it with third parties, do not run analytics on it. Backups are AES-256-GCM encrypted. The only network call is to your per-user database on Turso (Mumbai region).",
        linkSpec: "10_Security.md §17"
      },
      {
        id: "faq-dp-5",
        category: "Data & Privacy",
        question: "Can I export my data if I stop using Buddysaradhi?",
        answer: "Yes. Settings → Backup → Export. You get a .buddysaradhi file — a single encrypted envelope containing your entire database. The file is AES-256-GCM encrypted with a password you choose. You can restore from it on a new device.",
        linkSpec: "09_Backup_and_Import_Export.md"
      }
    ]
  },
  {
    id: "sync-backup",
    name: "Sync & Backup",
    items: [
      {
        id: "faq-sb-1",
        category: "Sync & Backup",
        question: "Does it work without internet?",
        answer: "Yes. Buddysaradhi is offline-first. Every write (add student, mark attendance, record fee, void entry, change setting) goes to your local database first. The sync engine pushes changes to Turso when you reconnect — every 30 seconds on web/desktop, every 30 seconds when foregrounded on mobile.",
        linkSpec: "01_Product_Principles.md P5"
      },
      {
        id: "faq-sb-3",
        category: "Sync & Backup",
        question: "What if my phone dies?",
        answer: "Your data is safe. It is in your Turso database, which is replicated across Turso's multi-region cluster. Install Buddysaradhi on a new phone, sign in with the same email, and your data syncs down in ~10 seconds.",
        linkSpec: "12_Business_Rules.md §BR-SYN-09"
      }
    ]
  },
  {
    id: "platforms-downloads",
    name: "Platforms & Downloads",
    items: [
      {
        id: "faq-pd-1",
        category: "Platforms & Downloads",
        question: "What platforms does Buddysaradhi work on?",
        answer: "Five: web (any modern browser), macOS, Windows, Android, iOS. All five sync to the same per-user database. Pick the platform you use most — you can switch any time.",
        linkSpec: "00_Vision.md §16"
      }
    ]
  },
  {
    id: "account-security",
    name: "Account & Security",
    items: [
      {
        id: "faq-as-1",
        category: "Account & Security",
        question: "How do I log in?",
        answer: "Email + OTP. Enter your email at signup or login, we send a 6-digit OTP to your inbox. Enter the OTP, you're in. No passwords in v1. After signup, you can enable biometric login (fingerprint, Face ID, Windows Hello) so you don't need to OTP every time.",
        linkSpec: "web/03_Auth_and_Provisioning.md"
      }
    ]
  }
];
