-- Additive only: historical recaps retain SQL NULL; no backfill or recalculation.
ALTER TABLE "period_recaps" ADD COLUMN "structuredInput" JSONB;
