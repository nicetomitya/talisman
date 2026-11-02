-- CreateTable
CREATE TABLE "EmulatorPayment" (
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "amountKop" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "status" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "scenario" TEXT NOT NULL DEFAULT 'normal',
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmulatorPayment_pkey" PRIMARY KEY ("externalId")
);
