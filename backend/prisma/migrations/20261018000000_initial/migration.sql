CREATE TYPE "Role" AS ENUM ('DINKES_ADMIN', 'ADMIN_PUSKESMAS', 'PIC');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
CREATE TYPE "PeriodStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VERIFIED', 'REVISION_REQUIRED');
CREATE TYPE "Polarity" AS ENUM ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'TIERED_BRACKETS', 'BINARY');
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'READY', 'ATTACHED');
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "health_centers" (
  "id" UUID NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "address" TEXT, "district" TEXT NOT NULL, "headName" TEXT, "headNip" TEXT,
  "phone" TEXT, "email" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "health_centers_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "users" (
  "id" UUID NOT NULL, "healthCenterId" UUID, "username" TEXT NOT NULL, "email" TEXT,
  "name" TEXT NOT NULL, "nip" TEXT, "passwordHash" TEXT NOT NULL, "role" "Role" NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE', "tokenVersion" INTEGER NOT NULL DEFAULT 0,
  "phone" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_role_tenant_check" CHECK (("role" = 'DINKES_ADMIN' AND "healthCenterId" IS NULL) OR ("role" IN ('ADMIN_PUSKESMAS', 'PIC') AND "healthCenterId" IS NOT NULL)),
  CONSTRAINT "users_token_version_check" CHECK ("tokenVersion" >= 0)
);
CREATE TABLE "sessions" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "refreshHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_expiry_check" CHECK ("expiresAt" > "createdAt")
);
CREATE TABLE "year_periods" (
  "year" INTEGER NOT NULL, "cutoffDay" INTEGER NOT NULL DEFAULT 10, "isLocked" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "year_periods_pkey" PRIMARY KEY ("year"),
  CONSTRAINT "year_periods_year_check" CHECK ("year" BETWEEN 2000 AND 9999),
  CONSTRAINT "year_periods_cutoff_check" CHECK ("cutoffDay" BETWEEN 1 AND 28)
);
CREATE TABLE "sections" (
  "code" TEXT NOT NULL, "name" TEXT NOT NULL, "klasterId" INTEGER NOT NULL,
  "parentCode" TEXT, "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "sections_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "sections_klaster_check" CHECK ("klasterId" BETWEEN 1 AND 5),
  CONSTRAINT "sections_parent_check" CHECK ("parentCode" IS NULL OR ("parentCode" <> "code" AND left("code", length("parentCode") + 1) = "parentCode" || '.')),
  CONSTRAINT "sections_order_check" CHECK ("order" >= 0)
);
CREATE TABLE "indicators" (
  "id" TEXT NOT NULL, "klasterId" INTEGER NOT NULL, "sectionCode" TEXT NOT NULL, "no" TEXT NOT NULL,
  "kegiatan" TEXT NOT NULL, "indikator" TEXT NOT NULL, "satuan" TEXT NOT NULL, "targetDisplay" TEXT NOT NULL,
  "targetNumeric" DECIMAL(14,6) NOT NULL, "totalSasaranDefault" DECIMAL(14,4) NOT NULL,
  "targetSasaranDefault" DECIMAL(14,4) NOT NULL, "polarity" "Polarity" NOT NULL,
  "scoringVersion" TEXT NOT NULL DEFAULT 'ILP_2026_V1', "formulaRaw" TEXT, "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "indicators_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "indicators_klaster_check" CHECK ("klasterId" BETWEEN 1 AND 5),
  CONSTRAINT "indicators_inputs_check" CHECK ("targetNumeric" >= 0 AND "totalSasaranDefault" >= 0 AND "targetSasaranDefault" >= 0)
);
CREATE TABLE "annual_targets" (
  "id" UUID NOT NULL, "healthCenterId" UUID NOT NULL, "indicatorId" TEXT NOT NULL, "year" INTEGER NOT NULL,
  "targetPct" DECIMAL(14,4) NOT NULL, "totalSasaran" DECIMAL(14,4) NOT NULL, "targetSasaran" DECIMAL(14,4) NOT NULL,
  "isLocked" BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "annual_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "annual_targets_inputs_check" CHECK ("targetPct" >= 0 AND "totalSasaran" >= 0 AND "targetSasaran" >= 0)
);
CREATE TABLE "pic_assignments" (
  "id" UUID NOT NULL, "healthCenterId" UUID NOT NULL, "indicatorId" TEXT NOT NULL, "year" INTEGER NOT NULL,
  "picUserId" UUID NOT NULL, "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pic_assignments_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "uploads" (
  "id" UUID NOT NULL, "healthCenterId" UUID NOT NULL, "userId" UUID NOT NULL, "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL, "objectKey" TEXT NOT NULL, "filename" TEXT NOT NULL, "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL, "status" "UploadStatus" NOT NULL DEFAULT 'PENDING', "etag" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uploads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uploads_period_check" CHECK ("year" BETWEEN 2000 AND 9999 AND "month" BETWEEN 1 AND 12),
  CONSTRAINT "uploads_size_check" CHECK ("sizeBytes" >= 0)
);
CREATE TABLE "monthly_records" (
  "id" UUID NOT NULL, "healthCenterId" UUID NOT NULL, "indicatorId" TEXT NOT NULL, "year" INTEGER NOT NULL, "month" INTEGER NOT NULL,
  "pencapaianRiil" DECIMAL(14,4) NOT NULL, "totalSasaran" DECIMAL(14,4) NOT NULL, "targetSasaran" DECIMAL(14,4) NOT NULL,
  "capaianRiilPct" DECIMAL(14,4), "nilaiKinerja" DECIMAL(14,4), "scoringVersion" TEXT NOT NULL,
  "evidenceId" UUID, "notes" TEXT, "syncStatus" TEXT NOT NULL DEFAULT 'NOT_SYNCED', "updatedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "monthly_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monthly_records_month_check" CHECK ("month" BETWEEN 1 AND 12),
  CONSTRAINT "monthly_records_inputs_check" CHECK ("pencapaianRiil" >= 0 AND "totalSasaran" >= 0 AND "targetSasaran" >= 0),
  CONSTRAINT "monthly_records_scores_check" CHECK (("capaianRiilPct" IS NULL OR "capaianRiilPct" >= 0) AND ("nilaiKinerja" IS NULL OR "nilaiKinerja" BETWEEN 0 AND 100))
);
CREATE TABLE "period_locks" (
  "id" UUID NOT NULL, "healthCenterId" UUID NOT NULL, "year" INTEGER NOT NULL, "periodNumber" INTEGER NOT NULL,
  "isQuarter" BOOLEAN NOT NULL DEFAULT false, "status" "PeriodStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3), "submittedById" UUID, "verifiedAt" TIMESTAMP(3), "verifiedById" UUID,
  "revisionNote" TEXT, "snapshot" JSONB, "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "period_locks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "period_locks_period_check" CHECK (("isQuarter" AND "periodNumber" BETWEEN 1 AND 4) OR (NOT "isQuarter" AND "periodNumber" BETWEEN 1 AND 12)),
  CONSTRAINT "period_locks_revision_check" CHECK ("revision" >= 0)
);
CREATE TABLE "recommendations" (
  "id" UUID NOT NULL, "healthCenterId" UUID NOT NULL, "year" INTEGER NOT NULL, "quarter" INTEGER NOT NULL, "sectionCode" TEXT NOT NULL,
  "recommendationText" TEXT NOT NULL, "analisisPenyebab" TEXT, "actionPlanText" TEXT, "targetPenyelesaian" TEXT,
  "picName" TEXT, "statusFollowUp" TEXT NOT NULL DEFAULT 'PENDING', "reviewedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recommendations_quarter_check" CHECK ("quarter" BETWEEN 1 AND 4)
);
CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL, "healthCenterId" UUID, "userId" UUID, "actorName" TEXT NOT NULL,
  "action" TEXT NOT NULL, "details" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "export_jobs" (
  "id" UUID NOT NULL, "healthCenterId" UUID NOT NULL, "userId" UUID NOT NULL, "year" INTEGER NOT NULL,
  "quarter" INTEGER NOT NULL, "format" TEXT NOT NULL, "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
  "objectKey" TEXT, "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "export_jobs_period_check" CHECK ("year" BETWEEN 2000 AND 9999 AND "quarter" BETWEEN 0 AND 4)
);

