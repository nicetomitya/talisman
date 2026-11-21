-- Откат миграции 20261121120000_event_risk_v2
DROP TABLE IF EXISTS "ComplianceReview","DemandSignal","ExpertForecast","ExpertProfile","ConflictDeclaration","SettlementRecord","ResolutionRecord","OracleObservation","Position","SimFill","SimOrder","MatchAssessment","QuoteSnapshot","VenueMarket","EventTemplate","EventDefinition","RiskIntent" CASCADE;
DROP FUNCTION IF EXISTS ev_immutable();
ALTER TABLE "User" DROP COLUMN IF EXISTS "market", DROP COLUMN IF EXISTS "usState", DROP COLUMN IF EXISTS "riskTierOverride";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261121120000_event_risk_v2';
