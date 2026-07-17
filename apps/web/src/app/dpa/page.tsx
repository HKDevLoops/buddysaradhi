import { redirect } from "next/navigation";

export default function DeprecatedDPAPage() {
  redirect("/");
  return null;
}
