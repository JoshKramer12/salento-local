import { NextRequest } from "next/server";

function hashSeed(seed: string) {
  return seed.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const seed = searchParams.get("seed") ?? "salento";
  const label = searchParams.get("label") ?? "Salento Local";
  const type = searchParams.get("type") ?? "business";
  const hashed = hashSeed(seed);
  const palette =
    type === "beach"
      ? {
          sky: "#CFEAF4",
          mid: "#FDF4E6",
          ground: "#E0F0F5",
          accent: "#1E6F8C",
          accentSoft: "#8DBCCB",
          sun: "#D96C3B",
          subtitle: "Beach guide",
        }
      : type === "town"
        ? {
            sky: "#F6E6C8",
            mid: "#FFF8EF",
            ground: "#E3EED9",
            accent: "#174F66",
            accentSoft: "#6F8F4E",
            sun: "#D96C3B",
            subtitle: "Town guide",
          }
        : {
            sky: "#D8EBF2",
            mid: "#FFF8EF",
            ground: "#F0E6D4",
            accent: "#1E6F8C",
            accentSoft: "#6F8F4E",
            sun: "#D96C3B",
            subtitle: "Local listing",
          };
  const offset = hashed % 120;
  const titleSize = clamp(86 - Math.max(0, label.length - 16), 44, 86);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000" fill="none">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${palette.sky}" />
          <stop offset="48%" stop-color="${palette.mid}" />
          <stop offset="100%" stop-color="${palette.ground}" />
        </linearGradient>
        <linearGradient id="terrain" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="rgba(255,255,255,0.25)" />
          <stop offset="100%" stop-color="rgba(255,255,255,0.9)" />
        </linearGradient>
      </defs>
      <rect width="1600" height="1000" rx="56" fill="url(#bg)" />
      <circle cx="${1220 + offset}" cy="${180 + (hashed % 80)}" r="140" fill="${palette.sun}" opacity="0.22" />
      <circle cx="${1290 + (offset / 2)}" cy="${210 + (hashed % 50)}" r="88" fill="${palette.sun}" opacity="0.38" />
      <path d="M-120 760C180 560 430 610 650 720C880 835 1120 850 1410 650C1510 580 1600 555 1710 560V1040H-120V760Z" fill="rgba(255,255,255,0.42)" />
      <path d="M-80 850C150 700 420 700 640 810C820 900 1070 900 1320 780C1470 710 1590 700 1700 760V1040H-80V850Z" fill="url(#terrain)" />
      <path d="M0 1000V760C150 720 250 700 370 710C480 720 610 770 710 780C860 794 980 720 1130 720C1270 720 1400 760 1600 840V1000H0Z" fill="rgba(30,111,140,0.1)" />
      <rect x="84" y="84" width="276" height="58" rx="29" fill="rgba(255,255,255,0.72)" />
      <text x="118" y="122" fill="${palette.accent}" font-size="27" font-family="Inter, Arial, sans-serif" font-weight="800" letter-spacing="5">
        ${escapeXml(palette.subtitle.toUpperCase())}
      </text>
      <text x="110" y="390" fill="#24323A" font-size="${titleSize}" font-family="Inter, Arial, sans-serif" font-weight="800">
        ${escapeXml(label)}
      </text>
      <text x="114" y="454" fill="rgba(36,50,58,0.78)" font-size="34" font-family="Inter, Arial, sans-serif">
        Salento Local
      </text>
      <text x="114" y="512" fill="rgba(36,50,58,0.62)" font-size="28" font-family="Inter, Arial, sans-serif">
        Everyday local discovery across southern Puglia
      </text>
      <rect x="110" y="604" width="212" height="110" rx="24" fill="rgba(255,255,255,0.78)" />
      <rect x="348" y="632" width="160" height="82" rx="22" fill="rgba(255,255,255,0.72)" />
      <rect x="532" y="586" width="128" height="128" rx="24" fill="rgba(255,255,255,0.68)" />
      <path d="M110 714L216 624L322 714" stroke="${palette.accentSoft}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" />
      <path d="M560 648C588 622 604 618 628 618C654 618 674 628 694 650" stroke="${palette.accent}" stroke-width="18" stroke-linecap="round" opacity="0.8" />
      <circle cx="213" cy="660" r="18" fill="${palette.sun}" opacity="0.7" />
      <path d="M978 700C1085 650 1170 648 1262 692C1330 724 1418 724 1520 676" stroke="${palette.accent}" stroke-width="18" stroke-linecap="round" opacity="0.55" />
      <path d="M996 752C1090 712 1186 710 1274 744C1362 778 1448 778 1528 740" stroke="${palette.accent}" stroke-width="14" stroke-linecap="round" opacity="0.34" />
    </svg>
  `;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
