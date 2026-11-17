import type { UserRole } from "@prisma/client";

export function earningsAccessForRole(role: UserRole) {
  if (role === "GETTER") return "partner";
  if (role === "ADMIN") return "admin";
  return "redirect";
}
