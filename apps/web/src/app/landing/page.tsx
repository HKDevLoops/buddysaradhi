import React from "react";
import { redirect } from "next/navigation";

export default function DeprecatedLandingPage() {
  // Automatically redirect to the root page, which bounces the user to /login
  redirect("/");
  return null;
}
