export default function Loading() {
  return (
    <section className="shell py-24">
      <div className="card flex min-h-[240px] items-center justify-center p-8">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-blue)]" />
          <p className="mt-4 text-sm text-[var(--color-muted)]">
            Loading Salento Local...
          </p>
        </div>
      </div>
    </section>
  );
}
