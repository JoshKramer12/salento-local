import Link from "next/link";

export default function NotFound() {
  return (
    <section className="shell py-24">
      <div className="card mx-auto max-w-2xl p-8 text-center">
        <span className="section-kicker">Not found</span>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-[var(--color-charcoal)]">
          We couldn&apos;t find that Salento listing
        </h1>
        <p className="mt-4 text-sm leading-7 text-[var(--color-muted)]">
          Try a broader search, browse the town list, or jump back to the
          directory homepage.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/directory" className="btn-primary">
            Browse directory
          </Link>
          <Link href="/towns" className="btn-secondary">
            Explore towns
          </Link>
        </div>
      </div>
    </section>
  );
}
