export default function AccountLoading() {
  return (
    <main className="shell px-4 py-12 sm:px-6">
      <div className="mb-8">
        <div className="h-4 w-32 rounded-full bg-[color:rgba(42,98,87,0.12)]" />
        <div className="mt-4 h-12 w-72 rounded-[1.4rem] bg-[color:rgba(42,98,87,0.08)]" />
        <div className="mt-4 h-5 max-w-2xl rounded-full bg-[color:rgba(42,98,87,0.08)]" />
      </div>

      <div className="mb-8 flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-10 w-36 rounded-full bg-[color:rgba(42,98,87,0.08)]"
          />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <section
            key={index}
            className="card p-6"
          >
            <div className="h-7 w-48 rounded-[1rem] bg-[color:rgba(42,98,87,0.08)]" />
            <div className="mt-4 h-4 w-full rounded-full bg-[color:rgba(42,98,87,0.08)]" />
            <div className="mt-3 h-4 w-5/6 rounded-full bg-[color:rgba(42,98,87,0.08)]" />
            <div className="mt-6 grid gap-3">
              {Array.from({ length: 3 }).map((__, innerIndex) => (
                <div
                  key={innerIndex}
                  className="h-16 rounded-[1.2rem] bg-[color:rgba(42,98,87,0.06)]"
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
