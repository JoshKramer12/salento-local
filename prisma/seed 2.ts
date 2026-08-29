import { CategoryGroup, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type TownSeed = {
  slug: string;
  name: string;
  province: string;
  shortDescription: string;
  intro: string;
  history: string;
  practicalInfo: string;
  latitude: number;
  longitude: number;
  featured: boolean;
  coastal: boolean;
  tags: string[];
};

const categories = [
  {
    slug: "restaurants",
    name: "Restaurants",
    icon: "fork-knife",
    description: "Traditional trattorias, seafood kitchens, and all-day dining spots.",
    group: CategoryGroup.FOOD,
    featured: true,
  },
  {
    slug: "cafes",
    name: "Cafes",
    icon: "coffee",
    description: "Coffee bars, pastry counters, and relaxed meeting places.",
    group: CategoryGroup.FOOD,
    featured: true,
  },
  {
    slug: "beaches",
    name: "Beaches",
    icon: "beach",
    description: "Beach clubs, quiet coves, and family-friendly seaside stops.",
    group: CategoryGroup.BEACH,
    featured: true,
  },
  {
    slug: "hotels",
    name: "Hotels",
    icon: "bed",
    description: "Boutique stays, masserie, and practical overnight options.",
    group: CategoryGroup.STAY,
    featured: true,
  },
  {
    slug: "grocery",
    name: "Grocery",
    icon: "basket",
    description: "Markets, mini markets, and local food shopping.",
    group: CategoryGroup.SHOPPING,
    featured: true,
  },
  {
    slug: "mechanics",
    name: "Mechanics",
    icon: "tool",
    description: "Auto repair, tyre service, and breakdown support.",
    group: CategoryGroup.SERVICE,
    featured: true,
  },
  {
    slug: "pharmacies",
    name: "Pharmacies",
    icon: "medical-cross",
    description: "Everyday essentials, prescriptions, and health support.",
    group: CategoryGroup.ESSENTIAL,
    featured: true,
  },
  {
    slug: "plumbers",
    name: "Plumbers",
    icon: "droplet",
    description: "Home maintenance, emergency repairs, and installations.",
    group: CategoryGroup.SERVICE,
    featured: true,
  },
  {
    slug: "bakeries",
    name: "Bakeries",
    icon: "bread",
    description: "Fresh bread, rustici, pastries, and morning essentials.",
    group: CategoryGroup.FOOD,
    featured: true,
  },
  {
    slug: "things-to-do",
    name: "Things to do",
    icon: "sparkles",
    description: "Tours, rentals, workshops, and local experiences.",
    group: CategoryGroup.TOURISM,
    featured: true,
  },
  {
    slug: "shops",
    name: "Shops",
    icon: "shopping-bag",
    description: "Independent boutiques, artisan stores, and useful shopping stops.",
    group: CategoryGroup.SHOPPING,
    featured: false,
  },
] as const;

const towns: TownSeed[] = [
  {
    slug: "brindisi",
    name: "Brindisi",
    province: "Brindisi",
    shortDescription: "A working port city with Roman history, ferries, and a practical urban center.",
    intro: "Brindisi blends waterfront promenades with everyday city life, making it a useful base for arrivals, departures, and local services.",
    history: "Known since antiquity as an important Adriatic harbor, Brindisi has long connected southern Italy with the eastern Mediterranean.",
    practicalInfo: "Best for ferry arrivals, airport connections, pharmacies, mechanics, and practical shopping close to the center.",
    latitude: 40.6327,
    longitude: 17.9418,
    featured: true,
    coastal: true,
    tags: ["harbor", "urban", "transport"],
  },
  {
    slug: "lecce",
    name: "Lecce",
    province: "Lecce",
    shortDescription: "The baroque capital of Salento, full of piazzas, cafes, and design-led local businesses.",
    intro: "Lecce is the cultural anchor of Salento, with grand architecture, lively streets, and a broad mix of food, shopping, and daily services.",
    history: "Its Roman roots and exuberant baroque facades helped Lecce become one of Puglia's best-known historic cities.",
    practicalInfo: "Excellent for walkable sightseeing, evening dining, coworking-friendly cafes, and practical errands in one compact center.",
    latitude: 40.3515,
    longitude: 18.175,
    featured: true,
    coastal: false,
    tags: ["baroque", "nightlife", "culture"],
  },
  {
    slug: "otranto",
    name: "Otranto",
    province: "Lecce",
    shortDescription: "A fortified coastal town with clear water, a small harbor, and strong summer energy.",
    intro: "Otranto is ideal for beach days mixed with old-town strolls, seafood lunches, and boat-based activities.",
    history: "The town's castle walls and cathedral recall centuries of strategic importance on Italy's eastern edge.",
    practicalInfo: "Come early for parking in summer, use the old town on foot, and expect the seafront to be busiest from late morning onward.",
    latitude: 40.1486,
    longitude: 18.4872,
    featured: true,
    coastal: true,
    tags: ["fortified", "sea", "summer"],
  },
  {
    slug: "gallipoli",
    name: "Gallipoli",
    province: "Lecce",
    shortDescription: "A lively Ionian seaside town known for beaches, nightlife, and a photogenic old center.",
    intro: "Gallipoli balances beach clubs and boat trips with a compact historic core filled with restaurants and evening energy.",
    history: "Its island-like old town and fishing traditions helped Gallipoli grow into one of Salento's best-known coastal destinations.",
    practicalInfo: "Best for summer evenings, beach-hopping, seafood, and booking activities ahead during peak season.",
    latitude: 40.0555,
    longitude: 17.9975,
    featured: true,
    coastal: true,
    tags: ["nightlife", "beaches", "boats"],
  },
  {
    slug: "nardo",
    name: "Nardo",
    province: "Lecce",
    shortDescription: "A handsome inland center with baroque squares and easy access to the Ionian coast.",
    intro: "Nardo offers a calm local rhythm, elegant piazzas, and strong food options, while staying close to beaches and natural reserves.",
    history: "The town developed into an important civic and religious center, leaving behind rich baroque architecture.",
    practicalInfo: "Useful as a quieter base near Porto Selvaggio, with parking, bakeries, and practical services around the center.",
    latitude: 40.1778,
    longitude: 18.0313,
    featured: true,
    coastal: false,
    tags: ["baroque", "local-life", "nature"],
  },
  {
    slug: "galatina",
    name: "Galatina",
    province: "Lecce",
    shortDescription: "A historic inland town known for pastry traditions, churches, and a genuine local feel.",
    intro: "Galatina is a strong choice for travelers looking beyond the coast toward craft, food culture, and slower town life.",
    history: "Its noble palaces and important basilica reflect centuries of prosperity and regional influence.",
    practicalInfo: "Great for daytime exploring, bakery stops, and using as a central point for inland Salento drives.",
    latitude: 40.1732,
    longitude: 18.1706,
    featured: false,
    coastal: false,
    tags: ["pastry", "historic", "artisan"],
  },
  {
    slug: "maglie",
    name: "Maglie",
    province: "Lecce",
    shortDescription: "A practical commercial hub with good shopping streets and quick links across southern Salento.",
    intro: "Maglie works well as a service town, with boutiques, mechanics, grocery options, and easy road access.",
    history: "Its position on inland trade routes helped Maglie develop into a useful market and business center.",
    practicalInfo: "Best for shopping, logistics, and everyday errands while staying connected to Otranto and the lower Salento coast.",
    latitude: 40.1207,
    longitude: 18.2974,
    featured: false,
    coastal: false,
    tags: ["shopping", "hub", "everyday"],
  },
  {
    slug: "porto-cesareo",
    name: "Porto Cesareo",
    province: "Lecce",
    shortDescription: "A beach-focused coastal town with shallow water, marine reserve views, and summer rentals.",
    intro: "Porto Cesareo is all about the sea, with long sandy stretches, boat excursions, and family-friendly waterfront stops.",
    history: "Its fishing identity and protected marine environment made it one of the Ionian coast's most recognizable beach areas.",
    practicalInfo: "Ideal for families and boat rentals; reserve umbrellas and parking ahead during July and August.",
    latitude: 40.2592,
    longitude: 17.8944,
    featured: true,
    coastal: true,
    tags: ["family", "marine-park", "sand"],
  },
  {
    slug: "santa-maria-di-leuca",
    name: "Santa Maria di Leuca",
    province: "Lecce",
    shortDescription: "The dramatic southern tip of Salento, known for cliffs, villas, and sea excursions.",
    intro: "Leuca feels cinematic, with a monumental lighthouse, boat caves, and elegant seafront architecture.",
    history: "At the meeting point of the Adriatic and Ionian seas, Leuca became both a pilgrimage destination and a seaside retreat.",
    practicalInfo: "Best enjoyed with a car, especially if you want to combine boat trips, cliff viewpoints, and nearby beaches.",
    latitude: 39.7992,
    longitude: 18.3597,
    featured: true,
    coastal: true,
    tags: ["cliffs", "views", "boat-trips"],
  },
  {
    slug: "tricase",
    name: "Tricase",
    province: "Lecce",
    shortDescription: "A lived-in southern town with craft businesses, services, and access to the Adriatic side.",
    intro: "Tricase is a grounded local center where practical services and authentic town life come before spectacle.",
    history: "The area grew through agricultural trade and later became a useful civic center for the surrounding villages.",
    practicalInfo: "Useful for mechanics, groceries, and slower stays near Tricase Porto and the lower Adriatic coast.",
    latitude: 39.9296,
    longitude: 18.3576,
    featured: false,
    coastal: false,
    tags: ["authentic", "services", "southern-salento"],
  },
  {
    slug: "ugento",
    name: "Ugento",
    province: "Lecce",
    shortDescription: "An inland base close to some of the Ionian coast's best beaches and resort areas.",
    intro: "Ugento is practical and understated, with easy access to Torre San Giovanni and other beach-oriented spots.",
    history: "Ancient Messapian origins and later regional importance gave Ugento a deep historical layer beneath its calm streets.",
    practicalInfo: "A good choice if you want beaches nearby but quieter accommodation and easier parking in town.",
    latitude: 39.927,
    longitude: 18.1584,
    featured: false,
    coastal: false,
    tags: ["base-town", "beach-access", "quiet"],
  },
  {
    slug: "casarano",
    name: "Casarano",
    province: "Lecce",
    shortDescription: "A substantial inland town with shopping, services, and strong local business activity.",
    intro: "Casarano serves residents first, which makes it useful for mechanics, plumbers, groceries, and everyday practical needs.",
    history: "Its industrial and commercial growth shaped a town that is more functional than touristic, but very useful.",
    practicalInfo: "Ideal for errands, business services, and staying connected to both Gallipoli and the southern interior.",
    latitude: 40.0103,
    longitude: 18.1611,
    featured: false,
    coastal: false,
    tags: ["practical", "shopping", "services"],
  },
  {
    slug: "copertino",
    name: "Copertino",
    province: "Lecce",
    shortDescription: "A castle town surrounded by countryside, useful for food stops and day-to-day services.",
    intro: "Copertino combines a strong local identity with convenient access to Lecce and the Ionian side.",
    history: "The imposing castle and the cult of Saint Joseph of Copertino remain central to the town's historic identity.",
    practicalInfo: "Good for local restaurants, bakeries, and practical stops between Lecce and the western coast.",
    latitude: 40.269,
    longitude: 18.0547,
    featured: false,
    coastal: false,
    tags: ["castle", "food", "local-rhythm"],
  },
  {
    slug: "manduria",
    name: "Manduria",
    province: "Taranto",
    shortDescription: "Famous for Primitivo wine, archaeological traces, and access to the upper Ionian coast.",
    intro: "Manduria mixes wine culture, everyday life, and a strong agricultural identity with useful services in town.",
    history: "The town preserves Messapian walls and a long winemaking tradition tied to the surrounding countryside.",
    practicalInfo: "A strong stop for wine-focused itineraries, food shopping, and practical inland stays near the coast.",
    latitude: 40.3985,
    longitude: 17.6368,
    featured: false,
    coastal: false,
    tags: ["wine", "archaeology", "countryside"],
  },
  {
    slug: "mesagne",
    name: "Mesagne",
    province: "Brindisi",
    shortDescription: "A compact historic town with a polished center and easy road access around northern Salento.",
    intro: "Mesagne offers an attractive old town, evening dining, and practical proximity to Brindisi and the airport corridor.",
    history: "Its Norman castle and walled center reflect a long strategic role in the Brindisi hinterland.",
    practicalInfo: "Good for a calm base with walkable dining and strong transport connections across the province.",
    latitude: 40.5585,
    longitude: 17.8074,
    featured: false,
    coastal: false,
    tags: ["castle", "evening", "well-connected"],
  },
  {
    slug: "ostuni",
    name: "Ostuni",
    province: "Brindisi",
    shortDescription: "The famous white hill town with panoramic lanes, design shops, and stylish dining.",
    intro: "Ostuni is photogenic and busy, but still practical enough for shopping, good restaurants, and nearby beach access.",
    history: "Its whitewashed skyline and medieval layout helped make Ostuni one of Puglia's most recognizable towns.",
    practicalInfo: "Expect paid parking and uphill walks; best for a mix of old-town browsing, dining, and scenic aperitivo.",
    latitude: 40.7318,
    longitude: 17.5772,
    featured: true,
    coastal: false,
    tags: ["white-town", "panoramic", "design"],
  },
  {
    slug: "ceglie-messapica",
    name: "Ceglie Messapica",
    province: "Brindisi",
    shortDescription: "A food-loving hill town celebrated for bakeries, trattorias, and a slower pace.",
    intro: "Ceglie Messapica has a reputation for good eating, local craftsmanship, and pleasant evenings in the center.",
    history: "Its Messapian roots and culinary traditions have given the town an identity that feels deeply regional.",
    practicalInfo: "Ideal for food-first day trips, bakery crawls, and quiet stays between Valle d'Itria and Salento.",
    latitude: 40.6486,
    longitude: 17.5167,
    featured: false,
    coastal: false,
    tags: ["culinary", "hill-town", "slow-travel"],
  },
  {
    slug: "corigliano-dotranto",
    name: "Corigliano d'Otranto",
    province: "Lecce",
    shortDescription: "A Grecanic-influenced town with a striking castle and strong cultural identity.",
    intro: "Corigliano d'Otranto is small but characterful, with heritage architecture and an interesting inland position.",
    history: "Its links to Griko culture and the presence of the castle help distinguish it from nearby commercial centers.",
    practicalInfo: "A rewarding stop for architecture, local events, and quieter routes between Lecce, Maglie, and Otranto.",
    latitude: 40.1591,
    longitude: 18.2552,
    featured: false,
    coastal: false,
    tags: ["griko", "castle", "culture"],
  },
  {
    slug: "melpignano",
    name: "Melpignano",
    province: "Lecce",
    shortDescription: "A small cultural town known for festivals, stone architecture, and Salento's musical identity.",
    intro: "Melpignano is intimate and event-oriented, ideal for visitors interested in music, culture, and village-scale stays.",
    history: "It became internationally known through the Notte della Taranta festival and its link to Salento folk traditions.",
    practicalInfo: "Best paired with nearby towns, especially during festival periods when accommodation books quickly.",
    latitude: 40.1574,
    longitude: 18.2929,
    featured: false,
    coastal: false,
    tags: ["festival", "music", "stone"],
  },
  {
    slug: "specchia",
    name: "Specchia",
    province: "Lecce",
    shortDescription: "A beautifully preserved hill village with stone lanes and a quietly refined atmosphere.",
    intro: "Specchia is one of the prettiest inland villages in Salento, with intimate streets, small shops, and calm evenings.",
    history: "Its elevated position and well-kept historic center helped it retain a strong village identity over time.",
    practicalInfo: "Best for slow strolls, independent shops, and using as a peaceful base near the far south.",
    latitude: 39.9398,
    longitude: 18.2974,
    featured: true,
    coastal: false,
    tags: ["village", "stone-lanes", "quiet"],
  },
];

const authors = [
  "Giulia R.",
  "Thomas W.",
  "Elena C.",
  "Marco L.",
  "Sofia P.",
  "Anna B.",
  "Luca G.",
  "Megan T.",
  "Paolo N.",
  "Isabella F.",
];

const categoryTemplates: Record<
  string,
  {
    prefixes: string[];
    suffixes: string[];
    shorts: string[];
    details: string[];
    tags: string[];
    priceLevel?: number;
    schedule: "food" | "service" | "daytime" | "beach" | "hotel";
    defaultOpenNow: boolean;
  }
> = {
  restaurants: {
    prefixes: ["Trattoria", "Osteria", "Corte", "Masseria", "Terrazza", "Dispensa"],
    suffixes: ["del Porto", "sul Corso", "delle Mura", "Salentina", "del Mercato", "di Piazza"],
    shorts: [
      "Seasonal Salento cooking with a polished but relaxed atmosphere.",
      "A dependable local dining room for seafood, pasta, and regional classics.",
      "An all-day restaurant with a warm team and strong local wine list.",
    ],
    details: [
      "The kitchen focuses on familiar Salento dishes, local produce, and a menu that works for both a long lunch and a practical dinner stop.",
      "Guests come for regional recipes, easy service, and a setting that feels useful for couples, families, and small groups alike.",
    ],
    tags: ["outdoor seating", "local wine", "regional dishes", "family-friendly"],
    priceLevel: 2,
    schedule: "food",
    defaultOpenNow: true,
  },
  cafes: {
    prefixes: ["Caffe", "Bar", "Bottega", "Corner", "Torrefazione", "Salotto"],
    suffixes: ["del Centro", "Mediterraneo", "dei Portici", "del Duomo", "Vista Mare", "di Quartiere"],
    shorts: [
      "Coffee, pastry, and a comfortable base for starting the day.",
      "A bright neighborhood bar with pastries, sandwiches, and good espresso.",
      "An easy stop for breakfast, aperitivo, or a quick remote-work break.",
    ],
    details: [
      "The space is set up for everything from a five-minute coffee to a slower pause with pastries, juices, and light lunch options.",
      "Locals use it throughout the day, which gives the place a grounded rhythm beyond the tourist peak hours.",
    ],
    tags: ["espresso", "breakfast", "aperitivo", "wifi"],
    priceLevel: 1,
    schedule: "daytime",
    defaultOpenNow: true,
  },
  beaches: {
    prefixes: ["Lido", "Spiaggia", "Cala", "Baia", "Riva", "Duna"],
    suffixes: ["Azzurra", "del Faro", "delle Conchiglie", "Mediterranea", "del Sole", "Sabbia Chiara"],
    shorts: [
      "Clear water, practical facilities, and easy family-friendly access.",
      "A scenic beach stop with loungers, shade, and strong sea views.",
      "A relaxed seaside base for a long swim day and sunset drinks.",
    ],
    details: [
      "Expect a good mix of practical comforts such as showers, changing cabins, and a beach bar alongside a laid-back coastal atmosphere.",
      "The beach works well for half-day visits and longer stays thanks to calm water, clean facilities, and a straightforward booking setup.",
    ],
    tags: ["sunbeds", "clear water", "family-friendly", "sunset"],
    priceLevel: 2,
    schedule: "beach",
    defaultOpenNow: true,
  },
  hotels: {
    prefixes: ["Dimora", "Palazzo", "Masseria", "Casa", "Relais", "Suites"],
    suffixes: ["del Mare", "Sant'Oronzo", "Vista Sud", "delle Mura", "Lungomare", "Corte Bianca"],
    shorts: [
      "A reliable stay with polished rooms and easy local orientation.",
      "Comfortable accommodation with modern touches and practical service.",
      "A well-located place for a short Salento base with strong reviews.",
    ],
    details: [
      "The property aims to feel welcoming rather than formal, with clear communication, quality sleep essentials, and a location that makes local exploring easy.",
      "Visitors tend to choose it for dependable comfort, clean design, and a staff that can help connect them with nearby beaches and restaurants.",
    ],
    tags: ["parking", "air conditioning", "breakfast included", "central"],
    priceLevel: 3,
    schedule: "hotel",
    defaultOpenNow: true,
  },
  grocery: {
    prefixes: ["Mercato", "Emporio", "Bottega", "Dispensa", "Mini Market", "Frantoio"],
    suffixes: ["Salentino", "del Borgo", "di Quartiere", "del Porto", "della Piazza", "dei Sapori"],
    shorts: [
      "A practical local market for essentials, picnic supplies, and regional products.",
      "Reliable grocery shopping with fresh produce, pantry basics, and friendly service.",
      "A useful stop for fruit, focaccia, drinks, and last-minute apartment staples.",
    ],
    details: [
      "Shelves focus on practical daily needs, but there is also room for local olive oil, wine, preserved vegetables, and easy lunch supplies.",
      "It works especially well for visitors staying in apartments who need a dependable place for breakfast basics and beach-day provisions.",
    ],
    tags: ["fresh produce", "local products", "quick stop", "picnic supplies"],
    priceLevel: 1,
    schedule: "daytime",
    defaultOpenNow: true,
  },
  mechanics: {
    prefixes: ["Officina", "Autotech", "Garage", "Motori", "Service", "Pneus"],
    suffixes: ["Salento", "del Levante", "Jonico", "Adriatico", "Express", "Centro"],
    shorts: [
      "A trusted local workshop for breakdowns, servicing, and tyre checks.",
      "Quick-turn practical repairs with a straightforward local team.",
      "Useful for holiday hiccups, routine maintenance, and road-trip support.",
    ],
    details: [
      "The workshop focuses on clear communication, realistic timing, and the kinds of practical fixes that help visitors get moving again quickly.",
      "Locals rely on it for maintenance while travelers value help with punctures, battery issues, and diagnostics between destinations.",
    ],
    tags: ["tyres", "diagnostics", "road assistance", "air conditioning"],
    priceLevel: 2,
    schedule: "service",
    defaultOpenNow: false,
  },
  pharmacies: {
    prefixes: ["Farmacia", "Parafarmacia", "Salus", "Sanitaria", "Medica", "Farmacia"],
    suffixes: ["del Centro", "Adriatica", "del Porto", "San Giuseppe", "Salentina", "Santa Lucia"],
    shorts: [
      "A dependable pharmacy for everyday needs, advice, and prescriptions.",
      "Practical health support with helpful staff and essential travel supplies.",
      "A useful stop for medicines, sun care, and small emergencies.",
    ],
    details: [
      "The team is used to helping both residents and visitors with prescriptions, seasonal needs, and common travel-related issues.",
      "You can expect a clean, efficient setup with a strong range of everyday essentials and practical advice at the counter.",
    ],
    tags: ["prescriptions", "sun care", "first aid", "multilingual help"],
    priceLevel: 1,
    schedule: "daytime",
    defaultOpenNow: true,
  },
  plumbers: {
    prefixes: ["Idro", "Aqua", "Pronto", "Impianti", "Tecnica", "Blue"],
    suffixes: ["Service", "Sud", "Salento", "24", "Casa", "Network"],
    shorts: [
      "A local plumbing service for repairs, installs, and urgent callouts.",
      "Practical help for leaks, boilers, and apartment maintenance.",
      "A reliable service contact for homeowners, hosts, and property managers.",
    ],
    details: [
      "The business handles both scheduled work and urgent fixes, with a practical approach aimed at keeping homes and rental properties running smoothly.",
      "Property owners use it for installations and maintenance, while hosts appreciate having a fast local contact for guest issues.",
    ],
    tags: ["emergency callout", "boilers", "property management", "repairs"],
    priceLevel: 2,
    schedule: "service",
    defaultOpenNow: false,
  },
  bakeries: {
    prefixes: ["Forno", "Panificio", "Pane", "Laboratorio", "Biscottificio", "Focacceria"],
    suffixes: ["del Borgo", "Antico", "Salentino", "della Piazza", "di Famiglia", "del Mattino"],
    shorts: [
      "Fresh bread, rustici, and sweet pastries from early morning onward.",
      "A useful bakery for breakfast, beach snacks, and local oven staples.",
      "Beloved for warm focaccia, biscuits, and easy takeaway lunches.",
    ],
    details: [
      "Production starts early and covers practical daily bread alongside pastries, savory snacks, and the kinds of grab-and-go options visitors keep returning for.",
      "It is especially good for mornings when you want local baked goods without turning breakfast into a full sit-down event.",
    ],
    tags: ["rustici", "fresh bread", "pastries", "takeaway"],
    priceLevel: 1,
    schedule: "food",
    defaultOpenNow: true,
  },
  "things-to-do": {
    prefixes: ["Salento", "Terra", "Vento", "Mare", "Experience", "Bottega"],
    suffixes: ["Experience", "Outdoor", "Bike Club", "Workshop", "Boat Tours", "Adventures"],
    shorts: [
      "A well-reviewed local activity operator with clear planning and friendly hosts.",
      "An easy way to book a practical Salento experience without the friction.",
      "Useful for visitors looking to add one memorable local activity to their stay.",
    ],
    details: [
      "Experiences are designed to feel accessible and organized, whether that means a boat excursion, guided tasting, bike rental, or hands-on workshop.",
      "People book here for dependable communication, local knowledge, and activities that fit smoothly into a wider Salento itinerary.",
    ],
    tags: ["guided", "outdoor", "local knowledge", "small groups"],
    priceLevel: 2,
    schedule: "daytime",
    defaultOpenNow: true,
  },
  shops: {
    prefixes: ["Atelier", "Bottega", "Casa", "Selezione", "Merceria", "Emporio"],
    suffixes: ["Mediterranea", "del Centro", "Artigiana", "di Corte", "Salentina", "delle Mura"],
    shorts: [
      "A polished independent shop with useful gifts, home goods, and regional style.",
      "An artisan-focused store for quality souvenirs and everyday browsing.",
      "A handy mix of design-led local shopping and practical gift ideas.",
    ],
    details: [
      "The shop leans into regional materials, thoughtful curation, and products that feel more useful than generic tourist merchandise.",
      "Visitors stop by for ceramics, linens, pantry items, and small purchases that capture the local aesthetic without feeling staged.",
    ],
    tags: ["artisan", "gifts", "design", "made in puglia"],
    priceLevel: 2,
    schedule: "daytime",
    defaultOpenNow: true,
  },
};

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(slug: string) {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function placeholderUrl(seed: string, label: string, type: "town" | "business" | "beach") {
  const params = new URLSearchParams({
    seed,
    label,
    type,
  });

  return `/api/placeholder?${params.toString()}`;
}

function buildSchedule(kind: "food" | "service" | "daytime" | "beach" | "hotel") {
  if (kind === "hotel") {
    return weekdays.map((_, dayOfWeek) => ({
      dayOfWeek,
      startTime: "00:00",
      endTime: "23:59",
      closed: false,
    }));
  }

  if (kind === "service") {
    return weekdays.map((_, dayOfWeek) => ({
      dayOfWeek,
      startTime: dayOfWeek === 6 ? null : "08:30",
      endTime: dayOfWeek === 6 ? null : "18:30",
      closed: dayOfWeek === 6,
    }));
  }

  if (kind === "beach") {
    return weekdays.map((_, dayOfWeek) => ({
      dayOfWeek,
      startTime: "09:00",
      endTime: dayOfWeek === 5 || dayOfWeek === 6 ? "20:00" : "19:00",
      closed: false,
    }));
  }

  if (kind === "daytime") {
    return weekdays.map((_, dayOfWeek) => ({
      dayOfWeek,
      startTime: "07:30",
      endTime: dayOfWeek === 6 ? "13:30" : "20:00",
      closed: false,
    }));
  }

  return weekdays.map((_, dayOfWeek) => ({
    dayOfWeek,
    startTime: dayOfWeek === 6 ? "08:00" : "12:00",
    endTime: dayOfWeek === 6 ? "15:00" : "23:00",
    closed: false,
  }));
}

function createReviewDate(index: number) {
  const date = new Date("2026-06-20T10:00:00.000Z");
  date.setDate(date.getDate() - index * 6);
  return date;
}

function getBusinessCategorySlugs(town: TownSeed) {
  const core = town.coastal
    ? ["restaurants", "cafes", "beaches", "hotels", "things-to-do", "pharmacies"]
    : ["restaurants", "bakeries", "shops", "grocery", "mechanics", "plumbers"];

  if (!town.coastal) {
    core.push("cafes");
  }

  if (["lecce", "ostuni", "gallipoli", "otranto", "porto-cesareo"].includes(town.slug)) {
    core.push("things-to-do");
  }

  if (["lecce", "maglie", "casarano", "brindisi"].includes(town.slug)) {
    core.push("pharmacies");
  }

  return Array.from(new Set(core));
}

async function main() {
  await prisma.businessTag.deleteMany();
  await prisma.review.deleteMany();
  await prisma.businessHour.deleteMany();
  await prisma.businessImage.deleteMany();
  await prisma.business.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.category.deleteMany();
  await prisma.town.deleteMany();

  const createdCategories = new Map<string, { id: string; group: CategoryGroup; name: string }>();

  for (const category of categories) {
    const created = await prisma.category.create({ data: category });
    createdCategories.set(category.slug, {
      id: created.id,
      group: category.group,
      name: category.name,
    });
  }

  const tagNames = new Set<string>([
    "family-friendly",
    "central",
    "authentic",
    "local favorite",
    "sea views",
    "easy parking",
  ]);

  Object.values(categoryTemplates).forEach((template) => {
    template.tags.forEach((tag) => tagNames.add(tag));
  });

  towns.forEach((town) => {
    town.tags.forEach((tag) => tagNames.add(tag));
  });

  const createdTags = new Map<string, string>();

  for (const name of Array.from(tagNames)) {
    const created = await prisma.tag.create({
      data: {
        name: titleCase(name),
        slug: slugify(name),
      },
    });
    createdTags.set(created.slug, created.id);
  }

  for (const [townIndex, town] of towns.entries()) {
    const createdTown = await prisma.town.create({
      data: {
        slug: town.slug,
        name: town.name,
        province: town.province,
        shortDescription: town.shortDescription,
        intro: town.intro,
        history: town.history,
        practicalInfo: town.practicalInfo,
        heroImageSeed: `${town.slug}-hero`,
        latitude: town.latitude,
        longitude: town.longitude,
        featured: town.featured,
      },
    });

    const townCategorySlugs = getBusinessCategorySlugs(town);

    for (const [businessIndex, categorySlug] of townCategorySlugs.entries()) {
      const template = categoryTemplates[categorySlug];
      const category = createdCategories.get(categorySlug);

      if (!template || !category) {
        continue;
      }

      const prefix = template.prefixes[(townIndex + businessIndex) % template.prefixes.length];
      const suffix = template.suffixes[(townIndex * 2 + businessIndex) % template.suffixes.length];
      const name = `${prefix} ${suffix}`;
      const slug = slugify(`${name}-${town.slug}`);
      const label = categorySlug === "beaches" ? `${town.name} Beach` : `${name} ${town.name}`;
      const rating = Number((4.2 + ((townIndex + businessIndex) % 7) * 0.1).toFixed(1));
      const reviewCount = 18 + townIndex * 7 + businessIndex * 11;
      const latitude = town.latitude + ((businessIndex % 3) - 1) * 0.0065;
      const longitude = town.longitude + ((businessIndex % 2) - 0.5) * 0.009;
      const shortDescription =
        template.shorts[(townIndex + businessIndex) % template.shorts.length];
      const description = `${template.details[(townIndex + businessIndex) % template.details.length]} This mock listing is part of the Salento Directory prototype and can later be replaced with verified business submissions or official data feeds.`;
      const website = `https://www.${slug}.example.com`;
      const phonePrefix = town.province === "Brindisi" ? "0831" : town.province === "Taranto" ? "099" : "0832";
      const phone = `+39 ${phonePrefix} 000 ${String(100 + townIndex * 5 + businessIndex).padStart(3, "0")}`;
      const address = `${businessIndex % 2 === 0 ? "Via" : "Piazza"} ${town.tags[0].split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")} ${12 + businessIndex}, ${town.name}`;
      const selectedTagSlugs = Array.from(
        new Set([
          ...template.tags.slice(0, 3),
          town.tags[businessIndex % town.tags.length],
          town.coastal ? "sea views" : "easy parking",
          businessIndex % 2 === 0 ? "family-friendly" : "local favorite",
        ]),
      ).map(slugify);

      const business = await prisma.business.create({
        data: {
          slug,
          name: categorySlug === "beaches" ? `${prefix} ${town.name}` : name,
          shortDescription,
          description,
          address,
          phone,
          website,
          rating,
          reviewCount,
          priceLevel: template.priceLevel,
          isFeatured: town.featured && businessIndex < 2,
          isOpenNow: template.defaultOpenNow,
          mapsUrl: `https://maps.google.com/?q=${latitude},${longitude}`,
          heroImageSeed: `${slug}-hero`,
          latitude,
          longitude,
          categoryId: category.id,
          townId: createdTown.id,
          images: {
            create: [0, 1, 2, 3].map((imageIndex) => ({
              url: placeholderUrl(
                `${slug}-${imageIndex}`,
                imageIndex === 0 ? label : `${label} ${imageIndex + 1}`,
                categorySlug === "beaches" ? "beach" : "business",
              ),
              alt: `${label} photo ${imageIndex + 1}`,
              sortOrder: imageIndex,
            })),
          },
          hours: {
            create: buildSchedule(template.schedule),
          },
          tags: {
            create: selectedTagSlugs
              .map((tagSlug) => createdTags.get(tagSlug))
              .filter((tagId): tagId is string => Boolean(tagId))
              .map((tagId) => ({
                tag: {
                  connect: { id: tagId },
                },
              })),
          },
          reviews: {
            create: [0, 1, 2].map((reviewIndex) => ({
              authorName: authors[(townIndex + businessIndex + reviewIndex) % authors.length],
              title: [
                "Easy to recommend",
                "Great local stop",
                "Would come back",
              ][reviewIndex],
              body: [
                `Helpful staff, clear communication, and a really good sense of place in ${town.name}.`,
                `This felt practical and polished rather than touristy, which suited our stay very well.`,
                `One of the more dependable places we found in the area for quality, ease, and atmosphere.`,
              ][reviewIndex],
              rating: Number((rating - reviewIndex * 0.1).toFixed(1)),
              createdAt: createReviewDate(townIndex + businessIndex + reviewIndex),
            })),
          },
        },
      });

      console.log(`Seeded ${business.name} in ${town.name}`);
    }
  }

  console.log(`Seeded ${towns.length} towns and ${categories.length} categories.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
