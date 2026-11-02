-- Инварианты, которые Prisma не выражает декларативно.

-- Одна активная версия предложения на (заявка, агентство, страховщик, продукт)
CREATE UNIQUE INDEX "Quote_one_active_per_offerer"
  ON "Quote" ("requestId", COALESCE("agencyOrgId", '00000000-0000-0000-0000-000000000000'::uuid), "carrierOrgId", "productId")
  WHERE "status" IN ('DRAFT', 'PUBLISHED', 'SELECTED');

-- Один запрос — не более одного активного выбора/оформления
CREATE UNIQUE INDEX "Checkout_one_active_per_request"
  ON "Checkout" ("requestId")
  WHERE "status" NOT IN ('CANCELLED');

-- Одна активная оплата премии на оформление (неуспешные и отменённые не мешают новой попытке)
CREATE UNIQUE INDEX "Payment_one_live_per_checkout"
  ON "Payment" ("checkoutId")
  WHERE "checkoutId" IS NOT NULL AND "status" IN ('CREATED', 'PENDING', 'AUTHORIZED', 'SUCCEEDED', 'UNKNOWN');

-- Одно действующее покрытие на бронирование в рамках продукта
CREATE UNIQUE INDEX "Policy_booking_once"
  ON "Policy" ("productCode", "bookingRef")
  WHERE "bookingRef" IS NOT NULL AND "contractStatus" IN ('PREPARED', 'CONCLUDED');

ALTER TABLE "Coverage" ADD CONSTRAINT "Coverage_paid_within_limit" CHECK ("paidKop" >= 0 AND "paidKop" <= "limitKop");
ALTER TABLE "CapacityPool" ADD CONSTRAINT "Capacity_within_limit" CHECK ("reservedCount" >= 0 AND "usedCount" >= 0 AND "reservedCount" + "usedCount" <= "limitCount");
ALTER TABLE "Promo" ADD CONSTRAINT "Promo_within_budget" CHECK ("reservedKop" >= 0 AND "usedKop" >= 0 AND "reservedKop" + "usedKop" <= "budgetKop" AND "uses" <= "maxUses");
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_amounts_positive" CHECK ("premiumKop" > 0 AND "feesKop" >= 0 AND "discountKop" >= 0 AND "totalKop" = "premiumKop" + "feesKop" - "discountKop");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amountKop" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_positive" CHECK ("amountKop" > 0);
ALTER TABLE "PayoutItem" ADD CONSTRAINT "Payout_amount_positive" CHECK ("amountKop" > 0);
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
