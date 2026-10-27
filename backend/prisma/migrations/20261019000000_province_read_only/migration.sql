CREATE TABLE "province_configs" (
  "healthCenterId" UUID PRIMARY KEY REFERENCES "health_centers"("id") ON DELETE RESTRICT,
  "username" TEXT NOT NULL,
  "passwordEncrypted" TEXT NOT NULL,
  "provinceHealthCenterCode" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "province_mappings" (
  "healthCenterId" UUID NOT NULL REFERENCES "health_centers"("id") ON DELETE RESTRICT,
  "indicatorId" TEXT NOT NULL REFERENCES "indicators"("id") ON DELETE RESTRICT,
  "provinceCode" TEXT NOT NULL,
  PRIMARY KEY ("healthCenterId", "indicatorId"),
  UNIQUE ("healthCenterId", "provinceCode")
);
