import { redirect } from "next/navigation";

import { isAdminViewer } from "@/lib/admin";
import { auth } from "@/lib/auth";

export async function getViewer() {
  const session = await auth();
  return session?.user?.id ? session.user : null;
}

export async function requireViewer() {
  const viewer = await getViewer();

  if (!viewer) {
    redirect("/login");
  }

  return viewer;
}

export async function requireCompletedViewer() {
  const viewer = await requireViewer();

  if (!viewer.profileCompleted) {
    redirect("/complete-profile");
  }

  return viewer;
}

export async function requireAdminViewer() {
  const viewer = await requireCompletedViewer();

  if (!isAdminViewer(viewer)) {
    redirect("/dashboard");
  }

  return viewer;
}
