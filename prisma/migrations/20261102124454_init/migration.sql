-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('CLIENT', 'STAFF');

-- CreateEnum
CREATE TYPE "AccessStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "OneTimeTokenType" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('AGENCY', 'CARRIER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('AGENCY_OWNER', 'AGENT', 'CARRIER_REP', 'ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('CLASSIC', 'EVENT');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'SUBMITTED_TO_CARRIER', 'CARRIER_APPROVED', 'PLATFORM_CHECKED', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TariffStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'NEEDS_INFO', 'OPEN', 'SELECTION', 'CHECKOUT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('PREPARED', 'OPEN', 'EXTENDED', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'REPLACED', 'WITHDRAWN', 'EXPIRED', 'SELECTED');

-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('RESERVED', 'CHECKING', 'DOCUMENTS', 'CLIENT_CONFIRMATION', 'PAYMENT', 'AWAITING_CARRIER', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('QUARANTINE', 'CLEAN', 'REJECTED', 'GENERATED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'AUTHORIZED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('PREPARED', 'CONCLUDED', 'TERMINATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EventCheckStatus" AS ENUM ('SCHEDULED', 'COLLECTING', 'NEEDS_DATA', 'CALCULATED', 'SPECIALIST_REVIEW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'NEEDS_INFO', 'REVIEWING', 'DECISION_PREPARED', 'APPROVED', 'REJECTED', 'PAYOUT_IN_PROGRESS', 'PAID', 'DISPUTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'GRACE', 'RESTRICTED', 'ENDED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "kind" "UserKind" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "status" "AccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "activeOrgId" UUID,
    "mfaVerifiedAt" TIMESTAMP(3),
    "isDemoSwitch" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneTimeToken" (
    "id" UUID NOT NULL,
    "type" "OneTimeTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OneTimeToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoMail" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'SERVICE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoMail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "type" "OrgType" NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "inn" TEXT,
    "status" "AccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "blockReason" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedUntil" TIMESTAMP(3),
    "description" TEXT,
    "specialization" TEXT,
    "territory" TEXT,
    "languages" TEXT,
    "responseMode" TEXT,
    "licenseNote" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "status" "AccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgVerification" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "reviewerId" UUID,
    "note" TEXT,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mandate" (
    "id" UUID NOT NULL,
    "agencyOrgId" UUID NOT NULL,
    "carrierOrgId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "territory" TEXT NOT NULL DEFAULT 'RU',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "status" "MandateStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "carrierOrgId" UUID NOT NULL,
    "proposedByOrgId" UUID,
    "distributorOrgId" UUID,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "instantQuote" BOOLEAN NOT NULL DEFAULT false,
    "auctionAllowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVersion" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "terms" JSONB NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TariffVersion" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "carrierOrgId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'DEMO_GRID',
    "rules" JSONB NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "status" "TariffStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TariffVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapacityPool" (
    "id" UUID NOT NULL,
    "carrierOrgId" UUID NOT NULL,
    "productCode" TEXT NOT NULL,
    "limitCount" INTEGER NOT NULL,
    "reservedCount" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapacityPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSchema" (
    "id" UUID NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'RU',
    "productCode" TEXT NOT NULL,
    "carrierOrgId" UUID,
    "version" INTEGER NOT NULL,
    "fields" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormSchema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesSuspension" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),

    CONSTRAINT "SalesSuspension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceRequest" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "productCode" TEXT NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "freeText" TEXT,
    "formSchemaId" UUID NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "confirmed" JSONB NOT NULL DEFAULT '{}',
    "territory" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "renewalOfPolicyId" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InsuranceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestVersion" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "schemaSnapshot" JSONB NOT NULL,
    "publicData" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "requestVersion" INTEGER NOT NULL,
    "status" "AuctionStatus" NOT NULL DEFAULT 'PREPARED',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "originalClosesAt" TIMESTAMP(3) NOT NULL,
    "extensionTotalSec" INTEGER NOT NULL DEFAULT 0,
    "minStepKop" INTEGER NOT NULL DEFAULT 10000,
    "visibility" TEXT NOT NULL DEFAULT 'CLIENT_OPEN_AGENT_RANK',
    "eligibleOrgIds" JSONB NOT NULL DEFAULT '[]',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "requestVersion" INTEGER NOT NULL,
    "auctionId" UUID,
    "agencyOrgId" UUID,
    "carrierOrgId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "agentUserId" UUID,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "seq" INTEGER NOT NULL DEFAULT 1,
    "replacesQuoteId" UUID,
    "isPreliminary" BOOLEAN NOT NULL DEFAULT false,
    "coverageFingerprint" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "premiumKop" INTEGER NOT NULL,
    "feesKop" INTEGER NOT NULL DEFAULT 0,
    "discountKop" INTEGER NOT NULL DEFAULT 0,
    "discountPayer" TEXT,
    "totalKop" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "carrierQuoteId" TEXT,
    "tariffVersionId" UUID,
    "commissionPct" INTEGER NOT NULL DEFAULT 1500,
    "inspectionRequired" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "withdrawReason" TEXT,
    "createdVia" TEXT NOT NULL DEFAULT 'MANUAL',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteEvent" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkout" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "requestVersion" INTEGER NOT NULL,
    "quoteId" UUID NOT NULL,
    "quoteSeq" INTEGER NOT NULL,
    "clientId" UUID NOT NULL,
    "agencyOrgId" UUID,
    "carrierOrgId" UUID NOT NULL,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'RESERVED',
    "reservationExpiresAt" TIMESTAMP(3) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "acknowledgements" JSONB NOT NULL DEFAULT '{}',
    "cancelReason" TEXT,
    "selectionReason" TEXT,
    "carrierFinalQuoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Checkout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureSession" (
    "id" UUID NOT NULL,
    "checkoutId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "docHashes" JSONB NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "method" TEXT NOT NULL DEFAULT 'DEMO_OTP_EMAIL',
    "deliveryInfo" JSONB NOT NULL DEFAULT '{}',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerUserId" UUID,
    "organizationId" UUID,
    "requestId" UUID,
    "checkoutId" UUID,
    "policyId" UUID,
    "claimId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "seriesId" UUID NOT NULL,
    "supersededById" UUID,
    "createdById" UUID,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL,
    "scanNote" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "externalOrigin" TEXT,
    "clauses" JSONB,
    "extracted" JSONB,
    "signedAt" TIMESTAMP(3),
    "signedBy" TEXT,
    "signatureInfo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAccessLog" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orgId" UUID,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentShare" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "agencyOrgId" UUID NOT NULL,
    "grantedBy" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "textVersion" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "method" TEXT NOT NULL,
    "recipients" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAccessGrant" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payerUserId" UUID,
    "payerOrgId" UUID,
    "recipientOrgId" UUID,
    "recipientLabel" TEXT NOT NULL,
    "amountKop" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "checkoutId" UUID,
    "invoiceId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "failureReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentStatusHistory" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "from" "PaymentStatus",
    "to" "PaymentStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "policyId" UUID,
    "externalId" TEXT NOT NULL,
    "amountKop" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookInbox" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "processedAt" TIMESTAMP(3),
    "result" TEXT,
    "receivedCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "checkoutId" UUID,
    "requestId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "carrierOrgId" UUID NOT NULL,
    "agencyOrgId" UUID,
    "servicingAgentId" UUID,
    "productCode" TEXT NOT NULL,
    "productVersionId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "contractStatus" "ContractStatus" NOT NULL DEFAULT 'PREPARED',
    "externalNumber" TEXT,
    "objectTitle" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "premiumKop" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "concludedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "bookingRef" TEXT,
    "bookingCanceledAt" TIMESTAMP(3),
    "latitudeE6" INTEGER,
    "longitudeE6" INTEGER,
    "renewalReminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coverage" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "limitKop" INTEGER NOT NULL,
    "paidKop" INTEGER NOT NULL DEFAULT 0,
    "deductibleKop" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DISTRIBUTION',
    "payerOrgId" UUID NOT NULL,
    "recipientType" TEXT NOT NULL,
    "recipientOrgId" UUID,
    "baseKop" INTEGER NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "amountKop" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCRUED',
    "termsVersion" TEXT NOT NULL,
    "reversalOfId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "intervalStart" TIMESTAMP(3) NOT NULL,
    "intervalEnd" TIMESTAMP(3) NOT NULL,
    "valueX100" INTEGER NOT NULL,
    "quality" TEXT NOT NULL DEFAULT 'OK',
    "isFinal" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "rawPayload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventCheck" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "status" "EventCheckStatus" NOT NULL DEFAULT 'SCHEDULED',
    "ruleVersion" TEXT NOT NULL,
    "result" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "runs" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "calculatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "EventCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "policyId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "agencyOrgId" UUID,
    "carrierOrgId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "carrierStatus" TEXT,
    "eventCheckId" UUID,
    "eventDate" TIMESTAMP(3),
    "description" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "requiredDocs" JSONB NOT NULL DEFAULT '[]',
    "decision" TEXT,
    "decisionReason" TEXT,
    "decisionBy" UUID,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "slaDueAt" TIMESTAMP(3),
    "assigneeId" UUID,
    "disputeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvent" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" UUID,
    "note" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutItem" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "coverageCode" TEXT NOT NULL,
    "basisKey" TEXT NOT NULL,
    "amountKop" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "externalId" TEXT,
    "beneficiary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "contextType" TEXT NOT NULL,
    "contextId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "agencyOrgId" UUID,
    "title" TEXT NOT NULL,
    "slaMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "authorId" UUID,
    "authorRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "citations" JSONB,
    "attachmentDocId" UUID,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readByClientAt" TIMESTAMP(3),
    "readByAgencyAt" TIMESTAMP(3),
    "handoff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'SERVICE',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "name" TEXT NOT NULL,
    "props" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priceKop" INTEGER NOT NULL,
    "maxUsers" INTEGER NOT NULL,
    "maxResponses" INTEGER NOT NULL,
    "features" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "nextPlanId" UUID,
    "status" "SubscriptionStatus" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "autoRenewConsentAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "graceUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amountKop" INTEGER NOT NULL,
    "discountKop" INTEGER NOT NULL DEFAULT 0,
    "promoId" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResponseUsage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResponseUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promo" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'SAAS_SUBSCRIPTION',
    "audience" TEXT NOT NULL,
    "fundingSource" TEXT NOT NULL,
    "budgetKop" INTEGER NOT NULL,
    "reservedKop" INTEGER NOT NULL DEFAULT 0,
    "usedKop" INTEGER NOT NULL DEFAULT 0,
    "discountKop" INTEGER NOT NULL,
    "maxUses" INTEGER NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ownerOrgId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Promo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "agencyOrgId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'SALE',
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "moderationNote" TEXT,
    "agentReply" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'MANUAL',
    "productCodes" JSONB NOT NULL DEFAULT '[]',
    "territories" JSONB NOT NULL DEFAULT '[]',
    "maxSumInsuredRub" INTEGER NOT NULL DEFAULT 5000000,
    "maxVehicleAge" INTEGER NOT NULL DEFAULT 15,
    "requiredDocs" JSONB NOT NULL DEFAULT '[]',
    "tariffMaxAgeDays" INTEGER NOT NULL DEFAULT 30,
    "maxContractsPerDay" INTEGER NOT NULL DEFAULT 20,
    "dailyResponseLimit" INTEGER NOT NULL DEFAULT 50,
    "minCommissionBp" INTEGER NOT NULL DEFAULT 1000,
    "discountFromCommissionKop" INTEGER NOT NULL DEFAULT 0,
    "improveMode" TEXT NOT NULL DEFAULT 'NONE',
    "manualReasons" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "requestVersion" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "quoteId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "assigneeId" UUID,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "relatedType" TEXT,
    "relatedId" UUID,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAssignment" (
    "id" UUID NOT NULL,
    "agencyOrgId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "agentUserId" UUID NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "ClientAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedObject" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionItem" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "assigneeId" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "nextAction" TEXT NOT NULL,
    "resolution" TEXT,
    "dedupeKey" TEXT,
    "organizationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ExceptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminApproval" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedBy" UUID NOT NULL,
    "approvedBy" UUID,
    "approvalReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AdminApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAdjustment" (
    "id" UUID NOT NULL,
    "commissionId" UUID,
    "amountKop" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "approvalId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchApproval" (
    "id" UUID NOT NULL,
    "country" TEXT NOT NULL,
    "carrierOrgId" UUID NOT NULL,
    "productCode" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "paymentFlow" TEXT NOT NULL,
    "docsVersion" TEXT NOT NULL,
    "approvedBy" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaunchApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" UUID,
    "actorOrgId" UUID,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "correlationId" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "uniqueKey" TEXT,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OneTimeToken_tokenHash_key" ON "OneTimeToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DemoMail_userId_idx" ON "DemoMail"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_role_key" ON "Membership"("userId", "organizationId", "role");

-- CreateIndex
CREATE INDEX "Mandate_agencyOrgId_idx" ON "Mandate"("agencyOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVersion_productId_version_key" ON "ProductVersion"("productId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TariffVersion_productId_carrierOrgId_version_key" ON "TariffVersion"("productId", "carrierOrgId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CapacityPool_carrierOrgId_productCode_key" ON "CapacityPool"("carrierOrgId", "productCode");

-- CreateIndex
CREATE UNIQUE INDEX "FormSchema_country_productCode_version_key" ON "FormSchema"("country", "productCode", "version");

-- CreateIndex
CREATE INDEX "InsuranceRequest_clientId_idx" ON "InsuranceRequest"("clientId");

-- CreateIndex
CREATE INDEX "InsuranceRequest_status_idx" ON "InsuranceRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RequestVersion_requestId_version_key" ON "RequestVersion"("requestId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Auction_requestId_requestVersion_key" ON "Auction"("requestId", "requestVersion");

-- CreateIndex
CREATE INDEX "Quote_requestId_status_idx" ON "Quote"("requestId", "status");

-- CreateIndex
CREATE INDEX "Quote_agencyOrgId_idx" ON "Quote"("agencyOrgId");

-- CreateIndex
CREATE INDEX "Checkout_clientId_idx" ON "Checkout"("clientId");

-- CreateIndex
CREATE INDEX "Checkout_requestId_idx" ON "Checkout"("requestId");

-- CreateIndex
CREATE INDEX "Document_requestId_idx" ON "Document"("requestId");

-- CreateIndex
CREATE INDEX "Document_checkoutId_idx" ON "Document"("checkoutId");

-- CreateIndex
CREATE INDEX "Document_policyId_idx" ON "Document"("policyId");

-- CreateIndex
CREATE INDEX "Document_claimId_idx" ON "Document"("claimId");

-- CreateIndex
CREATE INDEX "Document_ownerUserId_idx" ON "Document"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentShare_documentId_agencyOrgId_key" ON "DocumentShare"("documentId", "agencyOrgId");

-- CreateIndex
CREATE INDEX "Consent_userId_purpose_idx" ON "Consent"("userId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_externalId_key" ON "Payment"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_checkoutId_idx" ON "Payment"("checkoutId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_externalId_key" ON "Refund"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookInbox_provider_externalEventId_key" ON "WebhookInbox"("provider", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_number_key" ON "Policy"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_checkoutId_key" ON "Policy"("checkoutId");

-- CreateIndex
CREATE INDEX "Policy_clientId_idx" ON "Policy"("clientId");

-- CreateIndex
CREATE INDEX "Policy_agencyOrgId_idx" ON "Policy"("agencyOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Coverage_policyId_code_key" ON "Coverage"("policyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_policyId_recipientType_kind_key" ON "Commission"("policyId", "recipientType", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Observation_source_stationId_metric_intervalStart_revision_key" ON "Observation"("source", "stationId", "metric", "intervalStart", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "EventCheck_policyId_key" ON "EventCheck"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_number_key" ON "Claim"("number");

-- CreateIndex
CREATE INDEX "Claim_clientId_idx" ON "Claim"("clientId");

-- CreateIndex
CREATE INDEX "Claim_policyId_idx" ON "Claim"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutItem_externalId_key" ON "PayoutItem"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutItem_policyId_coverageCode_basisKey_key" ON "PayoutItem"("policyId", "coverageCode", "basisKey");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_contextType_contextId_agencyOrgId_key" ON "Conversation"("contextType", "contextId", "agencyOrgId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_subscriptionId_periodStart_key" ON "SubscriptionInvoice"("subscriptionId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "ResponseUsage_organizationId_requestId_periodStart_key" ON "ResponseUsage"("organizationId", "requestId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Promo_code_key" ON "Promo"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Review_authorId_policyId_stage_key" ON "Review"("authorId", "policyId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_organizationId_key" ON "AutomationRule"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRun_organizationId_requestId_requestVersion_key" ON "AutomationRun"("organizationId", "requestId", "requestVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ExceptionItem_dedupeKey_key" ON "ExceptionItem"("dedupeKey");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_scope_key_key" ON "IdempotencyRecord"("userId", "scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Job_uniqueKey_key" ON "Job"("uniqueKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "Outbox_processedAt_idx" ON "Outbox"("processedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgVerification" ADD CONSTRAINT "OrgVerification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVersion" ADD CONSTRAINT "ProductVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TariffVersion" ADD CONSTRAINT "TariffVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceRequest" ADD CONSTRAINT "InsuranceRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestVersion" ADD CONSTRAINT "RequestVersion_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "InsuranceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coverage" ADD CONSTRAINT "Coverage_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedObject" ADD CONSTRAINT "SavedObject_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
