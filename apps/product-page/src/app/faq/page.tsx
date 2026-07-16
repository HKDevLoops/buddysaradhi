import React from "react";
import { FAQSection } from "@/components/marketing/faq-section";
import { MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata = {
  title: "Frequently Asked Questions — BuddySaradhi",
  description: "Get answers to pricing, offline support, billing, data privacy, and security questions about BuddySaradhi.",
};

export default function FAQPage() {
  return (
    <MarketingLayout>
      <div className="container mx-auto px-4 max-w-5xl">
        <FAQSection />
      </div>
    </MarketingLayout>
  );
}
