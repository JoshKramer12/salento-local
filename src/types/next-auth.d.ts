import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      email: string;
      id: string;
      phone: string;
      profileCompleted: boolean;
      role: UserRole;
      username: string;
    };
  }

  interface User {
    email: string;
    phone: string;
    profileCompleted: boolean;
    role: UserRole;
    username: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    email?: string;
    id?: string;
    phone?: string;
    profileCompleted?: boolean;
    role?: UserRole;
    sessionVersion?: number;
    username?: string;
  }
}