CREATE UNIQUE INDEX "health_centers_code_key" ON "health_centers"("code");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_healthCenterId_role_idx" ON "users"("healthCenterId", "role");
CREATE INDEX "sessions_userId_expiresAt_idx" ON "sessions"("userId", "expiresAt");
CREATE INDEX "sections_parentCode_order_idx" ON "sections"("parentCode", "order");
CREATE INDEX "indicators_sectionCode_isActive_idx" ON "indicators"("sectionCode", "isActive");
CREATE UNIQUE INDEX "annual_targets_healthCenterId_indicatorId_year_key" ON "annual_targets"("healthCenterId", "indicatorId", "year");
CREATE INDEX "annual_targets_year_idx" ON "annual_targets"("year");
CREATE UNIQUE INDEX "pic_assignments_healthCenterId_indicatorId_year_key" ON "pic_assignments"("healthCenterId", "indicatorId", "year");
CREATE INDEX "pic_assignments_picUserId_year_idx" ON "pic_assignments"("picUserId", "year");
CREATE INDEX "pic_assignments_year_idx" ON "pic_assignments"("year");
CREATE UNIQUE INDEX "monthly_records_healthCenterId_indicatorId_year_month_key" ON "monthly_records"("healthCenterId", "indicatorId", "year", "month");
CREATE INDEX "monthly_records_healthCenterId_year_month_idx" ON "monthly_records"("healthCenterId", "year", "month");
CREATE INDEX "monthly_records_year_idx" ON "monthly_records"("year");
CREATE INDEX "monthly_records_evidenceId_idx" ON "monthly_records"("evidenceId");
CREATE UNIQUE INDEX "period_locks_healthCenterId_year_periodNumber_isQuarter_key" ON "period_locks"("healthCenterId", "year", "periodNumber", "isQuarter");
CREATE INDEX "period_locks_year_idx" ON "period_locks"("year");
CREATE UNIQUE INDEX "uploads_objectKey_key" ON "uploads"("objectKey");
CREATE INDEX "uploads_healthCenterId_year_month_idx" ON "uploads"("healthCenterId", "year", "month");
CREATE INDEX "uploads_userId_idx" ON "uploads"("userId");
CREATE UNIQUE INDEX "recommendations_healthCenterId_year_quarter_sectionCode_key" ON "recommendations"("healthCenterId", "year", "quarter", "sectionCode");
CREATE INDEX "recommendations_year_idx" ON "recommendations"("year");
CREATE INDEX "recommendations_sectionCode_idx" ON "recommendations"("sectionCode");
CREATE INDEX "audit_logs_healthCenterId_createdAt_idx" ON "audit_logs"("healthCenterId", "createdAt");
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");
CREATE INDEX "export_jobs_healthCenterId_createdAt_idx" ON "export_jobs"("healthCenterId", "createdAt");
CREATE INDEX "export_jobs_userId_idx" ON "export_jobs"("userId");
CREATE INDEX "export_jobs_status_createdAt_idx" ON "export_jobs"("status", "createdAt");

