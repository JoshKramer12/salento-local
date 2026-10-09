import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { LocaleTransitionOverlay } from "@/components/locale-transition-overlay";
import { getViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { buildDraftLikeSubmissionWhere } from "@/lib/submission-drafts";
import { PUBLIC_SITE_URL } from "@/lib/seo";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE_URL),
  title: "Salento Local",
  description:
    "Trova comuni, spiagge, ristoranti, servizi e luoghi utili in tutto il Salento.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, viewer] = await Promise.all([getCurrentLocale(), getViewer()]);
  const notificationCount = viewer
    ? await prisma.businessSubmission.count({
        where: buildDraftLikeSubmissionWhere(viewer.id),
      })
    : 0;

  return (
    <html
      lang={locale}
      data-scroll-behavior="smooth"
      className="h-full scroll-smooth"
    >
      <body className="min-h-full bg-background text-foreground antialiased">
        <div className="min-h-screen">
          <LocaleTransitionOverlay locale={locale} />
          <SiteHeader
            locale={locale}
            notificationCount={notificationCount}
            viewer={viewer}
          />
          <main>{children}</main>
          <SiteFooter locale={locale} />
        </div>
      </body>
    </html>
  );
}
