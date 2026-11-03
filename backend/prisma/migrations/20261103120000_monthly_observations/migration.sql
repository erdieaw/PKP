-- Additive raw observation storage. Existing scoring/recap tables and precision are untouched.
-- DOUBLE PRECISION matches the public JSON number (binary64) contract without fixed-scale rounding.
CREATE TABLE "monthly_observations" (
  "id" UUID NOT NULL,
  "healthCenterId" UUID NOT NULL,
  "indicatorId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "value" DOUBLE PRECISION,
  "denominator" DOUBLE PRECISION,
  "documentAvailable" BOOLEAN,
  "unit" TEXT,
  "notes" TEXT,
  "sourceReference" TEXT,
  "evidenceId" UUID,
  "updatedBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "monthly_observations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monthly_observations_year_check" CHECK ("year" BETWEEN 1 AND 9999),
  CONSTRAINT "monthly_observations_month_check" CHECK ("month" BETWEEN 1 AND 12),
  CONSTRAINT "monthly_observations_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "monthly_observations_kind_check" CHECK ("kind" IN ('NOTE', 'NUMBER', 'RATIO', 'DOCUMENT')),
  CONSTRAINT "monthly_observations_status_check" CHECK ("status" IN ('RECORDED', 'NOT_DUE', 'NOT_AVAILABLE')),
  CONSTRAINT "monthly_observations_value_check" CHECK ("value" IS NULL OR "value" BETWEEN 0 AND 1000000000000),
  CONSTRAINT "monthly_observations_denominator_check" CHECK ("denominator" IS NULL OR "denominator" BETWEEN 0 AND 1000000000000),
  CONSTRAINT "monthly_observations_text_check" CHECK (length("unit") <= 100 AND length("notes") <= 4000 AND length("sourceReference") <= 1000),
  CONSTRAINT "monthly_observations_shape_check" CHECK (
    ("kind" IN ('NUMBER', 'RATIO') OR ("value" IS NULL AND "unit" IS NULL)) AND
    ("kind" = 'RATIO' OR "denominator" IS NULL) AND
    ("kind" = 'DOCUMENT' OR "documentAvailable" IS NULL) AND
    CASE WHEN "status" = 'RECORDED' THEN
      CASE "kind"
        WHEN 'NOTE' THEN coalesce(translate("notes", chr(8203) || chr(8204) || chr(8205) || chr(65279), '') ~ '[^[:space:]]', false)
        WHEN 'NUMBER' THEN "value" IS NOT NULL AND coalesce(translate("unit", chr(8203) || chr(8204) || chr(8205) || chr(65279), '') ~ '[^[:space:]]', false)
        WHEN 'RATIO' THEN "value" IS NOT NULL AND "denominator" IS NOT NULL AND coalesce(translate("unit", chr(8203) || chr(8204) || chr(8205) || chr(65279), '') ~ '[^[:space:]]', false)
        WHEN 'DOCUMENT' THEN "documentAvailable" IS NOT NULL
        ELSE false
      END
    ELSE
      "value" IS NULL AND "denominator" IS NULL AND "documentAvailable" IS NULL AND
      coalesce(translate("notes", chr(8203) || chr(8204) || chr(8205) || chr(65279), '') ~ '[^[:space:]]', false)
    END
  ),
  CONSTRAINT "monthly_observations_healthCenterId_fkey" FOREIGN KEY ("healthCenterId") REFERENCES "health_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "monthly_observations_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "indicators"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "monthly_observations_year_fkey" FOREIGN KEY ("year") REFERENCES "year_periods"("year") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "monthly_observations_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "monthly_observations_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "monthly_observations_healthCenterId_indicatorId_year_month_key" ON "monthly_observations"("healthCenterId", "indicatorId", "year", "month");
CREATE INDEX "monthly_observations_healthCenterId_year_month_idx" ON "monthly_observations"("healthCenterId", "year", "month");
CREATE INDEX "monthly_observations_year_idx" ON "monthly_observations"("year");
CREATE INDEX "monthly_observations_evidenceId_idx" ON "monthly_observations"("evidenceId");
CREATE INDEX "monthly_observations_updatedBy_idx" ON "monthly_observations"("updatedBy");

CREATE TRIGGER monthly_observations_identity BEFORE UPDATE ON "monthly_observations"
FOR EACH ROW EXECUTE FUNCTION reject_identity_change('id', 'healthCenterId', 'indicatorId', 'year', 'month', 'createdAt');

CREATE FUNCTION protect_monthly_observation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  selected_year integer;
  writer_role "Role";
BEGIN
  SELECT "activeYear" INTO selected_year FROM "period_settings" WHERE id = 1 FOR UPDATE;
  IF NOT FOUND OR selected_year IS NULL OR selected_year IS DISTINCT FROM (CASE WHEN TG_OP = 'DELETE' THEN OLD."year" ELSE NEW."year" END) THEN
    RAISE EXCEPTION 'Requested year is not the active year' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM assert_period_writable(OLD."healthCenterId", OLD."year", OLD."month");
    RETURN OLD;
  END IF;
  PERFORM assert_period_writable(NEW."healthCenterId", NEW."year", NEW."month");
  IF (TG_OP = 'INSERT' AND NEW."revision" <> 1) OR (TG_OP = 'UPDATE' AND NEW."revision" <> OLD."revision" + 1) THEN
    RAISE EXCEPTION 'Observation revision must advance exactly once' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM "health_centers" WHERE id = NEW."healthCenterId" AND "isActive" FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active health center required' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM "indicators" i JOIN "sections" s ON s.code = i."sectionCode"
    WHERE i.id = NEW."indicatorId" AND i."isActive" AND s."isActive" FOR SHARE OF i, s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or inactive indicator/section' USING ERRCODE = '23514';
  END IF;
  SELECT role INTO writer_role FROM "users"
    WHERE id = NEW."updatedBy" AND "healthCenterId" = NEW."healthCenterId" AND status = 'ACTIVE'
      AND role IN ('ADMIN_PUSKESMAS', 'PIC') FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active tenant observation writer required' USING ERRCODE = '23514';
  END IF;
  IF writer_role = 'PIC' THEN
    PERFORM 1 FROM "pic_assignments" WHERE "healthCenterId" = NEW."healthCenterId" AND "year" = NEW."year"
      AND "indicatorId" = NEW."indicatorId" AND "picUserId" = NEW."updatedBy" FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PIC may only write assigned indicators' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."evidenceId" IS NOT NULL THEN
    PERFORM 1 FROM "uploads" WHERE id = NEW."evidenceId" AND "healthCenterId" = NEW."healthCenterId"
      AND "year" = NEW."year" AND "month" = NEW."month" AND status IN ('READY', 'ATTACHED')
      AND etag IS NOT NULL AND length(etag) > 0 AND (writer_role <> 'PIC' OR "userId" = NEW."updatedBy"
        OR (TG_OP = 'UPDATE' AND NEW."evidenceId" = OLD."evidenceId")) FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid observation evidence scope, owner or readiness' USING ERRCODE = '23514';
    END IF;
    UPDATE "uploads" SET status = 'ATTACHED' WHERE id = NEW."evidenceId" AND status = 'READY';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER monthly_observations_guard BEFORE INSERT OR UPDATE OR DELETE ON "monthly_observations"
FOR EACH ROW EXECUTE FUNCTION protect_monthly_observation();