ALTER TABLE "users" ADD CONSTRAINT "users_healthCenterId_fkey" FOREIGN KEY ("healthCenterId") REFERENCES "health_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sections" ADD CONSTRAINT "sections_parentCode_fkey" FOREIGN KEY ("parentCode") REFERENCES "sections"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_sectionCode_fkey" FOREIGN KEY ("sectionCode") REFERENCES "sections"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "annual_targets" ADD CONSTRAINT "annual_targets_healthCenterId_fkey" FOREIGN KEY ("healthCenterId") REFERENCES "health_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "annual_targets" ADD CONSTRAINT "annual_targets_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "indicators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "annual_targets" ADD CONSTRAINT "annual_targets_year_fkey" FOREIGN KEY ("year") REFERENCES "year_periods"("year") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pic_assignments" ADD CONSTRAINT "pic_assignments_healthCenterId_fkey" FOREIGN KEY ("healthCenterId") REFERENCES "health_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pic_assignments" ADD CONSTRAINT "pic_assignments_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "indicators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pic_assignments" ADD CONSTRAINT "pic_assignments_year_fkey" FOREIGN KEY ("year") REFERENCES "year_periods"("year") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pic_assignments" ADD CONSTRAINT "pic_assignments_picUserId_fkey" FOREIGN KEY ("picUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "monthly_records" ADD CONSTRAINT "monthly_records_healthCenterId_fkey" FOREIGN KEY ("healthCenterId") REFERENCES "health_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "monthly_records" ADD CONSTRAINT "monthly_records_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "indicators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "monthly_records" ADD CONSTRAINT "monthly_records_year_fkey" FOREIGN KEY ("year") REFERENCES "year_periods"("year") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "monthly_records" ADD CONSTRAINT "monthly_records_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_healthCenterId_fkey" FOREIGN KEY ("healthCenterId") REFERENCES "health_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_year_fkey" FOREIGN KEY ("year") REFERENCES "year_periods"("year") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_healthCenterId_fkey" FOREIGN KEY ("healthCenterId") REFERENCES "health_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_healthCenterId_fkey" FOREIGN KEY ("healthCenterId") REFERENCES "health_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_year_fkey" FOREIGN KEY ("year") REFERENCES "year_periods"("year") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_sectionCode_fkey" FOREIGN KEY ("sectionCode") REFERENCES "sections"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_healthCenterId_fkey" FOREIGN KEY ("healthCenterId") REFERENCES "health_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_healthCenterId_fkey" FOREIGN KEY ("healthCenterId") REFERENCES "health_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON "audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

-- Generic identity protection also catches identity changes attempted by FK cascades.
CREATE FUNCTION reject_identity_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field_name text;
BEGIN
  FOREACH field_name IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW) -> field_name) IS DISTINCT FROM (to_jsonb(OLD) -> field_name) THEN
      RAISE EXCEPTION 'Record identity is immutable: %.%', TG_TABLE_NAME, field_name USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER monthly_records_identity BEFORE UPDATE ON "monthly_records" FOR EACH ROW EXECUTE FUNCTION reject_identity_change('id', 'healthCenterId', 'indicatorId', 'year', 'month');
