import { redirect } from "next/navigation";

export default function DeprecatedPrivacyPage() {
  redirect("/");
  return null;
}
