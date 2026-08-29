import type { Town } from "@prisma/client";

type MapPreviewProps = {
  towns: Town[];
};

export function MapPreview({ towns }: MapPreviewProps) {
  const latitudes = towns.map((town) => town.latitude);
  const longitudes = towns.map((town) => town.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-[var(--color-border)] bg-[linear-gradient(135deg,rgba(30,111,140,0.14),rgba(255,255,255,0.85),rgba(111,143,78,0.12))] p-6 shadow-soft">
      <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="relative min-h-[330px] overflow-hidden rounded-[1.75rem] border border-white/70 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.95),rgba(246,230,200,0.6),rgba(255,255,255,0.9))]">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(23,79,102,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(23,79,102,0.07)_1px,transparent_1px)] bg-[size:42px_42px]" />
          {towns.map((town) => {
            const top = 14 + ((maxLat - town.latitude) / Math.max(0.0001, maxLat - minLat)) * 72;
            const left = 10 + ((town.longitude - minLng) / Math.max(0.0001, maxLng - minLng)) * 78;

            return (
              <div
                key={town.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ top: `${top}%`, left: `${left}%` }}
              >
                <span className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:rgba(217,108,59,0.16)] blur-lg" />
                <span className="relative flex h-4 w-4 rounded-full border-4 border-white bg-[var(--color-blue)] shadow-lg" />
                <span className="mt-3 inline-flex rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-[var(--color-charcoal)] shadow-sm">
                  {town.name}
                </span>
              </div>
            );
          })}
        </div>

        <div className="space-y-4">
          <span className="section-kicker">Map preview</span>
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--color-charcoal)]">
            Spot coastal bases, urban hubs, and inland villages at a glance
          </h2>
          <p className="text-sm leading-7 text-[var(--color-muted)]">
            This prototype uses seeded coordinates to simulate a map-driven
            directory. It is ready to evolve toward real tiles, geocoding, and
            official location data later.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
              <div className="text-2xl font-semibold text-[var(--color-charcoal)]">
                {towns.length}
              </div>
              <div className="text-sm text-[var(--color-muted)]">Featured towns</div>
            </div>
            <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
              <div className="text-2xl font-semibold text-[var(--color-charcoal)]">
                2 coasts
              </div>
              <div className="text-sm text-[var(--color-muted)]">Adriatic and Ionian</div>
            </div>
            <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
              <div className="text-2xl font-semibold text-[var(--color-charcoal)]">
                Local-first
              </div>
              <div className="text-sm text-[var(--color-muted)]">Tourism plus daily life</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
