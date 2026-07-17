import React from "react";

export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      data-palette="aurora-cosmic"
      data-theme="dark"
      className="min-h-screen"
    >
      {children}
    </div>
  );
}
