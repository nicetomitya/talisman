-- Модель «матча»: заявка конкретному агентству и причина отмены
ALTER TABLE "InsuranceRequest" ADD COLUMN "directAgencyOrgId" UUID;
ALTER TABLE "InsuranceRequest" ADD COLUMN "previousRequestId" UUID;
ALTER TABLE "InsuranceRequest" ADD COLUMN "cancelReason" TEXT;
