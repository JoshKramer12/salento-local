import { IconMapPin } from "@tabler/icons-react";

import { HardNavigationLink } from "@/components/hard-navigation-link";
import type { Locale } from "@/lib/i18n";

type SiteFooterProps = { locale: Locale };

export function SiteFooter({ locale }: SiteFooterProps) {
  const copy = locale === "it" ? {
    business: "Per le attività", businessLinks: [["Aggiungi la tua attività", "/signup/business"], ["Accedi", "/login"]],
    directory: "Directory", discover: "Scopri il Salento", explore: "Esplora", legal: "Legale", localities: "Località", madeIn: "Fatto in Salento, Puglia · Italia", partner: "Per i Partner", partnerLinks: [["Guadagna con noi", "/earn"]], privacy: "Informativa sulla Privacy", terms: "Termini e Condizioni", towns: "Comuni",
  } : {
    business: "For businesses", businessLinks: [["List your business", "/signup/business"], ["Log in", "/login"]],
    directory: "Directory", discover: "Discover Salento", explore: "Explore", legal: "Legal", localities: "Localities", madeIn: "Made in Salento, Puglia · Italy", partner: "For partners", partnerLinks: [["Earn with us", "/earn"]], privacy: "Privacy Policy", terms: "Terms & Conditions", towns: "Towns",
  };
  const exploreLinks = [[copy.explore, "/explore"], [copy.towns, "/towns"], [copy.localities, "/localities"], [copy.directory, "/directory"]];
  const legalLinks = [[copy.terms, "/terms"], [copy.privacy, "/privacy"], ["Cookie Policy", "/cookies"]];

  return (
    <footer className="mt-12 bg-[var(--primary)] text-white sm:mt-16">
      <div className="shell px-4 py-10 sm:px-6 sm:py-12">
        <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))] sm:gap-7">
          <div className="col-span-2 max-w-52 sm:col-span-1">
            <HardNavigationLink href="/" className="inline-flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15"><IconMapPin size={16} /></span>
              <span className="font-serif text-lg">Salento<span className="ml-0.5 italic text-[#f3b28d]">Local</span></span>
            </HardNavigationLink>
            <p className="mt-4 text-sm leading-6 text-white/70">{copy.discover}</p>
          </div>
          <FooterGroup label={copy.explore} links={exploreLinks} />
          <FooterGroup label={copy.business} links={copy.businessLinks} />
          <FooterGroup label={copy.partner} links={copy.partnerLinks} />
          <FooterGroup label={copy.legal} links={legalLinks} />
        </div>
        <div className="mt-9 flex flex-col gap-2 border-t border-white/15 pt-5 text-xs text-white/60 sm:mt-10 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Salento Local. All rights reserved.</span>
          <span>{copy.madeIn}</span>
        </div>
      </div>
    </footer>
  );
}

function FooterGroup({ label, links }: { label: string; links: string[][] }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/75">{label}</h2>
      <div className="mt-3 grid gap-2 text-sm text-white/70">
        {links.map(([name, href]) => <HardNavigationLink key={href} href={href} className="transition-colors hover:text-white">{name}</HardNavigationLink>)}
      </div>
    </div>
  );
}
