-- CreateTable
CREATE TABLE "Locality" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "intro" TEXT NOT NULL,
    "practicalInfo" TEXT NOT NULL,
    "heroImageSeed" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "placeType" TEXT NOT NULL DEFAULT 'LOCALITY',
    "sourceUrl" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "townId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Locality_townId_fkey" FOREIGN KEY ("townId") REFERENCES "Town" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Business" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "sourceKey" TEXT,
    "externalSource" TEXT,
    "sourceUrl" TEXT,
    "name" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "openingHoursText" TEXT,
    "rating" REAL NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "priceLevel" INTEGER,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isOpenNow" BOOLEAN NOT NULL DEFAULT false,
    "mapsUrl" TEXT,
    "heroImageSeed" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "rawTags" JSONB,
    "categoryId" TEXT NOT NULL,
    "townId" TEXT NOT NULL,
    "localityId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Business_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Business_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "Locality" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Business_townId_fkey" FOREIGN KEY ("townId") REFERENCES "Town" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Business" ("address", "categoryId", "createdAt", "description", "externalSource", "heroImageSeed", "id", "isFeatured", "isOpenNow", "latitude", "longitude", "mapsUrl", "name", "openingHoursText", "phone", "priceLevel", "rating", "rawTags", "reviewCount", "shortDescription", "slug", "sourceKey", "sourceUrl", "townId", "updatedAt", "website") SELECT "address", "categoryId", "createdAt", "description", "externalSource", "heroImageSeed", "id", "isFeatured", "isOpenNow", "latitude", "longitude", "mapsUrl", "name", "openingHoursText", "phone", "priceLevel", "rating", "rawTags", "reviewCount", "shortDescription", "slug", "sourceKey", "sourceUrl", "townId", "updatedAt", "website" FROM "Business";
DROP TABLE "Business";
ALTER TABLE "new_Business" RENAME TO "Business";
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");
CREATE UNIQUE INDEX "Business_sourceKey_key" ON "Business"("sourceKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Locality_slug_key" ON "Locality"("slug");
