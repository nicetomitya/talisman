-- ТЗ v2 (US Event Risk): только симуляция. Аддитивно, откат — down.sql.



-- AlterTable
ALTER TABLE "User" ADD COLUMN     "market" TEXT NOT NULL DEFAULT 'RU',
ADD COLUMN     "riskTierOverride" TEXT,
ADD COLUMN     "usState" TEXT;

-- CreateTable
CREATE TABLE "RiskIntent" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID,
    "guestKeyHash" TEXT,
    "rawDescription" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "placeText" TEXT,
    "placeKey" TEXT,
    "stationId" TEXT,
    "windowStartLocal" TEXT,
    "windowEndLocal" TEXT,
    "timezone" TEXT,
    "startUtc" TIMESTAMP(3),
    "endUtc" TIMESTAMP(3),
    "metric" TEXT,
    "operator" TEXT,
    "thresholdX100" INTEGER,
    "unit" TEXT,
    "desiredPayoutCents" INTEGER,
    "budgetCents" INTEGER,
    "customerType" TEXT NOT NULL DEFAULT 'CONSUMER',
    "unresolved" JSONB NOT NULL DEFAULT '[]',
    "basisRisk" JSONB NOT NULL DEFAULT '[]',
    "manipulationRisk" BOOLEAN NOT NULL DEFAULT false,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "extractorVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEEDS_CLARIFICATION',
    "eventDefinitionId" UUID,
    "executionMode" TEXT NOT NULL DEFAULT 'SIMULATION',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDefinition" (
    "id" UUID NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "templateCode" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "thresholdX100" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "aggregation" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "windowStartLocal" TEXT NOT NULL,
    "windowEndLocal" TEXT NOT NULL,
    "startUtc" TIMESTAMP(3) NOT NULL,
    "endUtc" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "fallbackSource" TEXT,
    "missingDataPolicy" TEXT NOT NULL,
    "ruleHash" TEXT NOT NULL,
    "lifecycle" TEXT NOT NULL DEFAULT 'VALIDATED',
    "manipulationRisk" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTemplate" (
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "outcomeYes" TEXT NOT NULL,
    "outcomeNo" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "aggregation" TEXT NOT NULL,
    "missingDataPolicy" TEXT NOT NULL,
    "disputeWindowHours" INTEGER NOT NULL,
    "approvalStatus" TEXT NOT NULL,
    "liveEligible" BOOLEAN NOT NULL DEFAULT false,
    "manipulationRisk" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTemplate_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "VenueMarket" (
    "id" UUID NOT NULL,
    "venue" TEXT NOT NULL,
    "venueMarketId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL DEFAULT 'SIMULATED',
    "title" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "termsHash" TEXT NOT NULL,
    "termsVersion" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "unitPayoutCents" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "complianceStatus" TEXT NOT NULL DEFAULT 'SIM_ALLOWED',
    "regulatoryNote" TEXT NOT NULL,
    "eventRootKey" TEXT NOT NULL,
    "objectKey" TEXT,
    "manipulationRisk" BOOLEAN NOT NULL DEFAULT false,
    "tradingCloseUtc" TIMESTAMP(3) NOT NULL,
    "legalLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "VenueMarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteSnapshot" (
    "id" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL DEFAULT 'SIMULATED',
    "yesAsks" JSONB NOT NULL,
    "noAsks" JSONB NOT NULL,
    "termsHash" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "staleAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchAssessment" (
    "id" UUID NOT NULL,
    "riskIntentId" UUID NOT NULL,
    "marketId" UUID,
    "exactness" TEXT NOT NULL,
    "mismatchTags" JSONB NOT NULL DEFAULT '[]',
    "explanation" TEXT NOT NULL,
    "matchVersion" TEXT NOT NULL,
    "termsHash" TEXT,
    "modelVersion" TEXT NOT NULL,
    "sourceRefs" JSONB NOT NULL DEFAULT '[]',
    "confidence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimOrder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "riskIntentId" UUID,
    "side" TEXT NOT NULL,
    "requestedUnits" INTEGER NOT NULL,
    "filledUnits" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "quoteSnapshotId" UUID NOT NULL,
    "termsHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "simulation" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimFill" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "units" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimFill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "side" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "sourceKind" TEXT NOT NULL DEFAULT 'SIMULATED',
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OracleObservation" (
    "id" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "sourceId" TEXT NOT NULL,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "metric" TEXT NOT NULL,
    "valueX100" INTEGER,
    "sourceTimestamp" TIMESTAMP(3) NOT NULL,
    "retrievalTimestamp" TIMESTAMP(3) NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL DEFAULT 'SIMULATED',

    CONSTRAINT "OracleObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResolutionRecord" (
    "id" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "outcome" TEXT,
    "status" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "sourceKind" TEXT NOT NULL DEFAULT 'SIMULATED',
    "disputeDeadline" TIMESTAMP(3),
    "disputeReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResolutionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRecord" (
    "id" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "partnerRef" TEXT NOT NULL,
    "grossPayoutCents" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "feesCents" INTEGER NOT NULL,
    "netCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "sourceKind" TEXT NOT NULL DEFAULT 'SIMULATED',
    "finalAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictDeclaration" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "detail" TEXT,
    "restriction" TEXT NOT NULL,
    "assessedBy" UUID,
    "assessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "credentials" TEXT NOT NULL,
    "disclosures" TEXT NOT NULL,
    "conflicts" TEXT,
    "moderationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "liquidityProviderStatus" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpertProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertForecast" (
    "id" UUID NOT NULL,
    "expertUserId" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "probabilityBp" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "note" TEXT,
    "version" INTEGER NOT NULL,
    "supersedesId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandSignal" (
    "id" UUID NOT NULL,
    "riskIntentId" UUID NOT NULL,
    "userId" UUID,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceReview" (
    "id" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reviewerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskIntent_ownerUserId_idx" ON "RiskIntent"("ownerUserId");

-- CreateIndex
CREATE INDEX "RiskIntent_guestKeyHash_idx" ON "RiskIntent"("guestKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "EventDefinition_canonicalKey_version_key" ON "EventDefinition"("canonicalKey", "version");

-- CreateIndex
CREATE INDEX "VenueMarket_templateCode_idx" ON "VenueMarket"("templateCode");

-- CreateIndex
CREATE UNIQUE INDEX "VenueMarket_venue_venueMarketId_key" ON "VenueMarket"("venue", "venueMarketId");

-- CreateIndex
CREATE INDEX "QuoteSnapshot_marketId_takenAt_idx" ON "QuoteSnapshot"("marketId", "takenAt");

-- CreateIndex
CREATE INDEX "MatchAssessment_riskIntentId_idx" ON "MatchAssessment"("riskIntentId");

-- CreateIndex
CREATE INDEX "SimOrder_userId_idx" ON "SimOrder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_orderId_key" ON "Position"("orderId");

-- CreateIndex
CREATE INDEX "Position_userId_idx" ON "Position"("userId");

-- CreateIndex
CREATE INDEX "Position_marketId_idx" ON "Position"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "OracleObservation_marketId_sourceId_sourceTimestamp_key" ON "OracleObservation"("marketId", "sourceId", "sourceTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ResolutionRecord_marketId_key" ON "ResolutionRecord"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRecord_positionId_key" ON "SettlementRecord"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConflictDeclaration_userId_objectKey_key" ON "ConflictDeclaration"("userId", "objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExpertProfile_userId_key" ON "ExpertProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpertForecast_expertUserId_marketId_version_key" ON "ExpertForecast"("expertUserId", "marketId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DemandSignal_riskIntentId_kind_key" ON "DemandSignal"("riskIntentId", "kind");

-- AddForeignKey
ALTER TABLE "SimFill" ADD CONSTRAINT "SimFill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SimOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Инварианты v2
ALTER TABLE "VenueMarket" ADD CONSTRAINT "VenueMarket_payout_chk" CHECK ("unitPayoutCents" > 0);
ALTER TABLE "SimOrder" ADD CONSTRAINT "SimOrder_amounts_chk" CHECK ("requestedUnits" > 0 AND "filledUnits" >= 0 AND "filledUnits" <= "requestedUnits" AND "costCents" >= 0 AND "feeCents" >= 0 AND "simulation" = true);
ALTER TABLE "SimFill" ADD CONSTRAINT "SimFill_chk" CHECK ("priceCents" BETWEEN 1 AND 99 AND "units" > 0);
ALTER TABLE "Position" ADD CONSTRAINT "Position_chk" CHECK ("units" >= 0 AND "costCents" >= 0 AND "feeCents" >= 0 AND "side" IN ('YES','NO') AND "sourceKind" = 'SIMULATED');
ALTER TABLE "SettlementRecord" ADD CONSTRAINT "SettlementRecord_sim_chk" CHECK ("sourceKind" = 'SIMULATED' AND "partnerRef" LIKE 'SIMULATED:%');
ALTER TABLE "ExpertForecast" ADD CONSTRAINT "ExpertForecast_prob_chk" CHECK ("probabilityBp" BETWEEN 0 AND 10000);
-- Прогнозы экспертов и наблюдения оракула неизменяемы
CREATE OR REPLACE FUNCTION ev_immutable() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'immutable record: %', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "ExpertForecast_immutable" BEFORE UPDATE OR DELETE ON "ExpertForecast" FOR EACH ROW EXECUTE FUNCTION ev_immutable();
CREATE TRIGGER "OracleObservation_immutable" BEFORE UPDATE ON "OracleObservation" FOR EACH ROW EXECUTE FUNCTION ev_immutable();
CREATE TRIGGER "SettlementRecord_immutable" BEFORE UPDATE ON "SettlementRecord" FOR EACH ROW EXECUTE FUNCTION ev_immutable();
