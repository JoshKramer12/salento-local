import type { UserRole } from "@prisma/client";

export const PRIMARY_ADMIN_USERNAME = "josh";

export function normalizeAdminUsername(value: string) {
  return value.trim().toLowerCase();
}

export function isPrimaryAdminUsername(username: string | null | undefined) {
  return normalizeAdminUsername(username ?? "") === PRIMARY_ADMIN_USERNAME;
}

export function canUsePrimaryAdminUsername(
  viewer:
    | {
        role?: UserRole | string | null;
        username?: string | null;
      }
    | null
    | undefined,
  requestedUsername: string,
) {
  if (!isPrimaryAdminUsername(requestedUsername)) {
    return true;
  }

  return (
    viewer?.role === "ADMIN" &&
    isPrimaryAdminUsername(viewer.username)
  );
}

export function isAdminViewer(
  viewer:
    | {
        role?: UserRole | string | null;
        username?: string | null;
      }
    | null
    | undefined,
) {
  if (!viewer) {
    return false;
  }

  return viewer.role === "ADMIN";
}
