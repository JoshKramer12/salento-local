import bcrypt from "bcryptjs";
import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { prisma } from "@/lib/prisma";
import {
  clearSecurityRateLimit,
  consumeSecurityRateLimit,
  getRequestClientAddress,
} from "@/lib/security-rate-limit";
import { normalizeEmail, normalizeUsername } from "@/lib/validation";

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    maxAge: 60 * 60 * 24 * 30,
    strategy: "jwt",
    updateAge: 60 * 60 * 24,
  },
  providers: [
    Credentials({
      credentials: {
        identifier: { label: "Email or username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const identifier = `${credentials.identifier ?? ""}`.trim();
        const password = `${credentials.password ?? ""}`;

        if (!identifier || !password) {
          return null;
        }

        const clientAddress = getRequestClientAddress(request.headers);
        const rateLimit = await consumeSecurityRateLimit({
          clientAddress,
          limit: 10,
          namespace: "credential-login",
          subject: identifier,
          windowMs: 15 * 60 * 1000,
        });

        if (!rateLimit.allowed) {
          return null;
        }

        const user = identifier.includes("@")
          ? await (async () => {
              const email = normalizeEmail(identifier);
              const exactMatch = await prisma.user.findUnique({ where: { email } });
              if (exactMatch) return exactMatch;
              const matches = await prisma.$queryRaw<Array<{ id: string }>>`
                SELECT "id" FROM "User" WHERE lower("email") = ${email} LIMIT 1
              `;
              return matches[0]
                ? await prisma.user.findUnique({ where: { id: matches[0].id } })
                : null;
            })()
          : await prisma.user.findFirst({ where: { username: normalizeUsername(identifier) } });

        if (!user?.passwordHash) {
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);

        if (!isValid) {
          return null;
        }

        await clearSecurityRateLimit({
          clientAddress,
          namespace: "credential-login",
          subject: identifier,
        });

        return user;
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  trustHost: true,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }

      const userId = typeof token.id === "string" ? token.id : "";

      if (!userId) {
        return token;
      }

      return prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          id: true,
          image: true,
          name: true,
          profileCompleted: true,
          role: true,
          sessionVersion: true,
          username: true,
        },
      }).then((currentUser) => {
        // A missing account or a changed session version makes any copied JWT
        // unusable. Role/profile values are also refreshed on every access so
        // a demotion cannot retain stale authorization.
        if (
          !currentUser ||
          (typeof token.sessionVersion === "number" &&
            token.sessionVersion !== currentUser.sessionVersion)
        ) {
          delete token.email;
          delete token.id;
          delete token.name;
          delete token.picture;
          delete token.profileCompleted;
          delete token.role;
          delete token.sessionVersion;
          delete token.username;
          return token;
        }

        token.email = currentUser.email;
        token.id = currentUser.id;
        token.name = currentUser.name;
        token.picture = currentUser.image;
        token.profileCompleted = currentUser.profileCompleted;
        token.role = currentUser.role;
        token.sessionVersion = currentUser.sessionVersion;
        token.username = currentUser.username;
        return token;
      });
    },
    session({ session, token }) {
      const sessionUser = session.user;

      if (!sessionUser) {
        return session;
      }

      if (!token.id) {
        sessionUser.email = "";
        sessionUser.id = "";
        sessionUser.image = null;
        sessionUser.name = null;
        sessionUser.profileCompleted = false;
        sessionUser.role = "USER";
        sessionUser.username = "";
        return session;
      }

      sessionUser.email = `${token.email ?? ""}`;
      sessionUser.id = `${token.id ?? ""}`;
      sessionUser.image = typeof token.picture === "string" ? token.picture : null;
      sessionUser.name = typeof token.name === "string" ? token.name : null;
      sessionUser.profileCompleted = Boolean(token.profileCompleted);
      sessionUser.role = `${token.role ?? "USER"}` as typeof sessionUser.role;
      sessionUser.username = `${token.username ?? ""}`;

      return session;
    },
  },
});
