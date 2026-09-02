"use server";

import { signOut } from "@/lib/auth";
import { getSafeInternalRedirect } from "@/lib/redirects";

export async function signOutAction(formData?: FormData) {
  const rawRedirectTo = formData?.get("redirectTo");
  const redirectTo = getSafeInternalRedirect(
    typeof rawRedirectTo === "string" ? rawRedirectTo : null,
  );
  await signOut({
    redirectTo: redirectTo ?? "/",
  });
}
