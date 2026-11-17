-- Откат миграции 20261117120000_crm_attribution (выполнять вручную: psql -f down.sql,
-- затем удалить запись из _prisma_migrations). Данные CRM и внешних полисов будут удалены.
DROP TABLE IF EXISTS "ExternalPolicy";
DROP TABLE IF EXISTS "CrmImportBatch";
DROP TABLE IF EXISTS "CrmInteraction";
DROP TABLE IF EXISTS "CrmPolicy";
DROP TABLE IF EXISTS "CrmContact";
DROP TYPE IF EXISTS "CrmLinkState";
ALTER TABLE "Commission" DROP COLUMN IF EXISTS "dealOrigin", DROP COLUMN IF EXISTS "disputeReason";
ALTER TABLE "InsuranceRequest" DROP COLUMN IF EXISTS "source", DROP COLUMN IF EXISTS "sourceDetail", DROP COLUMN IF EXISTS "sourceOrgId";
ALTER TABLE "User" DROP COLUMN IF EXISTS "acquisitionOrgId", DROP COLUMN IF EXISTS "acquisitionSource";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261117120000_crm_attribution';
