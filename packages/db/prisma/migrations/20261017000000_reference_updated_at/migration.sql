-- G-T15: version of the hourly reference data (Site Master + normalizations).
ALTER TABLE "system_status" ADD COLUMN "referenceUpdatedAt" TIMESTAMP(3);
