import { redirect } from "next/navigation";

import { requireCompletedViewer } from "@/lib/auth-guards";

// Legacy links land in the guided form. Claim Business remains available on
// public eligible listings and through its dedicated route.
export default async function BusinessOnboardingPage() {
  const viewer = await requireCompletedViewer();
  if (viewer.role !== "BUSINESS_OWNER" && viewer.role !== "ADMIN") {
    redirect("/dashboard");
  }

  redirect("/publish");
}
