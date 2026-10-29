CREATE TABLE "period_recaps" (
  "id" UUID NOT NULL,
  "healthCenterId" UUID NOT NULL,
  "indicatorId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "endMonth" INTEGER NOT NULL,
  "numerator" DECIMAL(14,4) NOT NULL,
  "denominator" DECIMAL(14,4) NOT NULL,
  "notes" TEXT NOT NULL,
  "confirmed" BOOLEAN NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "scoringVersion" TEXT NOT NULL DEFAULT 'DO_2026_V2',
  "updatedBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "period_recaps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "period_recaps_year_check" CHECK ("year" BETWEEN 2026 AND 9999),
  CONSTRAINT "period_recaps_end_month_check" CHECK ("endMonth" BETWEEN 1 AND 12),
  CONSTRAINT "period_recaps_numerator_check" CHECK ("numerator" BETWEEN 0 AND 9999999999.9999),
  CONSTRAINT "period_recaps_denominator_check" CHECK ("denominator" BETWEEN 0 AND 9999999999.9999),
  CONSTRAINT "period_recaps_notes_check" CHECK ("notes" ~ '[^[:space:]]' AND length("notes") <= 4000),
  CONSTRAINT "period_recaps_confirmed_check" CHECK ("confirmed" = true),
  CONSTRAINT "period_recaps_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "period_recaps_version_check" CHECK ("scoringVersion" = 'DO_2026_V2'),
  CONSTRAINT "period_recaps_healthCenterId_fkey" FOREIGN KEY ("healthCenterId") REFERENCES "health_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "period_recaps_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "indicators"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "period_recaps_year_fkey" FOREIGN KEY ("year") REFERENCES "year_periods"("year") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "period_recaps_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "period_recaps_healthCenterId_indicatorId_year_endMonth_key" ON "period_recaps"("healthCenterId", "indicatorId", "year", "endMonth");
CREATE INDEX "period_recaps_year_idx" ON "period_recaps"("year");
CREATE INDEX "period_recaps_updatedBy_idx" ON "period_recaps"("updatedBy");

CREATE TRIGGER period_recaps_identity BEFORE UPDATE ON "period_recaps"
FOR EACH ROW EXECUTE FUNCTION reject_identity_change('id', 'healthCenterId', 'indicatorId', 'year', 'endMonth');

CREATE FUNCTION protect_period_recap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE covered_month integer;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    FOR covered_month IN 1..OLD."endMonth" LOOP
      PERFORM assert_period_writable(OLD."healthCenterId", OLD."year", covered_month);
    END LOOP;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    FOR covered_month IN 1..NEW."endMonth" LOOP
      PERFORM assert_period_writable(NEW."healthCenterId", NEW."year", covered_month);
    END LOOP;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER period_recaps_guard BEFORE INSERT OR UPDATE OR DELETE ON "period_recaps"
FOR EACH ROW EXECUTE FUNCTION protect_period_recap();
