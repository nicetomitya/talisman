-- Дополнение ТЗ от 16.11.2026: CRM агентства (контакты без аккаунта, приглашения, связывание),
-- полисы вне платформы, атрибуция источника заявки, происхождение сделки в начислениях.
-- Миграция только добавляет таблицы и nullable/default-колонки. Откат: down.sql в этой папке.

-- CreateEnum
CREATE TYPE "CrmLinkState" AS ENUM ('NOT_INVITED', 'PREPARED', 'SENT', 'REGISTERED', 'VERIFIED_LINKED', 'REVOKED');

-- AlterTable
ALTER TABLE "Commission" ADD COLUMN     "dealOrigin" TEXT,
ADD COLUMN     "disputeReason" TEXT;

-- AlterTable
ALTER TABLE "InsuranceRequest" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'ORGANIC',
ADD COLUMN     "sourceDetail" TEXT,
ADD COLUMN     "sourceOrgId" UUID;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "acquisitionOrgId" UUID,
ADD COLUMN     "acquisitionSource" TEXT;

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "responsibleUserId" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "phoneNorm" TEXT,
    "emailNorm" TEXT,
    "provenance" TEXT NOT NULL DEFAULT 'MANUAL',
    "legalBasis" TEXT NOT NULL,
    "notes" TEXT,
    "importBatchId" UUID,
    "linkState" "CrmLinkState" NOT NULL DEFAULT 'NOT_INVITED',
    "linkedUserId" UUID,
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "invitePreparedAt" TIMESTAMP(3),
    "inviteSentAt" TIMESTAMP(3),
    "inviteChannel" TEXT,
    "registeredAt" TIMESTAMP(3),
    "linkedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmPolicy" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "insurerName" TEXT NOT NULL,
    "number" TEXT,
    "objectTitle" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "premiumKop" INTEGER,
    "sharedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmInteraction" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "authorUserId" UUID,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmImportBatch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "legalBasis" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalPolicy" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "sourceOrgId" UUID,
    "crmPolicyId" UUID,
    "verification" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "category" TEXT NOT NULL,
    "insurerName" TEXT NOT NULL,
    "number" TEXT,
    "objectTitle" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "premiumKop" INTEGER,
    "reminderSentAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_inviteTokenHash_key" ON "CrmContact"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "CrmContact_organizationId_linkState_idx" ON "CrmContact"("organizationId", "linkState");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_organizationId_emailNorm_key" ON "CrmContact"("organizationId", "emailNorm");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_organizationId_phoneNorm_key" ON "CrmContact"("organizationId", "phoneNorm");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_organizationId_linkedUserId_key" ON "CrmContact"("organizationId", "linkedUserId");

-- CreateIndex
CREATE INDEX "CrmPolicy_organizationId_endsAt_idx" ON "CrmPolicy"("organizationId", "endsAt");

-- CreateIndex
CREATE INDEX "CrmInteraction_contactId_createdAt_idx" ON "CrmInteraction"("contactId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalPolicy_crmPolicyId_key" ON "ExternalPolicy"("crmPolicyId");

-- CreateIndex
CREATE INDEX "ExternalPolicy_clientId_idx" ON "ExternalPolicy"("clientId");

-- AddForeignKey
ALTER TABLE "CrmPolicy" ADD CONSTRAINT "CrmPolicy_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Инварианты в БД (как в 20261102999999_invariants): связанная карточка всегда указывает на аккаунт,
-- ссылки на организацию и пользователя — настоящие внешние ключи.
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_linked_has_user" CHECK ("linkState" NOT IN ('REGISTERED', 'VERIFIED_LINKED') OR "linkedUserId" IS NOT NULL);
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT;
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_linkedUser_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "ExternalPolicy" ADD CONSTRAINT "ExternalPolicy_client_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE;
