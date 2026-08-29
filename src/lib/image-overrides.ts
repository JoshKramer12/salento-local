const commonsFilePath = (filename: string, width = 1600) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    filename,
  )}?width=${width}`;

export const townImageOverrides: Record<string, string> = {
  "bagnolo-del-salento": commonsFilePath(
    "Bagnolo del Salento Chiesa dei Martiri.jpg",
  ),
  brindisi: commonsFilePath("Cathédrale de Brindisi.JPG"),
  carosino: commonsFilePath("Carosino01.jpg"),
  "corigliano-dotranto": commonsFilePath("Caporta.jpg"),
  erchie: commonsFilePath("Erchie - Palazzo ducale - Sede Municipio.jpg"),
  fragagnano: commonsFilePath("Muretto a secco.jpg"),
  galatone: commonsFilePath("Abbazia di San Nicola di Pergoleto Galatone.jpg"),
  giurdignano: commonsFilePath("Abbazia delle Centoporte di Giurdignano.jpg"),
  grottaglie: commonsFilePath("CastelloEpiscopio.jpg"),
  lecce: commonsFilePath("Amphitheatre (Lecce) 02.jpg"),
  leporano: commonsFilePath("Leporano 14.JPG"),
  manduria: commonsFilePath("Area Naturale Protetta Palude Del Conte.jpg"),
  melendugno: commonsFilePath("Abbazia di San Niceta a Melendugno.jpg"),
  mesagne: commonsFilePath("Calvario Mesagne.jpg"),
  oria: commonsFilePath("Canale Reale.JPG"),
  ostuni: commonsFilePath("Ostuni vue générale.JPG"),
  racale: commonsFilePath("Castelforte - Racale.jpg"),
  "salice-salentino": commonsFilePath("Castello monaci a salice salentino.jpg"),
  "san-michele-salentino": commonsFilePath("Muretto a secco.jpg"),
  specchia: commonsFilePath("Castello Di Specchia.jpg"),
  taranto: commonsFilePath("Aldomoro panorama.jpg"),
  taurisano: commonsFilePath("Casa Giulio Cesare Vanini Taurisano.jpg"),
  torchiarolo: commonsFilePath("Piazza Castello (Torchiarolo)01.jpg"),
  tricase: commonsFilePath("Tricase Porto.jpg"),
  zollino: commonsFilePath(
    "Zollino - Cappella di San Giovanni Battista - 2025-09-03 16-01-58 001.JPG",
  ),
};

export const decorativeTownImagePattern =
  /(flag|bandiera|gonfalone|stemma|coat[_ -]?of[_ -]?arms|location[_ -]?map|locator|province|map_2016|\.svg)/i;

export function normalizeWikimediaImage(url: string, width = 1600) {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname === "commons.wikimedia.org" &&
      parsed.pathname.startsWith("/wiki/Special:FilePath/")
    ) {
      parsed.searchParams.set("width", String(width));
      return parsed.toString();
    }

    if (
      parsed.hostname.endsWith(".wikipedia.org") &&
      parsed.pathname.startsWith("/wiki/Special:FilePath/")
    ) {
      parsed.searchParams.set("width", String(width));
      return parsed.toString();
    }

    if (parsed.hostname !== "upload.wikimedia.org") {
      return url;
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    const wikiIndex = segments.indexOf("wikipedia");
    const repo = wikiIndex >= 0 ? segments[wikiIndex + 1] : null;
    const thumbIndex = segments.indexOf("thumb");
    const filename = thumbIndex >= 0 ? segments[thumbIndex + 3] : segments.at(-1);

    if (!repo || !filename) {
      return url;
    }

    const decodedFilename = decodeURIComponent(filename);
    const baseHost =
      repo === "commons" ? "commons.wikimedia.org" : `${repo}.wikipedia.org`;
    const normalized = new URL(
      `/wiki/Special:FilePath/${encodeURIComponent(decodedFilename)}`,
      `https://${baseHost}`,
    );
    normalized.searchParams.set("width", String(width));
    return normalized.toString();
  } catch {
    return url;
  }
}
