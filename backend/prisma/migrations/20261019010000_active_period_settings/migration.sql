ALTER TABLE "year_periods" ADD COLUMN "provinceEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "period_settings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "activeYear" INTEGER,
  "revision" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "period_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "period_settings_singleton" CHECK ("id" = 1),
  CONSTRAINT "period_settings_revision_nonnegative" CHECK ("revision" >= 0),
  CONSTRAINT "period_settings_activeYear_fkey" FOREIGN KEY ("activeYear") REFERENCES "year_periods"("year") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "period_settings_activeYear_key" ON "period_settings"("activeYear");
-- Deliberately unconfigured: Dinkes must select an existing year through the API.
INSERT INTO "period_settings" ("id", "activeYear", "revision") VALUES (1, NULL, 0);