CREATE TRIGGER annual_targets_identity BEFORE UPDATE ON "annual_targets" FOR EACH ROW EXECUTE FUNCTION reject_identity_change('id', 'healthCenterId', 'indicatorId', 'year');
CREATE TRIGGER pic_assignments_identity BEFORE UPDATE ON "pic_assignments" FOR EACH ROW EXECUTE FUNCTION reject_identity_change('id', 'healthCenterId', 'indicatorId', 'year');
CREATE TRIGGER period_locks_identity BEFORE UPDATE ON "period_locks" FOR EACH ROW EXECUTE FUNCTION reject_identity_change('id', 'healthCenterId', 'year', 'periodNumber', 'isQuarter');
CREATE TRIGGER recommendations_identity BEFORE UPDATE ON "recommendations" FOR EACH ROW EXECUTE FUNCTION reject_identity_change('id', 'healthCenterId', 'year', 'quarter', 'sectionCode');
CREATE TRIGGER uploads_identity BEFORE UPDATE ON "uploads" FOR EACH ROW EXECUTE FUNCTION reject_identity_change('id', 'healthCenterId', 'userId', 'year', 'month', 'filename', 'mimeType', 'sizeBytes');

CREATE FUNCTION protect_upload_finalization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'PENDING' AND NEW."status" = 'READY') OR
    (OLD."status" = 'READY' AND NEW."status" = 'ATTACHED')
  ) THEN
    RAISE EXCEPTION 'Invalid upload status transition' USING ERRCODE = '23514';
  END IF;
  IF (NEW."objectKey" IS DISTINCT FROM OLD."objectKey" OR NEW."etag" IS DISTINCT FROM OLD."etag")
    AND NOT (OLD."status" = 'PENDING' AND NEW."status" = 'READY') THEN
    RAISE EXCEPTION 'Upload object and etag may change only during finalization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER uploads_finalization BEFORE UPDATE ON "uploads" FOR EACH ROW EXECUTE FUNCTION protect_upload_finalization();

-- NULL month protects an annual target against any submitted/verified period.
-- All callers acquire the year row before inspecting/locking period rows.
CREATE FUNCTION assert_period_writable(center_id uuid, period_year integer, period_month integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE year_locked boolean;
BEGIN
  SELECT "isLocked" INTO year_locked FROM "year_periods" WHERE "year" = period_year FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Year period does not exist' USING ERRCODE = '23503';
  END IF;
  IF year_locked THEN
    RAISE EXCEPTION 'Year period is locked' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM "period_locks"
    WHERE "healthCenterId" = center_id AND "year" = period_year
      AND "status" IN ('SUBMITTED', 'VERIFIED')
      AND (period_month IS NULL OR
        (NOT "isQuarter" AND "periodNumber" = period_month) OR
        ("isQuarter" AND period_month BETWEEN 1 AND "periodNumber" * 3))
    ORDER BY "periodNumber", "isQuarter" FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'Submitted or verified period is immutable' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION protect_monthly_record_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM assert_period_writable(OLD."healthCenterId", OLD."year", OLD."month");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM assert_period_writable(NEW."healthCenterId", NEW."year", NEW."month");
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER monthly_records_guard BEFORE INSERT OR UPDATE OR DELETE ON "monthly_records"
FOR EACH ROW EXECUTE FUNCTION protect_monthly_record_period();

CREATE FUNCTION protect_annual_target_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    -- Even a lock-only update must serialize with year/period submission.
    PERFORM 1 FROM "year_periods" WHERE "year" = OLD."year" FOR UPDATE;
    IF OLD."isLocked" THEN
      RAISE EXCEPTION 'Annual target is locked' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF NEW."isLocked" AND
        (to_jsonb(NEW) - 'isLocked' - 'updatedAt') = (to_jsonb(OLD) - 'isLocked' - 'updatedAt') THEN
        RETURN NEW;
      END IF;
    END IF;
    PERFORM assert_period_writable(OLD."healthCenterId", OLD."year", NULL);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM assert_period_writable(NEW."healthCenterId", NEW."year", NULL);
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER annual_targets_guard BEFORE INSERT OR UPDATE OR DELETE ON "annual_targets"
FOR EACH ROW EXECUTE FUNCTION protect_annual_target_period();

CREATE FUNCTION validate_pic_assignment_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "users" WHERE "id" = NEW."picUserId"
    AND "healthCenterId" = NEW."healthCenterId" AND "role" = 'PIC' AND "status" = 'ACTIVE'
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assigned user must be an active PIC in the same health center' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pic_assignments_user_check BEFORE INSERT OR UPDATE ON "pic_assignments"
FOR EACH ROW EXECUTE FUNCTION validate_pic_assignment_user();
