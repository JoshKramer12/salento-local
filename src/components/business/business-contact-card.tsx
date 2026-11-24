import {
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandWhatsapp,
  IconExternalLink,
  IconMapPin,
  IconPhone,
  IconRoute,
} from "@tabler/icons-react";

import type { Locale } from "@/lib/i18n";

type BusinessContactCardProps = {
  address: string;
  addressHref: string;
  callHref?: string | null;
  directionsHref: string;
  email?: string | null;
  locale?: Locale;
  phone?: string | null;
  whatsapp?: string | null;
  socialLinks?: Array<{
    href: string;
    label: string;
    network: "facebook" | "instagram";
  }>;
  townLine: string;
  websiteHref?: string | null;
  websiteLabel?: string | null;
};

export function BusinessContactCard({
  address,
  addressHref,
  callHref,
  directionsHref,
  email,
  locale = "it",
  phone,
  whatsapp,
  socialLinks = [],
  townLine,
  websiteHref,
  websiteLabel,
}: BusinessContactCardProps) {
  const copy =
    locale === "it"
      ? {
          address: "Indirizzo",
          call: "Chiama",
          contact: "Contatti",
          directions: "Indicazioni",
          email: "Email",
          phone: "Telefono",
          whatsapp: "WhatsApp",
          website: "Sito web",
        }
      : {
          address: "Address",
          call: "Call",
          contact: "Contact",
          directions: "Directions",
          email: "Email",
          phone: "Phone",
          whatsapp: "WhatsApp",
          website: "Website",
        };

  return (
    <section className="rounded-[1.7rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_10px_26px_rgba(66,51,31,0.05)] sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--secondary)] text-[var(--primary)]">
          <IconPhone size={18} />
        </span>
        <div>
          <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.contact}</h2>
        </div>
      </div>

      <div className="space-y-4 text-sm">
        <div className="rounded-2xl bg-[var(--secondary)] p-3.5">
          <div className="flex items-start gap-3">
            <IconMapPin size={16} className="mt-1 shrink-0 text-[var(--accent)]" />
            <a
              href={addressHref}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 rounded-sm leading-7 text-[var(--foreground)] hover:text-[var(--primary)] hover:underline"
            >
              <span className="block">{address}</span>
              <span className="block text-[var(--muted)]">{townLine}</span>
            </a>
          </div>
        </div>

        {phone ? (
          <div className="flex items-center gap-3">
            <IconPhone size={17} className="shrink-0 text-[var(--primary)]" />
            <a href={callHref ?? `tel:${phone}`} className="text-base font-medium text-[var(--foreground)] hover:text-[var(--primary)] hover:underline">
              {phone}
            </a>
          </div>
        ) : null}

        {whatsapp ? <div className="flex items-center gap-3">
          <IconBrandWhatsapp size={17} className="shrink-0 text-[var(--primary)]" aria-hidden="true" />
          <a href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="text-base font-medium text-[var(--foreground)] hover:text-[var(--primary)] hover:underline" aria-label={`${copy.whatsapp}: ${whatsapp}`}>
            {copy.whatsapp}: {whatsapp}
          </a>
        </div> : null}

        {email ? (
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-lg text-[var(--primary)]" aria-hidden="true">@</span>
            <a href={`mailto:${email}`} className="truncate text-base font-medium text-[var(--foreground)] hover:text-[var(--primary)] hover:underline">{email}</a>
          </div>
        ) : null}

        {websiteHref && websiteLabel ? (
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{copy.website}</p>
            <a
              href={websiteHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[var(--primary)] hover:underline"
            >
              <span className="line-clamp-1">{websiteLabel}</span>
              <IconExternalLink size={12} />
            </a>
          </div>
        ) : null}

        {socialLinks.map((link) => {
          const Icon = link.network === "instagram" ? IconBrandInstagram : IconBrandFacebook;

          return (
            <div key={link.network}>
              <p className="mb-1 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                {link.network === "instagram" ? "Instagram" : "Facebook"}
              </p>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-[var(--primary)] hover:underline"
              >
                <Icon size={15} />
                <span className="line-clamp-1">{link.label}</span>
                <IconExternalLink size={12} />
              </a>
            </div>
          );
        })}
      </div>

      <div className="mt-5">
        <a href={directionsHref} target="_blank" rel="noreferrer" className="btn-secondary w-full border-[var(--primary)] !text-[var(--primary)]">
          <IconRoute size={15} />
          {copy.directions}
        </a>
      </div>
    </section>
  );
}
