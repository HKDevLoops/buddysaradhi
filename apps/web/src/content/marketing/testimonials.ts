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
    tier: "Institute",
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
    tier: "Institute",
    quote: "I run a small institute with 3 co-tutors. We tried 4 different apps in 2 years. Buddysaradhi is the first one we all use, every day. The Institute tier at ₹999/mo is 1/6 of what we paid the school ERP.",
    rating: 5,
    initials: "VD",
    gradientStart: "--accent-cyan",
    gradientEnd: "--accent-violet"
  }
];
