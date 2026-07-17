export interface PricingTier {
  id: string;
  name: string;
  badge?: string;
  monthlyPrice: number;
  yearlyPrice: number;
  yearlySavings: number;
  description: string;
  features: string[];
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: "free",
    name: "FREE",
    monthlyPrice: 0,
    yearlyPrice: 0,
    yearlySavings: 0,
    description: "For tutors just starting out.",
    features: [
      "Up to 25 students",
      "All 5 screens",
      "Attendance + fees + receipts",
      "Encrypted backup export",
      "Cross-device sync"
    ]
  },
  {
    id: "pro",
    name: "PRO",
    badge: "Most popular",
    monthlyPrice: 299,
    yearlyPrice: 2999,
    yearlySavings: 589,
    description: "For tutors with more than 25 students.",
    features: [
      "Unlimited students",
      "All 5 screens",
      "Encrypted backup export",
      "Priority email support (24h)"
    ]
  },
  {
    id: "institute",
    name: "INSTITUTE",
    monthlyPrice: 999,
    yearlyPrice: 9999,
    yearlySavings: 1989,
    description: "For coaching institutes with multiple tutors.",
    features: [
      "Everything in Pro",
      "Up to 5 co-tutors",
      "GST invoice",
      "ROI report",
      "Priority email support (24h)"
    ]
  }
];
